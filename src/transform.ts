import MagicString from "magic-string";
import ts from "typescript";

type BddCallKind = "given" | "when" | "it";

interface BddCall {
  kind: BddCallKind;
  node: ts.CallExpression;
  depth: number;
  modifier?: "skip" | "only";
}

/**
 * Checks if a node references a specific identifier name anywhere in its subtree.
 * Optionally skips descending into `it()` callback arguments.
 */
function referencesIdentifier(node: ts.Node, name: string, skipItCallbacks: boolean): boolean {
  if (ts.isIdentifier(node) && node.text === name) {
    return true;
  }

  // Skip descending into BDD call callback bodies (it, when, given)
  // since those are transformed separately
  if (skipItCallbacks && ts.isCallExpression(node)) {
    const parsed = parseBddCall(node);
    if (parsed) {
      // Only check the first arg (description), skip callback
      const firstArg = node.arguments[0] as ts.Node | undefined;
      if (firstArg && referencesIdentifier(firstArg, name, skipItCallbacks)) {
        return true;
      }
      return false;
    }
  }

  return (
    ts.forEachChild(node, (child) => referencesIdentifier(child, name, skipItCallbacks)) ?? false
  );
}

/**
 * Detect whether a call expression is a BDD call (given/when/it), potentially
 * with a .skip or .only modifier.
 */
function parseBddCall(
  node: ts.CallExpression,
): { kind: BddCallKind; modifier?: "skip" | "only" } | null {
  const expr = node.expression;

  // Direct call: given(...), when(...), it(...)
  if (ts.isIdentifier(expr)) {
    const name = expr.text;
    if (name === "given" || name === "when" || name === "it") {
      return { kind: name };
    }
    return null;
  }

  // Property access: given.skip(...), when.only(...), etc.
  if (ts.isPropertyAccessExpression(expr)) {
    const obj = expr.expression;
    const prop = expr.name.text;
    if (
      ts.isIdentifier(obj) &&
      (obj.text === "given" || obj.text === "when" || obj.text === "it") &&
      (prop === "skip" || prop === "only")
    ) {
      return { kind: obj.text, modifier: prop };
    }
  }

  return null;
}

/**
 * Collect all BDD calls in the AST, recording their nesting depth.
 * Only collects `when()` and `it()` calls that are nested inside a `given()` call,
 * since standalone `it()` / `when()` calls are standard Vitest calls and should not
 * be transformed (they would reference `__ctx` which is only defined inside a
 * transformed `given()` callback).
 */
function collectBddCalls(sourceFile: ts.SourceFile): BddCall[] {
  const calls: BddCall[] = [];

  function visit(node: ts.Node, depth: number, insideGiven: boolean): void {
    if (ts.isCallExpression(node)) {
      const parsed = parseBddCall(node);
      if (parsed) {
        // Only collect `when` and `it` if they are inside a `given` block.
        // Top-level `it()` / `when()` calls are standard Vitest and must not
        // be rewritten.
        if (parsed.kind === "given" || insideGiven) {
          calls.push({
            kind: parsed.kind,
            node,
            depth,
            modifier: parsed.modifier,
          });
        }
        const nowInsideGiven = insideGiven || parsed.kind === "given";
        // Continue visiting children at deeper depth
        ts.forEachChild(node, (child) => {
          visit(child, depth + 1, nowInsideGiven);
        });
        return;
      }
    }
    ts.forEachChild(node, (child) => {
      visit(child, depth, insideGiven);
    });
  }

  ts.forEachChild(sourceFile, (child) => {
    visit(child, 0, false);
  });
  return calls;
}

/**
 * Get the source text for a range from the original code.
 */
function getNodeText(code: string, node: ts.Node): string {
  return code.slice(node.getStart(), node.getEnd());
}

/**
 * Check if an expression is (or wraps via `as` / `satisfies`) an object literal.
 * Returns true for: `{ ... }`, `{ ... } as T`, `{ ... } satisfies T`, etc.
 */
