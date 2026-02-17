import ts from "typescript";
import { describe, expect, test } from "vitest";
import pluginFactory from "./ts-plugin.ts";

function diagnosticMessages(diagnostics: readonly ts.Diagnostic[]): string[] {
  return diagnostics.map((d) =>
    typeof d.messageText === "string" ? d.messageText : d.messageText.messageText,
  );
}

function createTestService(files: Record<string, string>) {
  const fileVersions: Record<string, number> = {};
  for (const f of Object.keys(files)) {
    fileVersions[f] = 1;
  }

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      strict: true,
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
    }),
    getScriptFileNames: () => Object.keys(files),
    getScriptVersion: (fileName) => String(fileVersions[fileName] ?? 0),
    getScriptSnapshot: (fileName) => {
      if (fileName in files) {
        return ts.ScriptSnapshot.fromString(files[fileName]);
      }
      if (ts.sys.fileExists(fileName)) {
        return ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName)!);
      }
      return undefined;
    },
    getCurrentDirectory: () => "/",
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    readFile: (path) => {
      if (path in files) return files[path];
      return ts.sys.readFile(path);
    },
    fileExists: (path) => path in files || ts.sys.fileExists(path),
  };

  const languageService = ts.createLanguageService(host);

  const pluginModule = pluginFactory({ typescript: ts });
  const pluginCreateInfo = {
    languageService,
    languageServiceHost: host,
    project: {},
    serverHost: {},
    config: {},
  } as unknown as ts.server.PluginCreateInfo;

  const proxiedService = pluginModule.create(pluginCreateInfo);

  return { service: proxiedService, rawService: languageService };
}

/** Find the position right after `marker` in `source`. */
function positionAfter(source: string, marker: string): number {
  const idx = source.indexOf(marker);
  if (idx === -1) throw new Error(`Marker "${marker}" not found in source`);
  return idx + marker.length;
}

/** Extract completion entry names from a completions result. */
function completionNames(result: ts.CompletionInfo | undefined): string[] {
  return result?.entries.map((e) => e.name) ?? [];
}

