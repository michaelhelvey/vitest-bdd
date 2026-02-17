import { expect } from "vitest";

// A simple class to test
class Calculator {
  private value: number;

  constructor(initial: number) {
    this.value = initial;
  }

  add(n: number) {
    this.value += n;
    return this;
  }

  subtract(n: number) {
    this.value -= n;
    return this;
  }

  getResult() {
    return this.value;
  }
}

// Interface for testing explicit type annotations
interface UserInput {
  name: string;
  age: number;
}

// Basic given/it
given("a Calculator", () => {
  $inputs = { initial: 0 };
  $subject = new Calculator($inputs.initial);

  it("starts at 0", () => {
    expect($subject.getResult()).toEqual(0);
  });

  when("initialized with 10", () => {
    $inputs.initial = 10;

    it("starts at 10", () => {
      expect($subject.getResult()).toEqual(10);
    });
  });

  when("5 is added", () => {
    $subject.add(5);

    it("equals 5", () => {
      expect($subject.getResult()).toEqual(5);
    });
  });

  when("initialized at 10 and 5 is added", () => {
    $inputs.initial = 10;

    when("5 is added", () => {
      $subject.add(5);

      it("equals 15", () => {
        expect($subject.getResult()).toEqual(15);
      });
    });
  });
});

// Test with explicit type annotation on $inputs
given("a user", () => {
  $inputs = { name: "Alice", age: 30 } as UserInput;
  $subject = { greeting: `Hello, ${$inputs.name}! You are ${$inputs.age}.` };

  it("greets correctly", () => {
    expect($subject.greeting).toEqual("Hello, Alice! You are 30.");
  });

  when("name is Bob", () => {
    $inputs.name = "Bob";

    it("greets Bob", () => {
      expect($subject.greeting).toEqual("Hello, Bob! You are 30.");
    });
  });
});

// Iteration test
given("arithmetic operations", () => {
  $inputs = { a: 0, b: 0 };
  $subject = { sum: $inputs.a + $inputs.b };

  for (const [a, b, expected] of [
    [1, 2, 3],
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
