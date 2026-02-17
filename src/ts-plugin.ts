/* eslint-disable @typescript-eslint/no-unsafe-function-type, @typescript-eslint/no-unsafe-return */
import type ts from "typescript";

const TEST_FILE_PATTERN = /\.(spec|test)\.(ts|tsx)$/;
const SUPPRESSED_CODES = new Set([2304, 2552, 2580, 2362, 2363, 2322]);
const MAGIC_GLOBALS = ["$inputs", "$subject"];

function diagnosticMentionsMagicGlobal(diagnostic: ts.Diagnostic): boolean {
  const msg =
    typeof diagnostic.messageText === "string"
      ? diagnostic.messageText
      : diagnostic.messageText.messageText;

  return MAGIC_GLOBALS.some((name) => msg.includes(`'${name}'`));
}

function getFilteredDiagnostics(
  info: ts.server.PluginCreateInfo,
  fileName: string,
): ts.Diagnostic[] {
  const original = info.languageService.getSemanticDiagnostics(fileName);

  if (!TEST_FILE_PATTERN.test(fileName)) {
    return original;
  }

  return original.filter((d) => {
    if (SUPPRESSED_CODES.has(d.code) && diagnosticMentionsMagicGlobal(d)) {
      return false;
    }
    return true;
  });
}

/**
 * Returns the name of a call expression's callee if it's a simple identifier
 * or property access (e.g. `given` or `given.skip`).  Returns the base name
 * (`given`) in both cases.
 */
function getCallName(node: ts.CallExpression, typescript: typeof ts): string | undefined {
  const callee = node.expression;
  if (typescript.isIdentifier(callee)) {
    return callee.text;
  }
  if (typescript.isPropertyAccessExpression(callee) && typescript.isIdentifier(callee.expression)) {
    return callee.expression.text;
  }
  return undefined;
}

/**
 * Walk up the AST from `position` to find the nearest enclosing `given()` call.
 * Returns the callback (second argument) of that `given()` call, or undefined.
 */
function findEnclosingGivenCallback(
  sourceFile: ts.SourceFile,
  position: number,
  typescript: typeof ts,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  function walk(node: ts.Node): ts.ArrowFunction | ts.FunctionExpression | undefined {
    // Check if this node is a given() call containing our position
    if (
      typescript.isCallExpression(node) &&
      getCallName(node, typescript) === "given" &&
      node.arguments.length >= 2 &&
      position >= node.getStart() &&
      position < node.getEnd()
    ) {
      const callback = node.arguments[1];
      if (typescript.isArrowFunction(callback) || typescript.isFunctionExpression(callback)) {
        // Check if position is inside this callback
        if (position >= callback.getStart() && position < callback.getEnd()) {
          // Recurse into children to find a more deeply nested given(), if any
          let deeper: ts.ArrowFunction | ts.FunctionExpression | undefined;
          typescript.forEachChild(callback.body, (child) => {
            deeper ??= walk(child);
          });
          return deeper ?? callback;
        }
      }
    }

    // Recurse into children
    let found: ts.ArrowFunction | ts.FunctionExpression | undefined;
    typescript.forEachChild(node, (child) => {
      found ??= walk(child);
    });
    return found;
  }

  return walk(sourceFile);
}

/**
 * Within a `given` callback body, find `$inputs = expr` or `$subject = expr`
 * and return the RHS expression node.
 */
function findMagicAssignment(
  callbackBody: ts.ConciseBody,
  globalName: string,
  typescript: typeof ts,
): ts.Expression | undefined {
  return findMagicAssignmentStatement(callbackBody, globalName, typescript)?.right;
}

/**
 * Within a `given` callback body, find the binary expression `$inputs = expr`
 * or `$subject = expr` and return the full assignment expression.
 */
function findMagicAssignmentStatement(
  callbackBody: ts.ConciseBody,
  globalName: string,
  typescript: typeof ts,
): ts.BinaryExpression | undefined {
  if (!typescript.isBlock(callbackBody)) {
    return undefined;
  }

  for (const stmt of callbackBody.statements) {
    if (!typescript.isExpressionStatement(stmt)) continue;
    const expr = stmt.expression;

    if (!typescript.isBinaryExpression(expr)) continue;
    if (expr.operatorToken.kind !== typescript.SyntaxKind.EqualsToken) continue;

    const left = expr.left;
    if (typescript.isIdentifier(left) && left.text === globalName) {
      return expr;
    }
  }

  return undefined;
}

