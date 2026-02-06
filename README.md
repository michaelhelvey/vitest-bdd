# @michaelhelvey/vitest-bdd

A BDD (Behavior-Driven Development) testing helper for [Vitest](https://vitest.dev/) that provides a
structured `given`/`when`/`it` pattern with isolated world state for each test.

## Features

- **Natural language test structure** - Write tests that read like specifications using
  `given`/`when`/`it`
- **Test isolation** - Each `it` receives completely fresh world state, preventing test pollution
- **Lazy state creation** - World state is created on-demand, allowing input modifications before
  instantiation
- **Async side-effects** - Use `$.perform()` perform async side-effects (e.g., user interactions)
  after state creation but before assertions
- **Cleanup hooks** - Register cleanup functions (e.g., unmounting React components) that run after
  each test

## Installation

```bash
npm install @michaelhelvey/vitest-bdd # or bun, yarn, pnpm, etc.
```

**Peer Dependencies:**

- `vitest` ^3.2.4

## Quick Start

```typescript
import { given } from "@michaelhelvey/vitest-bdd";
import { expect } from "vitest";

class Counter {
  constructor(private _value = 0) {}
  inc() {
    this._value++;
  }
  get value() {
    return this._value;
  }
}

given(
  "a Counter",
  { initialValue: 0 },
  ({ initialValue }) => new Counter(initialValue),
  ({ when }) => {
    when(
      "initialized with value 5",
      ($) => {
        $.inputs.initialValue = 5;
      },
      ({ it }) => {
        it("has value 5", (counter) => {
          expect(counter.value).toEqual(5);
        });
      },
    );

    when(
      "incremented",
      ($) => {
        $.state.inc();
      },
      ({ it }) => {
        it("has value 1", (counter) => {
          expect(counter.value).toEqual(1);
        });
      },
    );
  },
);
```

## API

### `given(scenario, inputs, createWorldState, tests)`

The main function for creating BDD-style test suites.

| Parameter          | Type                               | Description                                           |
| ------------------ | ---------------------------------- | ----------------------------------------------------- |
| `scenario`         | `string`                           | Description of the test context                       |
| `inputs`           | `TInputs`                          | Initial input values used to create world state       |
| `createWorldState` | `(inputs: TInputs) => TWorldState` | Factory function that creates world state from inputs |
| `tests`            | `(helpers) => void`                | Function receiving `{ when, cleanup }` helpers        |

### `when(scenario, modifier, tests)`

Defines a scenario within a `given` block.

| Parameter  | Type               | Description                                              |
| ---------- | ------------------ | -------------------------------------------------------- |
| `scenario` | `string`           | Description of the scenario                              |
| `modifier` | `($) => void`      | Function to modify inputs or perform actions (see below) |
| `tests`    | `({ it }) => void` | Function to define test assertions                       |

The modifier function receives an object with:

- `$.inputs` - Proxy to modify input values before state creation
- `$.state` - Lazily-created world state (accessing triggers creation)
- `$.perform(fn)` - Register an async action to run after state creation

### `it(scenario, testFn)`

Defines a test assertion within a `when` block.

| Parameter  | Type                   | Description                               |
| ---------- | ---------------------- | ----------------------------------------- |
| `scenario` | `string`               | Description of what the test asserts      |
| `testFn`   | `(worldState) => void` | Test function receiving fresh world state |

### `cleanup(cleanupFn)`

Registers a cleanup function to run after each test.

```typescript
given(
  "...",
  {},
  () => createSomething(),
  ({ when, cleanup }) => {
    cleanup(() => destroySomething());
    // ...
  },
);
```

## Usage Examples

### Testing a Class

```typescript
import { given } from "@michaelhelvey/vitest-bdd";
import { expect } from "vitest";

class Calculator {
  constructor(private value = 0) {}
  add(n: number) {
    this.value += n;
  }
  getResult() {
    return this.value;
  }
}

given(
  "a Calculator",
  { initial: 0 },
  ({ initial }) => new Calculator(initial),
  ({ when }) => {
    when(
      "starting at 10",
      ($) => {
        $.inputs.initial = 10;
      },
      ({ it }) => {
        it("has initial value 10", (calc) => {
          expect(calc.getResult()).toEqual(10);
        });

        it("can add 5 to get 15", (calc) => {
          calc.add(5);
          expect(calc.getResult()).toEqual(15);
        });
      },
    );

    when(
      "5 is added",
      ($) => {
        $.state.add(5);
      },
      ({ it }) => {
        it("equals 5", (calc) => {
          expect(calc.getResult()).toEqual(5);
        });
      },
    );
  },
);
```

### Testing React Components

```tsx
import { given } from "@michaelhelvey/vitest-bdd";
import { render, cleanup as testingLibraryCleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect } from "vitest";

function Counter({ start }: { start: number }) {
  const [count, setCount] = useState(start);
  return (
    <div>
      <span data-testid="count">{count}</span>
      <button onClick={() => setCount((c) => c + 1)}>Increment</button>
    </div>
  );
}

given(
  "a Counter component",
  { start: 0 },
  (inputs) => render(<Counter start={inputs.start} />),
  ({ when, cleanup }) => {
    const user = userEvent.setup();
    cleanup(() => testingLibraryCleanup());

    when(
      "rendered with default props",
      () => {},
      ({ it }) => {
        it("shows count as 0", ({ getByTestId }) => {
          expect(getByTestId("count").innerText).toEqual("0");
        });
      },
    );

    when(
      "starting at 5 and clicking increment",
      ($) => {
        $.inputs.start = 5;
        $.perform(async () => {
          await user.click($.state.getByRole("button"));
        });
      },
      ({ it }) => {
        it("shows count as 6", ({ getByTestId }) => {
          expect(getByTestId("count").innerText).toEqual("6");
        });
      },
    );
  },
);
```

## Key Concepts

### Test Isolation

Every `it` test receives a **completely fresh world state**. This means:

```typescript
when(
  "some scenario",
  ($) => {
    $.inputs.value = 5;
  },
  ({ it }) => {
    it("test A - mutates state", (state) => {
      state.mutate(); // This mutation...
    });

    it("test B - gets fresh state", (state) => {
      // ...does NOT affect this test. Fresh state here.
    });
  },
);
```

### Input Modification Timing

Inputs can only be modified **before** accessing `$.state`:

```typescript
when(
  "scenario",
  ($) => {
    $.inputs.value = 5; // OK - before state access
    $.state.doSomething(); // State created here
    $.inputs.value = 10; // ERROR! Cannot modify after state access
  },
  ({ it }) => {
    /* ... */
  },
);
```

### The `perform` Function

Use `$.perform()` to register an action that runs **after** state creation but **before** test
assertions:

```typescript
when(
  "the button is clicked",
  ($) => {
    $.perform(async () => {
      await userEvent.click($.state.getByRole("button"));
    });
  },
  ({ it }) => {
    it("reflects the click", (state) => {
      // Assertions run after perform() completes
    });
  },
);
```

Note: `perform()` can only be called once per modifier.

## License

MIT
