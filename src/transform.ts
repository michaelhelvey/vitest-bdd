import MagicString from "magic-string";
import { parseSync, type ESTree } from "vite-plus";

type BddCallKind = "given" | "when" | "it";

type Callback = ESTree.ArrowFunctionExpression | ESTree.Function;

interface BddCall {
  kind: BddCallKind;
  node: ESTree.CallExpression;
  depth: number;
  modifier?: "skip" | "only";
}

function isNode(value: unknown): value is ESTree.Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/**
 * Get the direct child nodes of a node, in source order.
 */
function childNodes(node: ESTree.Node): ESTree.Node[] {
  const children: ESTree.Node[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(value)) {
      children.push(...value.filter(isNode));
    } else if (isNode(value)) {
      children.push(value);
    }
  }
  return children;
}

function isIdentifierNamed(node: ESTree.Node, name: string): boolean {
  return (node.type === "Identifier" || node.type === "JSXIdentifier") && node.name === name;
}

/**
 * Checks if a node references a specific identifier name anywhere in its subtree.
 * Optionally skips descending into `it()` callback arguments.
 */
function referencesIdentifier(node: ESTree.Node, name: string, skipItCallbacks: boolean): boolean {
  if (isIdentifierNamed(node, name)) {
    return true;
  }

  // Skip descending into BDD call callback bodies (it, when, given)
  // since those are transformed separately
  if (skipItCallbacks && node.type === "CallExpression" && parseBddCall(node)) {
    // Only check the first arg (description), skip callback
    const firstArg = node.arguments[0] as ESTree.Node | undefined;
    return firstArg !== undefined && referencesIdentifier(firstArg, name, skipItCallbacks);
  }

  return childNodes(node).some((child) => referencesIdentifier(child, name, skipItCallbacks));
}

/**
 * Detect whether a call expression is a BDD call (given/when/it), potentially
 * with a .skip or .only modifier.
 */