describe("ts-plugin", () => {
  describe("diagnostic suppression", () => {
    test("plugin factory returns a valid LanguageService proxy", () => {
      const pluginModule = pluginFactory({ typescript: ts });
      expect(pluginModule).toHaveProperty("create");
      expect(typeof pluginModule.create).toBe("function");

      const mockInfo = {
        languageService: { getSemanticDiagnostics: () => [] },
        languageServiceHost: {},
        project: {},
        serverHost: {},
        config: {},
      } as unknown as ts.server.PluginCreateInfo;

      const result = pluginModule.create(mockInfo);
      expect(typeof result.getSemanticDiagnostics).toBe("function");
    });

    test("non-test files pass diagnostics through unfiltered", () => {
      const { service } = createTestService({
        "/app.ts": `const x: string = $inputs;`,
      });

      const diagnostics = service.getSemanticDiagnostics("/app.ts");
      const messages = diagnosticMessages(diagnostics);

      expect(messages.some((m) => m.includes("$inputs"))).toBe(true);
    });

    test("suppresses $inputs 'Cannot find name' in test files", () => {
      const { service, rawService } = createTestService({
        "/test.spec.ts": `$inputs = { value: 0 };`,
      });

      const rawDiagnostics = rawService.getSemanticDiagnostics("/test.spec.ts");
      const rawMessages = diagnosticMessages(rawDiagnostics);
      expect(rawMessages.some((m) => m.includes("$inputs"))).toBe(true);

      const filteredDiagnostics = service.getSemanticDiagnostics("/test.spec.ts");
      const filteredMessages = diagnosticMessages(filteredDiagnostics);
      expect(filteredMessages.some((m) => m.includes("$inputs"))).toBe(false);
    });

    test("suppresses $subject 'Cannot find name' in test files", () => {
      const { service, rawService } = createTestService({
        "/test.spec.ts": `$subject = { value: 0 };`,
      });

      const rawDiagnostics = rawService.getSemanticDiagnostics("/test.spec.ts");
      const rawMessages = diagnosticMessages(rawDiagnostics);
      expect(rawMessages.some((m) => m.includes("$subject"))).toBe(true);

      const filteredDiagnostics = service.getSemanticDiagnostics("/test.spec.ts");
      const filteredMessages = diagnosticMessages(filteredDiagnostics);
      expect(filteredMessages.some((m) => m.includes("$subject"))).toBe(false);
    });

    test("preserves non-magic-global diagnostics alongside suppressed ones", () => {
      const { service } = createTestService({
        "/test.spec.ts": [`$inputs = { value: 0 };`, `const x: number = "hello";`].join("\n"),
      });

      const diagnostics = service.getSemanticDiagnostics("/test.spec.ts");
      const messages = diagnosticMessages(diagnostics);

      expect(messages.some((m) => m.includes("$inputs"))).toBe(false);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(messages.some((m) => m.includes("not assignable"))).toBe(true);
    });

    test.each(["/component.test.ts", "/component.spec.tsx"] as const)(
      "filters diagnostics for %s file extension",
      (fileName) => {
        const { service } = createTestService({
          [fileName]: `$inputs = { value: 0 };`,
        });

        const diagnostics = service.getSemanticDiagnostics(fileName);
        const messages = diagnosticMessages(diagnostics);
        expect(messages.some((m) => m.includes("$inputs"))).toBe(false);
      },
    );
  });

  describe("completions", () => {
    test("provides $inputs property completions from object literal", () => {
      const source = [
        `given("a thing", () => {`,
        `  $inputs = { name: "hello", count: 42 };`,
        `  $inputs.`,
        `});`,
      ].join("\n");

      const { service } = createTestService({ "/test.spec.ts": source });
      const pos = positionAfter(source, "$inputs.");
      const result = service.getCompletionsAtPosition("/test.spec.ts", pos, undefined);
      const names = completionNames(result);

      expect(names).toContain("name");
      expect(names).toContain("count");
    });

    test("provides $subject property completions from class instance", () => {
      const source = [
        `class Foo { value = 0; greet() { return "hi"; } }`,
        `given("a Foo", () => {`,
        `  $subject = new Foo();`,
        `  $subject.`,
        `});`,
      ].join("\n");

      const { service } = createTestService({ "/test.spec.ts": source });
      const pos = positionAfter(source, "$subject.");
      const result = service.getCompletionsAtPosition("/test.spec.ts", pos, undefined);
      const names = completionNames(result);

      expect(names).toContain("value");
      expect(names).toContain("greet");
    });

    test("provides completions inside when blocks", () => {
      const source = [
        `given("a thing", () => {`,
        `  $inputs = { x: 1, y: 2 };`,
        `  when("something", () => {`,
        `    $inputs.`,
        `  });`,
        `});`,
      ].join("\n");

      const { service } = createTestService({ "/test.spec.ts": source });
      const pos = positionAfter(source, "$inputs.");
      const result = service.getCompletionsAtPosition("/test.spec.ts", pos, undefined);
      const names = completionNames(result);

      expect(names).toContain("x");
      expect(names).toContain("y");
    });

    test("provides completions inside it blocks", () => {
      const source = [
        `class Bar { result = true; }`,
        `given("a Bar", () => {`,
        `  $subject = new Bar();`,
        `  it("works", () => {`,
        `    $subject.`,
        `  });`,
        `});`,
      ].join("\n");

      const { service } = createTestService({ "/test.spec.ts": source });
      const pos = positionAfter(source, "$subject.");
      const result = service.getCompletionsAtPosition("/test.spec.ts", pos, undefined);
      const names = completionNames(result);

      expect(names).toContain("result");
    });

    test("does not provide custom completions in non-test files", () => {
      const source = [
        `given("a thing", () => {`,
        `  $inputs = { value: 1 };`,
        `  $inputs.`,
        `});`,
      ].join("\n");

      const { service, rawService } = createTestService({ "/app.ts": source });
      const pos = positionAfter(source, "$inputs.");

      const pluginResult = service.getCompletionsAtPosition("/app.ts", pos, undefined);
      const rawResult = rawService.getCompletionsAtPosition("/app.ts", pos, undefined);

      // Should pass through to the raw service, not inject custom completions
      expect(completionNames(pluginResult)).toEqual(completionNames(rawResult));
    });

    test("does not provide custom completions outside given blocks", () => {
      const source = [`const obj = { a: 1 };`, `$inputs.`].join("\n");

      const { service, rawService } = createTestService({ "/test.spec.ts": source });
      const pos = positionAfter(source, "$inputs.");

      const pluginResult = service.getCompletionsAtPosition("/test.spec.ts", pos, undefined);
      const rawResult = rawService.getCompletionsAtPosition("/test.spec.ts", pos, undefined);

      expect(completionNames(pluginResult)).toEqual(completionNames(rawResult));
    });

    test("scopes completions to the correct given block", () => {
      const source = [
        `given("first", () => {`,
        `  $inputs = { alpha: 1 };`,
        `});`,
        `given("second", () => {`,
        `  $inputs = { beta: 2 };`,
        `  $inputs.`,
        `});`,
      ].join("\n");

      const { service } = createTestService({ "/test.spec.ts": source });
      const pos = positionAfter(source, "$inputs.");
      const result = service.getCompletionsAtPosition("/test.spec.ts", pos, undefined);
      const names = completionNames(result);

      expect(names).toContain("beta");
      expect(names).not.toContain("alpha");
    });
  });

  describe("hover info", () => {
    test("shows inferred type for $inputs on hover", () => {
      const source = [
        `given("a thing", () => {`,
        `  $inputs = { name: "hello", count: 42 };`,
        `  $inputs;`,
        `});`,
      ].join("\n");

      const { service } = createTestService({ "/test.spec.ts": source });
      // Position the cursor on the second `$inputs` (the standalone reference)
      const hoverPos = source.lastIndexOf("$inputs");
      const result = service.getQuickInfoAtPosition("/test.spec.ts", hoverPos);

      expect(result).toBeDefined();
      expect(result!.displayParts?.map((p) => p.text).join("")).toContain("name");
      expect(result!.displayParts?.map((p) => p.text).join("")).toContain("count");
    });

    test("shows inferred type for $subject on hover", () => {
      const source = [
        `class Foo { value = 0; }`,
        `given("a Foo", () => {`,
        `  $subject = new Foo();`,
        `  $subject;`,
        `});`,
      ].join("\n");

      const { service } = createTestService({ "/test.spec.ts": source });
      const hoverPos = source.lastIndexOf("$subject");
      const result = service.getQuickInfoAtPosition("/test.spec.ts", hoverPos);

      expect(result).toBeDefined();
      expect(result!.displayParts?.map((p) => p.text).join("")).toContain("Foo");
    });

    test("does not provide hover info outside given blocks", () => {
      const source = `const $inputs = 42;`;

      const { service, rawService } = createTestService({ "/test.spec.ts": source });
      const hoverPos = source.indexOf("$inputs");

      const pluginResult = service.getQuickInfoAtPosition("/test.spec.ts", hoverPos);
      const rawResult = rawService.getQuickInfoAtPosition("/test.spec.ts", hoverPos);

      // Should pass through to the raw service
      expect(pluginResult?.displayParts?.map((p) => p.text).join("")).toBe(
        rawResult?.displayParts?.map((p) => p.text).join(""),
      );
    });

    test("shows inferred type even when globals.d.ts declares $inputs as any", () => {
      const globalsDecl = [
        `declare var $inputs: any;`,
        `declare var $subject: any;`,
        `declare function given(scenario: string, fn: () => void): void;`,
      ].join("\n");

      const source = [
        `given("a thing", () => {`,
        `  $inputs = { name: "hello", count: 42 };`,
        `  $inputs;`,
        `});`,
      ].join("\n");

      const { service } = createTestService({
        "/globals.d.ts": globalsDecl,
        "/test.spec.ts": source,
      });
      const hoverPos = source.lastIndexOf("$inputs");
      const result = service.getQuickInfoAtPosition("/test.spec.ts", hoverPos);

      expect(result).toBeDefined();
      const display = result!.displayParts?.map((p) => p.text).join("");
      // Should show the structural type, not `any`
      expect(display).toContain("name");
      expect(display).toContain("count");
    });

    test("does not provide hover info in non-test files", () => {
      const source = [
        `given("a thing", () => {`,
        `  $inputs = { value: 1 };`,
        `  $inputs;`,
        `});`,
      ].join("\n");

      const { service, rawService } = createTestService({ "/app.ts": source });
      const hoverPos = source.lastIndexOf("$inputs");

      const pluginResult = service.getQuickInfoAtPosition("/app.ts", hoverPos);
      const rawResult = rawService.getQuickInfoAtPosition("/app.ts", hoverPos);

      expect(pluginResult?.displayParts?.map((p) => p.text).join("")).toBe(
        rawResult?.displayParts?.map((p) => p.text).join(""),
      );
    });
  });

  describe("go-to-definition", () => {
    test("jumps to $inputs assignment from a reference in when block", () => {
      const source = [
        `given("a thing", () => {`,
        `  $inputs = { value: 1 };`,
        `  when("something", () => {`,
        `    $inputs.value = 2;`,
        `  });`,
        `});`,
      ].join("\n");

      const { service } = createTestService({ "/test.spec.ts": source });
      // Position on $inputs in the when block
      const refPos = source.indexOf("$inputs.value = 2");
      const defs = service.getDefinitionAtPosition("/test.spec.ts", refPos);

      expect(defs).toBeDefined();
      expect(defs!.length).toBeGreaterThan(0);
      expect(defs![0].fileName).toBe("/test.spec.ts");
      // Should point to the assignment `$inputs = { value: 1 }`
      const assignmentPos = source.indexOf("$inputs = { value: 1 }");
      expect(defs![0].textSpan.start).toBe(assignmentPos);
    });

    test("jumps to $subject assignment from a reference in it block", () => {
      const source = [
        `class Foo { value = 0; }`,
        `given("a Foo", () => {`,
        `  $subject = new Foo();`,
        `  it("works", () => {`,
        `    $subject.value;`,
        `  });`,
        `});`,
      ].join("\n");

      const { service } = createTestService({ "/test.spec.ts": source });
      const refPos = source.indexOf("$subject.value");
      const defs = service.getDefinitionAtPosition("/test.spec.ts", refPos);

      expect(defs).toBeDefined();
      expect(defs!.length).toBeGreaterThan(0);
      expect(defs![0].fileName).toBe("/test.spec.ts");
      const assignmentPos = source.indexOf("$subject = new Foo()");
      expect(defs![0].textSpan.start).toBe(assignmentPos);
    });

    test("does not provide go-to-def outside given blocks", () => {
      const source = `const $inputs = 42; $inputs;`;

      const { service, rawService } = createTestService({ "/test.spec.ts": source });
      const refPos = source.lastIndexOf("$inputs");

      const pluginDefs = service.getDefinitionAtPosition("/test.spec.ts", refPos);
      const rawDefs = rawService.getDefinitionAtPosition("/test.spec.ts", refPos);

      // Should pass through to the raw service
      expect(pluginDefs?.length).toBe(rawDefs?.length);
    });

    test("does not provide go-to-def in non-test files", () => {
      const source = [
        `given("a thing", () => {`,
        `  $inputs = { value: 1 };`,
        `  $inputs;`,
        `});`,
      ].join("\n");

      const { service, rawService } = createTestService({ "/app.ts": source });
      const refPos = source.lastIndexOf("$inputs");

      const pluginDefs = service.getDefinitionAtPosition("/app.ts", refPos);
      const rawDefs = rawService.getDefinitionAtPosition("/app.ts", refPos);

      expect(pluginDefs?.length).toBe(rawDefs?.length);
    });
  });
});
