import { expect } from "vitest";

// This file intentionally contains code that should produce a runtime error.
// The $inputs variable is used at the top level (outside of given()), which
// means the transform will NOT wrap it in a factory. After transformation,
// the bare `$inputs` reference remains and refers to an undefined global,
// causing a ReferenceError at runtime.

const x = $inputs;

given("error case", () => {
  $inputs = { value: 42 };
  $subject = $inputs.value;

  it("should work fine", () => {
    expect($subject).toEqual(42);
  });
});
