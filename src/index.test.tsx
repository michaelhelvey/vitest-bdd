import { render, cleanup as testingLibraryCleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { expect } from "vitest";
import { given } from "./index.ts";

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
