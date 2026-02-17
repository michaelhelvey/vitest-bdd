import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import { transformBddSyntax } from "./transform.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DIR = path.resolve(__dirname, "../examples/basic");

describe("e2e: example project", () => {
  beforeAll(() => {
    // Ensure dependencies are installed and the latest build is linked.
    // The `file:` protocol copies the package, so we remove the stale copy
    // and reinstall to get the latest dist output.
    execSync("bun install", { cwd: EXAMPLE_DIR, stdio: "pipe" });
  }, 60_000);

  test("type-checks successfully with tsc", () => {
    // Runs tsc --noEmit on the example project.
    // This verifies that:
    // - The globals.d.ts types resolve correctly via the "types" field in tsconfig
    // - Explicit type annotations (e.g. `$inputs = {...} as UserInput`) don't cause errors
    // - The vitest import for `expect` works
    execSync("npx tsc --noEmit", {
      cwd: EXAMPLE_DIR,
      stdio: "pipe",
      encoding: "utf-8",
    });
    // If tsc exits with code 0, types are valid -- no assertion needed
  }, 30_000);

  test("all example tests pass at runtime", () => {
    // Runs vitest on the example project (only the valid test file).
    // This proves:
    // - The vite plugin transform works correctly for a real consumer project
    // - given/when/it produce correct describe/test structures
    // - $inputs/$subject factory isolation works (each test gets fresh state)
    const result = execSync("npx vitest --run src/example.test.ts", {
      cwd: EXAMPLE_DIR,
      stdio: "pipe",
      encoding: "utf-8",
    });
    expect(result).toContain("passed");
    expect(result).not.toContain("failed");
  }, 30_000);

  test("$inputs outside given() causes a runtime error", () => {
    // The errors.test.ts file uses $inputs at the top level (outside given).
    // After the transform, that bare `$inputs` reference is NOT wrapped in a factory
    // and remains as a reference to an undefined global, causing a ReferenceError.
    expect(() => {
      execSync("npx vitest --run src/errors.test.ts", {
        cwd: EXAMPLE_DIR,
        stdio: "pipe",
        encoding: "utf-8",
      });
    }).toThrow();
  }, 30_000);

  test("transform leaves bare $inputs outside given() untouched", () => {
    // Directly test the transform to verify that $inputs outside of given()
    // is not extracted into a config factory -- it stays as a bare reference
    // which will cause a ReferenceError at runtime.
    const code = `
import { expect } from "vitest";

const x = $inputs;

given("test", () => {
  $inputs = { value: 1 };
  $subject = $inputs.value;

  it("works", () => {
    expect($subject).toEqual(1);
  });
});
    `.trim();

    const result = transformBddSyntax(code, "test.spec.ts");
    expect(result).not.toBeNull();

    // The bare `$inputs` reference outside given() remains in the output unchanged
    expect(result!.code).toContain("const x = $inputs");

    // But inside given(), $inputs is extracted into the config factory
    expect(result!.code).toContain("inputs: () => ({ value: 1 })");
    expect(result!.code).toContain("subject: ($inputs) => $inputs.value");
  });
});
