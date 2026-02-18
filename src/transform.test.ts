import { describe, expect, test } from "vitest";
import { transformBddSyntax } from "./transform.ts";

/** Helper: transform and assert non-null result */
function transform(input: string): string {
  const result = transformBddSyntax(input, "test.spec.ts");
  if (result === null) {
    throw new Error("Expected transformBddSyntax to return a non-null result");
  }
  return result.code;
}

/** Helper: normalize whitespace for comparison */
function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

describe("transformBddSyntax", () => {
  test("returns null when no given/when/it calls are present", () => {
    const input = `
const x = 1;
function hello() { return "world"; }
describe("something", () => { test("works", () => {}); });
    `.trim();

    const result = transformBddSyntax(input, "test.spec.ts");
    expect(result).toBeNull();
  });

  test("does not transform standalone it() calls outside of given()", () => {
    const input = `
import { describe, it, expect } from "vitest";

describe("a non-BDD test suite", () => {
  it("should work without BDD", () => {
    expect(1 + 1).toBe(2);
  });

  it("should also work", () => {
    expect(true).toBe(true);
  });
});
    `.trim();

    const result = transformBddSyntax(input, "test.spec.ts");
    // Non-BDD test files should be left completely untouched
    expect(result).toBeNull();
  });

  test("does not transform it() calls outside given() even when given() exists elsewhere", () => {
    const input = `
import { describe, expect } from "vitest";

describe("non-BDD tests", () => {
  it("standalone test", () => {
    expect(1).toBe(1);
  });
});

given("a BDD test", () => {
  $inputs = { value: 1 };
  $subject = $inputs.value;

  it("works in BDD", () => {
    expect($subject).toBe(1);
  });
});
    `.trim();

    const result = transformBddSyntax(input, "test.spec.ts");
    expect(result).not.toBeNull();
    const output = result!.code;

    // The standalone it() should NOT be transformed
    expect(output).toContain('it("standalone test"');
    // The BDD it() should be transformed
    expect(output).toContain('__it("works in BDD"');
    // The standalone it should not reference __ctx
    expect(output).not.toMatch(/it\("standalone test".*__ctx/);
  });

  test("transforms simple given/it block", () => {
    const input = `
given("a Foo", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  it("has value 0", () => {
    expect($subject.value).toEqual(0);
  });
});
    `.trim();

    const output = transform(input);

    // Should have the runtime import
    expect(output).toContain('import { __given, __it } from "@michaelhelvey/vitest-bdd/runtime";');

    // Should transform given( to __given(
    expect(output).toContain("__given(");

    // Should have the config object with inputs and subject factories
    expect(output).toContain("inputs: () => ({ value: 0 })");
    expect(output).toContain("subject: ($inputs) => new Foo($inputs.value)");

    // Should transform it( to __it( with $inputs and $subject params and __ctx
    expect(output).toContain("__it(");
    expect(output).toContain("($inputs, $subject) =>");
    expect(output).toContain(", __ctx)");

    // Should have __ctx parameter on the given callback
    expect(output).toContain("(__ctx) =>");

    // The $inputs and $subject assignment statements should be removed
    expect(output).not.toMatch(/\$inputs\s*=\s*\{/);
    expect(output).not.toMatch(/\$subject\s*=\s*new/);
  });

  test("transforms when block with modifier", () => {
    const input = `
given("a Foo", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  when("the user sets value to 5", () => {
    $inputs.value = 5;

    it("has value 5", () => {
      expect($subject.value).toEqual(5);
    });
  });
});
    `.trim();

    const output = transform(input);

    // Should transform when( to __when(
    expect(output).toContain("__when(");

    // Should have modifier in config
    expect(output).toContain("modifier: ($inputs) => { $inputs.value = 5; }");

    // Should pass __ctx as last arg
    expect(output).toContain(", __ctx)");

    // Should transform the callback to (__ctx) =>
    expect(output).toContain("(__ctx) =>");

    // The $inputs.value = 5 statement should be removed from the body
    // (it's now in the config modifier)
    // The body should contain the __it call but not $inputs.value = 5
  });

  test("transforms when block with perform", () => {
    const input = `
given("a Foo", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  when("inc is called", () => {
    $subject.inc();

    it("has value 1", () => {
      expect($subject.value).toEqual(1);
    });
  });
});
    `.trim();

    const output = transform(input);

    expect(output).toContain("__when(");
    expect(output).toContain("perform: ($subject) => { $subject.inc(); }");
    expect(output).toContain(", __ctx)");
  });

  test("transforms when block with modifier AND perform", () => {
    const input = `
given("a Foo", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  when("the user sets value to 5 and increments", () => {
    $inputs.value = 5;
    $subject.inc();

    it("has value 6", () => {
      expect($subject.value).toEqual(6);
    });
  });
});
    `.trim();

    const output = transform(input);

    expect(output).toContain("modifier: ($inputs) => { $inputs.value = 5; }");
    expect(output).toContain("perform: ($subject) => { $subject.inc(); }");
  });

  test("transforms nested when blocks", () => {
    const input = `
given("a Foo", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  when("value is set to 10", () => {
    $inputs.value = 10;

    when("value is doubled", () => {
      $inputs.value = $inputs.value * 2;

      it("has value 20", () => {
        expect($subject.value).toEqual(20);
      });
    });
  });
});
    `.trim();

    const output = transform(input);

    // Both when blocks should be transformed
    const whenCount = (output.match(/__when\(/g) ?? []).length;
    expect(whenCount).toBe(2);

    // Inner when should have __ctx passed
    // Outer when should also have __ctx passed
    expect(output).toContain(", __ctx)");

    // Both should have modifier configs
    expect(output).toContain("modifier: ($inputs) => { $inputs.value = 10; }");
    expect(output).toContain("modifier: ($inputs) => { $inputs.value = $inputs.value * 2; }");
  });

  test("transforms when/it inside for-loop", () => {
    const input = `
given("a Foo", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  for (const val of [1, 2, 3]) {
    it("works with " + val, () => {
      expect($subject.value).toBeDefined();
    });
  }
});
    `.trim();

    const output = transform(input);

    // The for loop should pass through untouched
    expect(output).toContain("for (const val of [1, 2, 3])");

    // But the it() inside should be transformed
    expect(output).toContain("__it(");
    expect(output).toContain("($inputs, $subject) =>");
  });

  test("transforms skip/only modifiers", () => {
    const givenSkipInput = `
given.skip("skipped", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  it("never runs", () => {
    expect(true).toBe(true);
  });
});
    `.trim();

    const givenSkipOutput = transform(givenSkipInput);
    expect(givenSkipOutput).toContain("__given(");
    expect(givenSkipOutput).toContain("describe.skip");
    // Should not contain given.skip anymore
    expect(givenSkipOutput).not.toContain("given.skip");

    const whenOnlyInput = `
given("a Foo", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  when.only("focused", () => {
    $inputs.value = 5;

    it("runs", () => {
      expect($subject.value).toEqual(5);
    });
  });
});
    `.trim();

    const whenOnlyOutput = transform(whenOnlyInput);
    expect(whenOnlyOutput).toContain("__when(");
    expect(whenOnlyOutput).toContain("describe.only");
    expect(whenOnlyOutput).not.toContain("when.only");

    const itSkipInput = `
given("a Foo", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  it.skip("skipped test", () => {
    expect($subject.value).toEqual(0);
  });
});
    `.trim();

    const itSkipOutput = transform(itSkipInput);
    expect(itSkipOutput).toContain("__it(");
    expect(itSkipOutput).toContain("test.skip");
    expect(itSkipOutput).not.toContain("it.skip");
  });

  test("adds runtime import with only used helpers", () => {
    // Only given and it used (no when)
    const givenItInput = `
given("a Foo", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  it("works", () => {
    expect($subject.value).toEqual(0);
  });
});
    `.trim();

    const givenItOutput = transform(givenItInput);
    expect(givenItOutput).toContain(
      'import { __given, __it } from "@michaelhelvey/vitest-bdd/runtime";',
    );
    expect(givenItOutput).not.toContain("__when");

    // All three used
    const allInput = `
given("a Foo", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  when("modified", () => {
    $inputs.value = 5;

    it("works", () => {
      expect($subject.value).toEqual(5);
    });
  });
});
    `.trim();

    const allOutput = transform(allInput);
    expect(allOutput).toContain(
      'import { __given, __it, __when } from "@michaelhelvey/vitest-bdd/runtime";',
    );
  });

  test("preserves async callbacks", () => {
    const input = `
given("a Foo", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  when("async operation", async () => {
    $subject.inc();

    it("has value 1", async () => {
      expect($subject.value).toEqual(1);
    });
  });
});
    `.trim();

    const output = transform(input);

    // The when callback should be async
    expect(output).toContain("async (__ctx) =>");

    // The it callback should be async
    expect(output).toContain("async ($inputs, $subject) =>");
  });

  test("produces correct full output for a complete given/when/it tree", () => {
    const input = `
given("a Foo", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  it("has value 0", () => {
    expect($subject.value).toEqual(0);
  });

  when("the user sets value to 5", () => {
    $inputs.value = 5;
    $subject.inc();

    it("has value 6", () => {
      expect($subject.value).toEqual(6);
    });
  });
});
    `.trim();

    const output = transform(input);

    // Verify the overall structure via snapshot
    expect(normalize(output)).toBe(
      normalize(`
import { __given, __it, __when } from "@michaelhelvey/vitest-bdd/runtime";

__given("a Foo", { inputs: () => ({ value: 0 }), subject: ($inputs) => new Foo($inputs.value) }, (__ctx) => {

  __it("has value 0", ($inputs, $subject) => {
    expect($subject.value).toEqual(0);
  }, __ctx);

  __when("the user sets value to 5", { modifier: ($inputs) => { $inputs.value = 5; }, perform: ($subject) => { $subject.inc(); } }, (__ctx) => {

    __it("has value 6", ($inputs, $subject) => {
      expect($subject.value).toEqual(6);
    }, __ctx);
  }, __ctx);
});
      `),
    );
  });

  test("passes $inputs as a parameter to it() callbacks", () => {
    const input = `
given("a Foo", () => {
  $inputs = { value: 42 };
  $subject = new Foo($inputs.value);

  it("can access $inputs", () => {
    expect($inputs.value).toEqual(42);
  });
});
    `.trim();

    const output = transform(input);

    // The it callback should receive both $inputs and $subject
    expect(output).toContain("($inputs, $subject) =>");
  });

  test("returns a source map", () => {
    const input = `
given("something", () => {
  $inputs = { x: 1 };
  $subject = $inputs.x;

  it("works", () => {
    expect($subject).toBe(1);
  });
});
    `.trim();

    const result = transformBddSyntax(input, "test.spec.ts");
    expect(result).not.toBeNull();
    expect(result?.map).toBeDefined();
    expect(result?.map.sources).toContain("test.spec.ts");
  });
});