function isObjectLiteralLike(node: ts.Expression): boolean {
  if (ts.isObjectLiteralExpression(node)) return true;
  if (ts.isAsExpression(node)) return isObjectLiteralLike(node.expression);
  if (ts.isSatisfiesExpression(node)) return isObjectLiteralLike(node.expression);
  if (ts.isParenthesizedExpression(node)) return isObjectLiteralLike(node.expression);
  return false;
}

/**
 * Find the arrow function or function expression callback (last arg that is a function).
 */
function getCallbackArg(node: ts.CallExpression): ts.ArrowFunction | ts.FunctionExpression | null {
  for (let i = node.arguments.length - 1; i >= 0; i--) {
    const arg = node.arguments[i];
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
      return arg;
    }
  }
  return null;
}

/**
 * Get the body statements of a callback (arrow function or function expression).
 * Returns null if the body is a single expression (no block).
 */
function getBodyStatements(
  callback: ts.ArrowFunction | ts.FunctionExpression,
): ts.Statement[] | null {
  if (ts.isBlock(callback.body)) {
    return Array.from(callback.body.statements);
  }
  return null;
}

/**
 * Get the end position of the callback "header" (everything before the body).
 * For arrow functions: ends after `=>`
 * For function expressions: ends after `)` (before body block)
 */
function getCallbackHeaderEnd(callback: ts.ArrowFunction | ts.FunctionExpression): number {
  if (ts.isArrowFunction(callback)) {
    return callback.equalsGreaterThanToken.getEnd();
  }
  // For function expressions, the body starts right at the block
  return callback.body.getStart();
}

/**
 * Check if a statement is `$inputs = EXPR` (assignment to $inputs).
 */