/**
 * Detect whether the cursor is right after `$inputs.` or `$subject.` and return
 * which magic global is being accessed.
 */
function getMagicGlobalAtDot(sourceFile: ts.SourceFile, position: number): string | undefined {
  // Find the node at the position. We're looking for patterns where the user
  // typed `$inputs.` and the cursor is right after the dot.
  // TypeScript may parse this as a PropertyAccessExpression with a missing name,
  // or the position may be right after a dot token following an identifier.

  // Strategy: look at the text before the cursor for `$inputs.` or `$subject.`
  const textBefore = sourceFile.text.substring(
    Math.max(0, position - "$subject.".length),
    position,
  );

  for (const name of MAGIC_GLOBALS) {
    if (textBefore.endsWith(name + ".")) {
      return name;
    }
  }
  return undefined;
}

/**
 * Given a type, return the names of its properties as completion entries.
 */
function getPropertyCompletions(type: ts.Type, typescript: typeof ts): ts.CompletionEntry[] {
  const properties = type.getProperties();
  return properties.map((prop) => ({
    name: prop.name,
    kind: typescript.ScriptElementKind.memberVariableElement,
    kindModifiers: "",
    sortText: "0",
  }));
}

/**
 * Check if the cursor position is on a `$inputs` or `$subject` identifier.
 * Returns the magic global name if so, undefined otherwise.
 */
function getMagicGlobalAtPosition(
  sourceFile: ts.SourceFile,
  position: number,
  typescript: typeof ts,
): string | undefined {
  function findAtPosition(node: ts.Node): ts.Identifier | undefined {
    if (
      typescript.isIdentifier(node) &&
      MAGIC_GLOBALS.includes(node.text) &&
      position >= node.getStart() &&
      position < node.getEnd()
    ) {
      return node;
    }
    let found: ts.Identifier | undefined;
    typescript.forEachChild(node, (child) => {
      found ??= findAtPosition(child);
    });
    return found;
  }

  const ident = findAtPosition(sourceFile);
  return ident?.text;
}

/**
 * Infer the type of a magic global ($inputs or $subject) from its assignment
 * in the enclosing given block, and return a serialized type string.
 */
function inferMagicGlobalType(
  info: ts.server.PluginCreateInfo,
  fileName: string,
  position: number,
  globalName: string,
  typescript: typeof ts,
): { typeString: string; sourceFile: ts.SourceFile } | undefined {
  const program = info.languageService.getProgram();
  if (!program) return undefined;

  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) return undefined;

  const callback = findEnclosingGivenCallback(sourceFile, position, typescript);
  if (!callback) return undefined;

  const rhsExpr = findMagicAssignment(callback.body, globalName, typescript);
  if (!rhsExpr) return undefined;

  const checker = program.getTypeChecker();
  const rhsType = checker.getTypeAtLocation(rhsExpr);
  const typeString = checker.typeToString(rhsType);

  return { typeString, sourceFile };
}

function getQuickInfoForMagicGlobal(
  info: ts.server.PluginCreateInfo,
  fileName: string,
  position: number,
  typescript: typeof ts,
): ts.QuickInfo | undefined {
  if (!TEST_FILE_PATTERN.test(fileName)) {
    return undefined;
  }

  const program = info.languageService.getProgram();
  if (!program) return undefined;

  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) return undefined;

  const globalName = getMagicGlobalAtPosition(sourceFile, position, typescript);
  if (!globalName) return undefined;

  const result = inferMagicGlobalType(info, fileName, position, globalName, typescript);
  if (!result) return undefined;

  // Find the identifier node to get its text span
  const text = result.sourceFile.text;
  const start = text.lastIndexOf(globalName, position);
  if (start === -1) return undefined;

  return {
    kind: typescript.ScriptElementKind.variableElement,
    kindModifiers: "",
    textSpan: { start, length: globalName.length },
    displayParts: [
      { text: "let ", kind: "keyword" },
      { text: globalName, kind: "localName" },
      { text: ": ", kind: "punctuation" },
      { text: result.typeString, kind: "text" },
    ],
    documentation: [],
    tags: [],
  };
}

