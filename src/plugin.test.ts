import { expect } from "vitest";

class Foo {
  constructor(public value: number) {}
  inc() {
    this.value++;
  }
}

// Test 1: Basic given/it
given("a Foo with default inputs", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  it("has a value of 0", () => {
    expect($subject.value).toEqual(0);
  });
});

// Test 2: when with modifier
given("a Foo with modifiable value", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  when("value is set to 5", () => {
    $inputs.value = 5;

    it("has a value of 5", () => {
      expect($subject.value).toEqual(5);
    });
  });
});

// Test 3: when with perform (side-effect)
given("a Foo with perform", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  when("the user calls inc()", () => {
    $subject.inc();

    it("has a value of 1", () => {
      expect($subject.value).toEqual(1);
    });
  });
});

// Test 4: Nested when blocks
given("a Foo with nested whens", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  when("value is set to 10", () => {
    $inputs.value = 10;

    when("the user calls inc()", () => {
      $subject.inc();

      it("has a value of 11", () => {
        expect($subject.value).toEqual(11);
      });
    });
  });
});

// Test 5: Each it gets fresh state
given("a Foo with fresh state per test", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  when("the user calls inc()", () => {
    $subject.inc();

    it("has value 1 (first test)", () => {
      expect($subject.value).toEqual(1);
    });

    it("has value 1 (second test, proving isolation)", () => {
      expect($subject.value).toEqual(1);
    });
  });
});

// Test 6: Iteration with for-loop
given("a Calculator", () => {
  $inputs = { a: 0, b: 0 };
  $subject = { sum: $inputs.a + $inputs.b };

  for (const [a, b, expected] of [
    [1, 2, 3],
    [2, 3, 5],
    [10, 20, 30],
  ] as const) {
    when(`adding ${a} + ${b}`, () => {
      $inputs.a = a;
      $inputs.b = b;

      it(`equals ${expected}`, () => {
        expect($subject.sum).toEqual(expected);
      });
    });
  }
});

// Test 7: given.skip - skipped tests should not run
given.skip("a skipped Foo", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  it("should not run", () => {
    throw new Error("this test should be skipped");
  });
});

// Test 8: it with async callback
given("a Foo with async test", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  when("inc is called asynchronously", () => {
    $subject.inc();

    it("can assert async results", async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      expect($subject.value).toEqual(1);
    });
  });
});

// Test 9: $inputs should be accessible inside it() blocks
given("a Foo where $inputs is used in it()", () => {
  $inputs = { value: 42 };
  $subject = new Foo($inputs.value);

  it("can access $inputs directly", () => {
    expect($inputs.value).toEqual(42);
  });

  when("value is changed", () => {
    $inputs.value = 99;

    it("can access modified $inputs", () => {
      expect($inputs.value).toEqual(99);
      expect($subject.value).toEqual(99);
    });
  });
});