function isInputsAssignment(stmt: ts.Statement): stmt is ts.ExpressionStatement & {
  expression: ts.BinaryExpression;
} {
  if (!ts.isExpressionStatement(stmt)) return false;
  const expr = stmt.expression;
  if (!ts.isBinaryExpression(expr)) return false;
  if (expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  return ts.isIdentifier(expr.left) && expr.left.text === "$inputs";
}

/**
 * Check if a statement is `$subject = EXPR` (assignment to $subject).
 */
function isSubjectAssignment(stmt: ts.Statement): stmt is ts.ExpressionStatement & {
  expression: ts.BinaryExpression;
} {
  if (!ts.isExpressionStatement(stmt)) return false;
  const expr = stmt.expression;
  if (!ts.isBinaryExpression(expr)) return false;
  if (expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  return ts.isIdentifier(expr.left) && expr.left.text === "$subject";
}

/**
 * Check if a statement is a `$inputs.PROP = EXPR` modifier assignment.
 */
function isInputsModifier(stmt: ts.Statement): boolean {
  if (!ts.isExpressionStatement(stmt)) return false;
  const expr = stmt.expression;
  if (!ts.isBinaryExpression(expr)) return false;
  if (expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  if (!ts.isPropertyAccessExpression(expr.left)) return false;
  return ts.isIdentifier(expr.left.expression) && expr.left.expression.text === "$inputs";
}

/**
 * Check if a statement is an it() call (or it.skip/it.only).
 */
function isItCall(stmt: ts.Statement): boolean {
  if (!ts.isExpressionStatement(stmt)) return false;
  if (!ts.isCallExpression(stmt.expression)) return false;
  const parsed = parseBddCall(stmt.expression);
  return parsed !== null && parsed.kind === "it";
}

/**
 * Check if a statement references $subject (but is not an it() call).
 */
function isPerformStatement(stmt: ts.Statement): boolean {
  if (isItCall(stmt)) return false;
  return referencesIdentifier(stmt, "$subject", true);
}

function transformGiven(call: BddCall, code: string, s: MagicString): void {
  const node = call.node;
  const callback = getCallbackArg(node);
  if (!callback) return;

  const stmts = getBodyStatements(callback);
  if (!stmts) return;

  // Find $inputs and $subject assignments
  let inputsExpr: string | null = null;
  let subjectExpr: string | null = null;
  const stmtsToRemove: ts.Statement[] = [];

  for (const stmt of stmts) {
    if (isInputsAssignment(stmt)) {
      const binExpr = stmt.expression as ts.BinaryExpression;
      const exprText = getNodeText(code, binExpr.right);
      // Wrap object literals (including those with `as T` / `satisfies T`) in parens
      inputsExpr = isObjectLiteralLike(binExpr.right) ? `(${exprText})` : exprText;
      stmtsToRemove.push(stmt);
    } else if (isSubjectAssignment(stmt)) {
      const binExpr = stmt.expression as ts.BinaryExpression;
      const exprText = getNodeText(code, binExpr.right);
      // Wrap object literals (including those with `as T` / `satisfies T`) in parens
      // so arrow function body isn't ambiguous
      subjectExpr = isObjectLiteralLike(binExpr.right) ? `(${exprText})` : exprText;
      stmtsToRemove.push(stmt);
    }
  }

  // Build config object
  const configParts: string[] = [];
  if (inputsExpr !== null) {
    configParts.push(`inputs: () => ${inputsExpr}`);
  }
  if (subjectExpr !== null) {
    configParts.push(`subject: ($inputs) => ${subjectExpr}`);
  }
  const configObj = `{ ${configParts.join(", ")} }`;

  // Remove $inputs and $subject assignment statements
  for (const stmt of stmtsToRemove) {
    // Remove the full statement including trailing newline
    let end = stmt.getEnd();
    while (end < code.length && (code[end] === "\n" || code[end] === "\r")) {
      end++;
    }
    s.remove(stmt.getStart(), end);
  }

  // Replace the callee: given( -> __given( or given.skip( -> __given(
  const calleeStart = node.expression.getStart();
  const calleeEnd = node.expression.getEnd();
  s.overwrite(calleeStart, calleeEnd, "__given");

  // Determine the position of the first argument (the description string)
  const descArg = node.arguments[0];
  const descEnd = descArg.getEnd();

  // Insert config object after description
  s.appendLeft(descEnd, `, ${configObj}`);

  // Transform the callback: () => { ... } -> (__ctx) => { ... }
  // Replace the parameter list
  const asyncPrefix = callback.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
    ? "async "
    : "";
  const callbackStart = callback.getStart();
  const headerEnd = getCallbackHeaderEnd(callback);
  s.overwrite(callbackStart, headerEnd, `${asyncPrefix}(__ctx) =>`);

  // Add skip/only modifier as last argument
  if (call.modifier) {
    // Find the closing paren of the call expression
    const lastArg = node.arguments[node.arguments.length - 1];
    s.appendLeft(lastArg.getEnd(), `, describe.${call.modifier}`);
  }
}

function transformWhen(call: BddCall, code: string, s: MagicString): void {
  const node = call.node;
  const callback = getCallbackArg(node);
  if (!callback) return;

  const stmts = getBodyStatements(callback);
  if (!stmts) return;

  // Classify statements
  const modifierStmts: ts.Statement[] = [];
  const performStmts: ts.Statement[] = [];
  const bodyStmts: ts.Statement[] = [];

  for (const stmt of stmts) {
    if (isInputsModifier(stmt)) {
      modifierStmts.push(stmt);
    } else if (isPerformStatement(stmt)) {
      performStmts.push(stmt);
    } else {
      bodyStmts.push(stmt);
    }
  }

  // Build config object parts
  const configParts: string[] = [];
  if (modifierStmts.length > 0) {
    const modifierBody = modifierStmts.map((stmt) => getNodeText(code, stmt)).join(" ");
    configParts.push(`modifier: ($inputs) => { ${modifierBody} }`);
  }
  if (performStmts.length > 0) {
    const performBody = performStmts.map((stmt) => getNodeText(code, stmt)).join(" ");
    configParts.push(`perform: ($subject) => { ${performBody} }`);
  }
  const configObj = `{ ${configParts.join(", ")} }`;

  // Remove modifier and perform statements from the body
  for (const stmt of [...modifierStmts, ...performStmts]) {
    let end = stmt.getEnd();
    while (end < code.length && (code[end] === "\n" || code[end] === "\r")) {
      end++;
    }
    s.remove(stmt.getStart(), end);
  }

  // Replace the callee
  const calleeStart = node.expression.getStart();
  const calleeEnd = node.expression.getEnd();
  s.overwrite(calleeStart, calleeEnd, "__when");

  // Insert config after description
  const descArg = node.arguments[0];
  s.appendLeft(descArg.getEnd(), `, ${configObj}`);

  // Transform callback params
  const asyncPrefix = callback.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
    ? "async "
    : "";
  const callbackStart = callback.getStart();
  const headerEnd = getCallbackHeaderEnd(callback);
  s.overwrite(callbackStart, headerEnd, `${asyncPrefix}(__ctx) =>`);

  // Append __ctx as second-to-last arg (after callback, before closing paren)
  const lastArg = node.arguments[node.arguments.length - 1];
  if (call.modifier) {
    s.appendLeft(lastArg.getEnd(), `, __ctx, describe.${call.modifier}`);
  } else {
    s.appendLeft(lastArg.getEnd(), ", __ctx");
  }
}

function transformIt(call: BddCall, code: string, s: MagicString): void {
  const node = call.node;
  const callback = getCallbackArg(node);
  if (!callback) return;

  // Replace callee
  const calleeStart = node.expression.getStart();
  const calleeEnd = node.expression.getEnd();
  s.overwrite(calleeStart, calleeEnd, "__it");

  // Add $subject parameter to callback
  const asyncPrefix = callback.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
    ? "async "
    : "";
  const callbackStart = callback.getStart();
  const headerEnd = getCallbackHeaderEnd(callback);
  s.overwrite(callbackStart, headerEnd, `${asyncPrefix}($subject) =>`);

  // Append __ctx as additional argument
  const lastArg = node.arguments[node.arguments.length - 1];
  if (call.modifier) {
    s.appendLeft(lastArg.getEnd(), `, __ctx, test.${call.modifier}`);
  } else {
    s.appendLeft(lastArg.getEnd(), ", __ctx");
  }
}

/**
 * Check if the source file explicitly imports `given` from a module.
 * If so, it's using the old API and should not be transformed.
 */
function importsGiven(sourceFile: ts.SourceFile): boolean {
  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      stmt.importClause?.namedBindings &&
      ts.isNamedImports(stmt.importClause.namedBindings)
    ) {
      for (const spec of stmt.importClause.namedBindings.elements) {
        if (spec.name.text === "given") {
          return true;
        }
      }
    }
  }
  return false;
}

export function transformBddSyntax(
  code: string,
  id: string,
): { code: string; map: ReturnType<MagicString["generateMap"]> } | null {
  const sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // Skip files that import `given` from a module (old API)
  if (importsGiven(sourceFile)) {
    return null;
  }

  const calls = collectBddCalls(sourceFile);
  if (calls.length === 0) {
    return null;
  }

  const s = new MagicString(code);

  // Sort by depth descending (deepest first = bottom-up)
  calls.sort((a, b) => b.depth - a.depth);

  const usedHelpers = new Set<string>();
  const usedVitestImports = new Set<string>();

  for (const call of calls) {
    switch (call.kind) {
      case "given":
        transformGiven(call, code, s);
        usedHelpers.add("__given");
        if (call.modifier) usedVitestImports.add("describe");
        break;
      case "when":
        transformWhen(call, code, s);
        usedHelpers.add("__when");
        if (call.modifier) usedVitestImports.add("describe");
        break;
      case "it":
        transformIt(call, code, s);
        usedHelpers.add("__it");
        if (call.modifier) usedVitestImports.add("test");
        break;
    }
  }

  // Add import statement at the top
  const helpers = Array.from(usedHelpers).sort().join(", ");
  let imports = `import { ${helpers} } from "@michaelhelvey/vitest-bdd/runtime";\n`;
  if (usedVitestImports.size > 0) {
    const vitestImports = Array.from(usedVitestImports).sort().join(", ");
    imports += `import { ${vitestImports} } from "vitest";\n`;
  }
  s.prepend(imports + "\n");

  return {
    code: s.toString(),
    map: s.generateMap({ source: id, hires: true }),
  };
}
