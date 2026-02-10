import { render, cleanup as testingLibraryCleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { expect } from "vitest";
import { given } from "./index.ts";

// =============================================================================
// Tests for skip/only/each modifiers
// =============================================================================

// Test given.each - parameterized test suites
given.each([
  [1, 2, 3],
  [2, 3, 5],
  [10, 20, 30],
])(
  "a Calculator adding %d + %d = %d",
  (a, b, expected) => ({ a, b, expected }),
  (inputs) => ({ sum: inputs.a + inputs.b, expected: inputs.expected }),
  ({ when }) => {
    when(
      "computing the sum",
      () => {}, // eslint-disable-line @typescript-eslint/no-empty-function
      ({ it }) => {
        it("returns the correct result", (state) => {
          expect(state.sum).toBe(state.expected);
        });
      },
    );
  },
);

// Test given.each with object-style cases (wrapped in arrays for vitest compatibility)
given.each([[{ name: "Alice", age: 30 }], [{ name: "Bob", age: 25 }]])(
  "a User",
  (user) => ({ user }),
  (inputs) => ({ ...inputs.user, isAdult: inputs.user.age >= 18 }),
  ({ when }) => {
    when(
      "checking adult status",
      () => {}, // eslint-disable-line @typescript-eslint/no-empty-function
      ({ it }) => {
        it("is an adult", (state) => {
          expect(state.isAdult).toBe(true);
        });
      },
    );
  },
);

// Test when.each - parameterized scenarios
given(
  "a Counter",
  { initial: 0 },
  (inputs) => {
    let value = inputs.initial;
    return {
      get value() {
        return value;
      },
      add(n: number) {
        value += n;
      },
    };
  },
  ({ when }) => {
    when.each([
      [1, 1],
      [5, 5],
      [10, 10],
    ])(
      "adding %d to get %d",
      ($, amount) => {
        $.state.add(amount);
      },
      ({ it }) => {
        it("has the correct value", (counter) => {
          expect(counter.value).toBeGreaterThan(0);
        });
      },
    );
  },
);

// Test it.each - parameterized test cases
given(
  "a Math helper",
  {},
  () => ({
    multiply: (a: number, b: number) => a * b,
    divide: (a: number, b: number) => a / b,
  }),
  ({ when }) => {
    when(
      "using multiply",
      () => {}, // eslint-disable-line @typescript-eslint/no-empty-function
      ({ it }) => {
        it.each([
          [2, 3, 6],
          [4, 5, 20],
          [0, 100, 0],
        ])("multiplies %d * %d = %d", (a, b, expected, math) => {
          expect(math.multiply(a, b)).toBe(expected);
        });
      },
    );

    when(
      "using divide",
      () => {}, // eslint-disable-line @typescript-eslint/no-empty-function
      ({ it }) => {
        it.each([
          [10, 2, 5],
          [100, 10, 10],
        ])("divides %d / %d = %d", (a, b, expected, math) => {
          expect(math.divide(a, b)).toBe(expected);
        });
      },
    );
  },
);

// Test it.skip - skipped tests should not run
given(
  "skip modifier tests",
  {},
  () => ({ value: 42 }),
  ({ when }) => {
    when(
      "using it.skip",
      () => {}, // eslint-disable-line @typescript-eslint/no-empty-function
      ({ it }) => {
        it("runs normally", (state) => {
          expect(state.value).toBe(42);
        });

        it.skip("is skipped", () => {
          throw new Error("This test should be skipped");
        });
      },
    );
  },
);

// Test when.skip - skipped scenarios
given(
  "when.skip modifier tests",
  {},
  () => ({ value: 1 }),
  ({ when }) => {
    when(
      "normal scenario",
      () => {}, // eslint-disable-line @typescript-eslint/no-empty-function
      ({ it }) => {
        it("runs", (state) => {
          expect(state.value).toBe(1);
        });
      },
    );

    when.skip(
      "skipped scenario",
      () => {}, // eslint-disable-line @typescript-eslint/no-empty-function
      ({ it }) => {
        it("should not run", () => {
          throw new Error("This scenario should be skipped");
        });
      },
    );
  },
);

// Test nested each with modifiers
given(
  "nested parameterized tests",
  { base: 10 },
  (inputs) => ({
    base: inputs.base,
    compute: (x: number, y: number) => inputs.base + x * y,
  }),
  ({ when }) => {
    when.each([
      [2, 3],
      [4, 5],
    ])(
      "with multipliers %d and %d",
      ($) => {
        $.inputs.base = 100;
      },
      ({ it }) => {
        it.each([
          [1, 1],
          [2, 2],
        ])("and factors %d, %d", (f1, f2, state) => {
          expect(state.base).toBe(100);
          expect(typeof state.compute(f1, f2)).toBe("number");
        });
      },
    );
  },
);

// =============================================================================
// Base tests
// =============================================================================

// Example component to test
function MyComponent({ title }: { title: string }) {
  const [value, setValue] = useState(0);

  return (
    <div>
      <h1>{title}</h1>
      <p data-testid="value">Value: {value}</p>
      <button
        onClick={() => {
          setValue(value + 1);
        }}
      >
        Increment
      </button>
    </div>
  );
}

// Example of a simple class to test, to show that this testing approach isn't
// just for react components
class Foo {
  constructor(private _value = 0) {}

  inc() {
    this._value++;
  }

  get value() {
    return this._value;
  }
}

given(
  "a Foo", // scenario name
  { value: 0 }, // scenario initial state
  ({ value }) => new Foo(value), // constructor that creates the world state from the scenario state
  ({ when }) => {
    when(
      "the user sets the value to 5",
      ($) => {
        // modify the world state for the scenario.  note that the world state
        // is actually a reactive computed value that will be updated whenever
        // any of the input signals change.
        $.inputs.value = 5;
      },
      ({ it }) => {
        it("has a value of 5", (foo) => {
          // the world state is passed into the test function, and will reflect
          // any modifications made in the modifier function
          expect(foo.value).toEqual(5);
        });

        it("can be incremented to 6", (foo) => {
          // "inline" modifications work as expected
          foo.inc();
          expect(foo.value).toEqual(6);
        });
      },
    );

    // every individual test (e.g. `it` call) gets a completely fresh world
    // state, so no test can affect any other test
    when(
      "the user calls inc()",
      ($) => {
        $.state.inc();
      },
      ({ it }) => {
        it("increments the value to 1", (foo) => {
          expect(foo.value).toEqual(1);
        });
      },
    );
  },
);

// a slightly more interesting example with a real react component
given(
  "an instance of MyComponent on the page",
  { title: "My Title" },
  (inputs) => {
    // create the world state by rendering the component with the given inputs
    return render(<MyComponent title={inputs.title} />);
  },
  ({ when, cleanup }) => {
    const user = userEvent.setup();
    // we can register custom cleanup functions, like unmounting the component
    // after each test. Note that this will happen not only after each `it`
    // test, but also whenever the world-state is re-created (e.g. when the
    // inputs change in a `when` modifier)
    cleanup(() => {
      testingLibraryCleanup();
    });
    when(
      "the user has not interacted with it",
      () => {
        /* no modifications to the world state for this scenario */
      },
      ({ it }) => {
        it("has an initial value of 0", ({ getByTestId }) => {
          expect(getByTestId("value").innerText).toEqual("Value: 0");
        });

        it("has button text = increment", ({ getByRole }) => {
          expect(getByRole("button").innerText).toEqual("Increment");
        });

        it("has the default title", ({ getByRole }) => {
          expect(getByRole("heading").innerText).toEqual("My Title");
        });
      },
    );

    when(
      "the user sets the title prop",
      ($) => {
        $.inputs.title = "New Title";
        $.perform(async () => {
          await user.click($.state.getByRole("button"));
        });
      },
      ({ it }) => {
        it("reflects the title prop", ({ getByRole }) => {
          expect(getByRole("heading").innerText).toEqual("New Title");
        });

        it("updates the value to the next number", ({ getByTestId }) => {
          expect(getByTestId("value").innerText).toEqual("Value: 1");
        });
      },
    );
  },
);