function parseBddCall(
  node: ESTree.CallExpression,
): { kind: BddCallKind; modifier?: "skip" | "only" } | null {
  const expr = node.callee;

  // Direct call: given(...), when(...), it(...)
  if (expr.type === "Identifier") {
    const name = expr.name;
    if (name === "given" || name === "when" || name === "it") {
      return { kind: name };
    }
    return null;
  }

  // Property access: given.skip(...), when.only(...), etc.
  if (expr.type === "MemberExpression" && !expr.computed) {
    const obj = expr.object;
    const prop = expr.property.name;
    if (
      obj.type === "Identifier" &&
      (obj.name === "given" || obj.name === "when" || obj.name === "it") &&
      (prop === "skip" || prop === "only")
    ) {
      return { kind: obj.name, modifier: prop };
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
function collectBddCalls(program: ESTree.Program): BddCall[] {
  const calls: BddCall[] = [];

  function visit(node: ESTree.Node, depth: number, insideGiven: boolean): void {
    const parsed = node.type === "CallExpression" ? parseBddCall(node) : null;
    if (node.type === "CallExpression" && parsed) {
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
      for (const child of childNodes(node)) {
        visit(child, depth + 1, nowInsideGiven);
      }
      return;
    }
    for (const child of childNodes(node)) {
      visit(child, depth, insideGiven);
    }
  }

  for (const child of childNodes(program)) {
    visit(child, 0, false);
  }
  return calls;
}

/**
 * Get the source text for a range from the original code.
 */
function getNodeText(code: string, node: ESTree.Node): string {
  return code.slice(node.start, node.end);
}

/**
 * Check if an expression is (or wraps via `as` / `satisfies`) an object literal.
 * Returns true for: `{ ... }`, `{ ... } as T`, `{ ... } satisfies T`, etc.
 */
function isObjectLiteralLike(node: ESTree.Expression): boolean {
  switch (node.type) {
    case "ObjectExpression":
      return true;
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "ParenthesizedExpression":
      return isObjectLiteralLike(node.expression);
    default:
      return false;
  }
}

/**
 * Find the arrow function or function expression callback (last arg that is a function).
 */
function getCallbackArg(node: ESTree.CallExpression): Callback | null {
  for (let i = node.arguments.length - 1; i >= 0; i--) {
    const arg = node.arguments[i];
    if (arg.type === "ArrowFunctionExpression" || arg.type === "FunctionExpression") {
      return arg;
    }
  }
  return null;
}

/**
 * Get the body statements of a callback (arrow function or function expression).
 * Returns null if the body is a single expression (no block).
 */
function getBodyStatements(callback: Callback): ESTree.Statement[] | null {
  const body = callback.body;
  if (body?.type === "BlockStatement") {
    return body.body;
  }
  return null;
}

/**
 * Replace the callback "header" (everything before the body) with an arrow function header.
 */
function overwriteCallbackHeader(s: MagicString, callback: Callback, params: string): void {
  const body = callback.body;
  if (!body) throw new Error("vitest-bdd: a BDD callback must have a body");
  const asyncPrefix = callback.async ? "async " : "";
  s.overwrite(callback.start, body.start, `${asyncPrefix}(${params}) => `);
}

/**
 * Get the assignment expression of a statement like `NAME = EXPR`, or null.
 */
function getAssignment(stmt: ESTree.Statement): ESTree.AssignmentExpression | null {
  if (stmt.type !== "ExpressionStatement") return null;
  const expr = stmt.expression;
  if (expr.type !== "AssignmentExpression" || expr.operator !== "=") return null;
  return expr;
}

/**
 * Get the assignment of a statement that is `NAME = EXPR` for the given identifier.
 */
function getAssignmentTo(stmt: ESTree.Statement, name: string): ESTree.AssignmentExpression | null {
  const assignment = getAssignment(stmt);
  return assignment && isIdentifierNamed(assignment.left, name) ? assignment : null;
}

/**
 * Check if a statement is a `$inputs.PROP = EXPR` modifier assignment.
 * Supports nested property access like `$inputs.foo.bar = EXPR`.
 */
function isInputsModifier(stmt: ESTree.Statement): boolean {
  const assignment = getAssignment(stmt);
  if (!assignment) return false;
  let current: ESTree.Node = assignment.left;
  if (current.type !== "MemberExpression" || current.computed) return false;
  // Walk the property access chain to find $inputs at the root
  while (current.type === "MemberExpression" && !current.computed) {
    current = current.object;
  }
  return isIdentifierNamed(current, "$inputs");
}

/**
 * Check if a statement is an it() call (or it.skip/it.only).
 */
function isItCall(stmt: ESTree.Statement): boolean {
  if (stmt.type !== "ExpressionStatement") return false;
  if (stmt.expression.type !== "CallExpression") return false;
  return parseBddCall(stmt.expression)?.kind === "it";
}

/**
 * Check if a statement references $subject (but is not an it() call).
 */
function isPerformStatement(stmt: ESTree.Statement): boolean {
  if (isItCall(stmt)) return false;
  return referencesIdentifier(stmt, "$subject", true);
}

/**
 * Remove a statement, including the line breaks that follow it.
 */
function removeStatement(code: string, s: MagicString, stmt: ESTree.Statement): void {
  let end = stmt.end;
  while (end < code.length && (code[end] === "\n" || code[end] === "\r")) {
    end++;
  }
  s.remove(stmt.start, end);
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
  const stmtsToRemove: ESTree.Statement[] = [];

  for (const stmt of stmts) {
    const inputs = getAssignmentTo(stmt, "$inputs");
    const subject = getAssignmentTo(stmt, "$subject");
    if (inputs) {
      const exprText = getNodeText(code, inputs.right);
      // Wrap object literals (including those with `as T` / `satisfies T`) in parens
      inputsExpr = isObjectLiteralLike(inputs.right) ? `(${exprText})` : exprText;
      stmtsToRemove.push(stmt);
    } else if (subject) {
      const exprText = getNodeText(code, subject.right);
      // Wrap object literals (including those with `as T` / `satisfies T`) in parens
      // so arrow function body isn't ambiguous
      subjectExpr = isObjectLiteralLike(subject.right) ? `(${exprText})` : exprText;
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
    removeStatement(code, s, stmt);
  }

  // Replace the callee: given( -> __given( or given.skip( -> __given(
  s.overwrite(node.callee.start, node.callee.end, "__given");

  // Insert config object after description
  s.appendLeft(node.arguments[0].end, `, ${configObj}`);

  // Transform the callback: () => { ... } -> (__ctx) => { ... }
  overwriteCallbackHeader(s, callback, "__ctx");

  // Add skip/only modifier as last argument
  if (call.modifier) {
    const lastArg = node.arguments[node.arguments.length - 1];
    s.appendLeft(lastArg.end, `, describe.${call.modifier}`);
  }
}

function transformWhen(call: BddCall, code: string, s: MagicString): void {
  const node = call.node;
  const callback = getCallbackArg(node);
  if (!callback) return;

  const stmts = getBodyStatements(callback);
  if (!stmts) return;

  // Classify statements
  const modifierStmts: ESTree.Statement[] = [];
  const performStmts: ESTree.Statement[] = [];

  for (const stmt of stmts) {
    if (isInputsModifier(stmt)) {
      modifierStmts.push(stmt);
    } else if (isPerformStatement(stmt)) {
      performStmts.push(stmt);
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
    removeStatement(code, s, stmt);
  }

  // Replace the callee
  s.overwrite(node.callee.start, node.callee.end, "__when");

  // Insert config after description
  s.appendLeft(node.arguments[0].end, `, ${configObj}`);

  // Transform callback params
  overwriteCallbackHeader(s, callback, "__ctx");

  // Append __ctx as second-to-last arg (after callback, before closing paren)
  const lastArg = node.arguments[node.arguments.length - 1];
  if (call.modifier) {
    s.appendLeft(lastArg.end, `, __ctx, describe.${call.modifier}`);
  } else {
    s.appendLeft(lastArg.end, ", __ctx");
  }
}

function transformIt(call: BddCall, s: MagicString): void {
  const node = call.node;
  const callback = getCallbackArg(node);
  if (!callback) return;

  // Replace callee
  s.overwrite(node.callee.start, node.callee.end, "__it");

  // Add $subject parameter to callback
  overwriteCallbackHeader(s, callback, "$inputs, $subject");

  // Append __ctx as additional argument
  const lastArg = node.arguments[node.arguments.length - 1];
  if (call.modifier) {
    s.appendLeft(lastArg.end, `, __ctx, test.${call.modifier}`);
  } else {
    s.appendLeft(lastArg.end, ", __ctx");
  }
}

/**
 * Check if the source file explicitly imports `given` from a module.
 * If so, it's using the old API and should not be transformed.
 */
function importsGiven(program: ESTree.Program): boolean {
  return program.body.some(
    (stmt) =>
      stmt.type === "ImportDeclaration" &&
      stmt.specifiers.some(
        (spec) => spec.type === "ImportSpecifier" && spec.local.name === "given",
      ),
  );
}

export function transformBddSyntax(
  code: string,
  id: string,
): { code: string; map: ReturnType<MagicString["generateMap"]> } | null {
  const { program, errors } = parseSync(id, code, { lang: id.endsWith(".ts") ? "ts" : "tsx" });

  // Leave files with syntax errors to the next transform, which reports them
  if (errors.length > 0) {
    return null;
  }

  // Skip files that import `given` from a module (old API)
  if (importsGiven(program)) {
    return null;
  }

  const calls = collectBddCalls(program);
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
        transformIt(call, s);
        usedHelpers.add("__it");
        if (call.modifier) usedVitestImports.add("test");
        break;
    }
  }

  // Add import statement at the top
  const helpers = Array.from(usedHelpers).toSorted().join(", ");
  let imports = `import { ${helpers} } from "@michaelhelvey/vitest-bdd/runtime";\n`;
  if (usedVitestImports.size > 0) {
    const vitestImports = Array.from(usedVitestImports).toSorted().join(", ");
    imports += `import { ${vitestImports} } from "vite-plus/test";\n`;
  }
  s.prepend(imports + "\n");

  return {
    code: s.toString(),
    map: s.generateMap({ source: id, hires: true }),
  };
}