function getCompletionsForMagicGlobal(
  info: ts.server.PluginCreateInfo,
  fileName: string,
  position: number,
  typescript: typeof ts,
): ts.CompletionInfo | undefined {
  if (!TEST_FILE_PATTERN.test(fileName)) {
    return undefined;
  }

  const program = info.languageService.getProgram();
  if (!program) return undefined;

  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) return undefined;

  const magicGlobal = getMagicGlobalAtDot(sourceFile, position);
  if (!magicGlobal) return undefined;

  const callback = findEnclosingGivenCallback(sourceFile, position, typescript);
  if (!callback) return undefined;

  const rhsExpr = findMagicAssignment(callback.body, magicGlobal, typescript);
  if (!rhsExpr) return undefined;

  const checker = program.getTypeChecker();
  const rhsType = checker.getTypeAtLocation(rhsExpr);

  const entries = getPropertyCompletions(rhsType, typescript);
  if (entries.length === 0) return undefined;

  return {
    isGlobalCompletion: false,
    isMemberCompletion: true,
    isNewIdentifierLocation: false,
    entries,
  };
}

function getDefinitionForMagicGlobal(
  info: ts.server.PluginCreateInfo,
  fileName: string,
  position: number,
  typescript: typeof ts,
): readonly ts.DefinitionInfo[] | undefined {
  if (!TEST_FILE_PATTERN.test(fileName)) {
    return undefined;
  }

  const program = info.languageService.getProgram();
  if (!program) return undefined;

  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) return undefined;

  const globalName = getMagicGlobalAtPosition(sourceFile, position, typescript);
  if (!globalName) return undefined;

  const callback = findEnclosingGivenCallback(sourceFile, position, typescript);
  if (!callback) return undefined;

  const assignment = findMagicAssignmentStatement(callback.body, globalName, typescript);
  if (!assignment) return undefined;

  return [
    {
      fileName,
      textSpan: { start: assignment.getStart(), length: assignment.getWidth() },
      kind: typescript.ScriptElementKind.variableElement,
      name: globalName,
      containerName: "",
      containerKind: typescript.ScriptElementKind.unknown,
    },
  ];
}

function createLanguageServiceProxy(
  info: ts.server.PluginCreateInfo,
  typescript: typeof ts,
): ts.LanguageService {
  const proxy = Object.create(null) as ts.LanguageService;

  for (const key of Object.keys(info.languageService) as (keyof ts.LanguageService)[]) {
    const original = info.languageService[key];
    if (typeof original === "function") {
      (proxy as unknown as Record<string, unknown>)[key] = (...args: unknown[]) =>
        (original as Function).apply(info.languageService, args);
    } else {
      (proxy as unknown as Record<string, unknown>)[key] = original;
    }
  }

  proxy.getSemanticDiagnostics = (fileName: string) => {
    return getFilteredDiagnostics(info, fileName);
  };

  proxy.getCompletionsAtPosition = (
    fileName: string,
    position: number,
    options: ts.GetCompletionsAtPositionOptions | undefined,
  ) => {
    const custom = getCompletionsForMagicGlobal(info, fileName, position, typescript);
    if (custom) return custom;
    return info.languageService.getCompletionsAtPosition(fileName, position, options);
  };

  proxy.getQuickInfoAtPosition = (fileName: string, position: number) => {
    const custom = getQuickInfoForMagicGlobal(info, fileName, position, typescript);
    if (custom) return custom;
    return info.languageService.getQuickInfoAtPosition(fileName, position);
  };

  proxy.getDefinitionAtPosition = (fileName: string, position: number) => {
    const custom = getDefinitionForMagicGlobal(info, fileName, position, typescript);
    if (custom) return custom;
    return info.languageService.getDefinitionAtPosition(fileName, position);
  };

  return proxy;
}

const pluginModuleFactory: ts.server.PluginModuleFactory = ({ typescript }) => {
  return {
    create(info: ts.server.PluginCreateInfo): ts.LanguageService {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- may be undefined in unit tests
      info.project?.projectService?.logger?.info("[vitest-bdd] Plugin loaded successfully");
      return createLanguageServiceProxy(info, typescript);
    },
  };
};

export default pluginModuleFactory;
