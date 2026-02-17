# @michaelhelvey/vitest-bdd

A BDD (Behavior-Driven Development) testing framework for [Vitest](https://vitest.dev/) that
provides RSpec-like `given`/`when`/`it` syntax with lazy evaluation of inputs and subjects via
compile-time transforms.

<!-- prettier-ignore -->
> [!WARNING] 
> This library was largely created and documented by generative AI (Claude Opus 4.6) as a
> proof of concept.  I think it turned out pretty well, but my general sense is that a lot
> of the compilation pipeline could be easily simplified.

## Motivation

The core idea is borrowed from RSpec's `let`/`subject` pattern: separate **what your test data is**
from **how your test subject is created** from that data.

- `$inputs` defines a factory for your test's input data.
- `$subject` defines how to create the thing under test from those inputs.
- Each `it()` test gets completely fresh inputs and a fresh subject — no shared mutable state
  between tests.
- `when()` blocks can modify `$inputs` properties (changing data before subject creation) or
  interact with `$subject` (performing side-effects after creation).

This is all powered by a Vite plugin that transforms your BDD syntax at compile time.

## Installation

```bash
npm install @michaelhelvey/vitest-bdd # or bun, yarn, pnpm, etc.
```

**Peer Dependencies:**

- `vite` >=5
- `vitest` >3

## Setup

### 1. Add the Vite plugin

```typescript
// vitest.config.ts
import vitestBddPlugin from "@michaelhelvey/vitest-bdd";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vitestBddPlugin()],
});
```

### 2. Add globals type reference

In your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["@michaelhelvey/vitest-bdd/globals"]
  }
}
```

This makes `given`, `when`, `it`, `$inputs`, and `$subject` available as magic globals — no imports
needed.

### 3. (Optional) TypeScript language service plugin

For full editor support (autocomplete on `$inputs.` and `$subject.`, hover info, go-to-definition,
diagnostic suppression), add the language service plugin:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "@michaelhelvey/vitest-bdd/ts-plugin" }]
  }
}
```

## Quick Start

```typescript
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

given("a Counter", () => {
  $inputs = { initialValue: 0 };
  $subject = new Counter($inputs.initialValue);

  when("initialized with value 5", () => {
    $inputs.initialValue = 5;

    it("has value 5", () => {
      expect($subject.value).toEqual(5);
    });
  });

  when("incremented", () => {
    $subject.inc();

    it("has value 1", () => {
      expect($subject.value).toEqual(1);
    });
  });
});
```

## API

### `given(scenario, callback)`

Creates a describe block for a test context. Inside the callback:

- Assign `$inputs = { ... }` to define default input data.
- Assign `$subject = someExpression($inputs.prop)` to define how to create the test subject from
  inputs.
- Use `when()` and `it()` to define scenarios and assertions.

### `when(scenario, callback)`

Creates a nested describe block within a `given` or another `when`. Inside the callback, you can:

- **Modify inputs:** `$inputs.prop = newValue` — these become "modifiers" that run before subject
  creation, overriding defaults from enclosing scopes.
- **Perform side-effects:** any statement that references `$subject` and is _not_ inside an `it()`
  call becomes a "perform" action — it runs after subject creation but before assertions.
- **Nest further:** add more `when()` or `it()` calls.

### `it(scenario, callback)`

Creates a test case. Inside the callback, `$subject` refers to the freshly-created subject for this
test. The execution order for each `it()` is:

1. Create fresh inputs via the `$inputs` factory.
2. Apply all modifiers from enclosing `when()` blocks (innermost last).
3. Create the subject via the `$subject` factory.
4. Run all perform actions from enclosing `when()` blocks.
5. Run the test function.

### Skip and Only

All three functions support `.skip` and `.only` modifiers, mirroring Vitest's behavior:

```typescript
given.skip("feature under development", () => {
  // These tests won't run
});

given.only("feature to debug", () => {
  // Only these tests run
});

when.skip("edge case not yet handled", () => {});
when.only("scenario to debug", () => {});

it.skip("not implemented yet", () => {});
it.only("debugging this test", () => {});
```

### Iteration

Instead of a special `.each` method, use standard JavaScript iteration:

```typescript
given("addition", () => {
  $inputs = { a: 0, b: 0 };
  $subject = { sum: $inputs.a + $inputs.b };

  for (const [a, b, expected] of [
    [1, 2, 3],
    [2, 3, 5],
    [10, 20, 30],
  ]) {
    when(`adding ${a} + ${b}`, () => {
      $inputs.a = a;
      $inputs.b = b;

      it(`equals ${expected}`, () => {
        expect($subject.sum).toEqual(expected);
      });
    });
  }
});
```

## Usage Examples

### Testing a Class

```typescript
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

given("a Calculator", () => {
  $inputs = { initial: 0 };
  $subject = new Calculator($inputs.initial);

  when("starting at 10", () => {
    $inputs.initial = 10;

    it("has initial value 10", () => {
      expect($subject.getResult()).toEqual(10);
    });

    it("can add 5 to get 15", () => {
      $subject.add(5);
      expect($subject.getResult()).toEqual(15);
    });
  });

  when("5 is added", () => {
    $subject.add(5);

    it("equals 5", () => {
      expect($subject.getResult()).toEqual(5);
    });
  });
});
```

### Testing React Components

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect } from "vitest";

function Counter({ start }: { start: number }) {
  const [count, setCount] = useState(start);
  return (
    <div>
      <span data-testid="count">{count}</span>
      <button onClick={() => setCount((c) => c + 1)}>Increment</button>
    </div>
  );
}

afterEach(() => cleanup());

given("a Counter component", () => {
  $inputs = { start: 0 };
  $subject = render(<Counter start={$inputs.start} />);

  when("rendered with default props", () => {
    it("shows count as 0", () => {
      expect(screen.getByTestId("count").textContent).toEqual("0");
    });
  });

  when("starting at 5 and clicking increment", () => {
    $inputs.start = 5;
    await userEvent.click(screen.getByRole("button"));

    it("shows count as 6", () => {
      expect(screen.getByTestId("count").textContent).toEqual("6");
    });
  });
});
```

## Key Concepts

### Test Isolation

Every `it()` test receives a **completely fresh subject**. Mutations in one test never affect
another:

```typescript
given("something", () => {
  $inputs = { value: 0 };
  $subject = { count: $inputs.value };

  when("some scenario", () => {
    it("test A - mutates subject", () => {
      $subject.count = 999; // This mutation...
    });

    it("test B - gets fresh subject", () => {
      // ...does NOT affect this test. Fresh subject here.
      expect($subject.count).toEqual(0);
    });
  });
});
```

### Lazy Evaluation

`$inputs = expr` and `$subject = expr` don't execute immediately. They are transformed at compile
time into factory functions:

- `$inputs = { a: 1, b: 2 }` becomes `() => ({ a: 1, b: 2 })`
- `$subject = new Foo($inputs.a)` becomes `($inputs) => new Foo($inputs.a)`

Each `it()` invokes these factories fresh, applies any `when()` modifiers to the inputs, then
creates the subject. This is what enables the RSpec-like `let`/`subject` pattern — you declare
_what_ things are, and the framework handles _when_ they're created.

### Modifier and Perform Classification

Statements inside `when()` blocks are automatically classified:

- **Modifiers:** `$inputs.prop = value` — runs _before_ subject creation to override input defaults.
- **Performs:** any statement referencing `$subject` — runs _after_ subject creation, before
  assertions. Use these for side-effects like clicking buttons or calling methods.
- **Body code:** everything else (nested `when()`, `it()`, loops, etc.) — runs normally during test
  setup.

## How It Works

The Vite plugin transforms your BDD syntax at compile time into standard Vitest `describe`/`test`
calls. There is no runtime overhead beyond what Vitest itself provides.

The transformation:

- `given("...", fn)` → `describe("given ...", fn)` with factory registration
- `$inputs = expr` → a factory function `() => expr`
- `$subject = expr` → a factory function `($inputs) => expr`
- `$inputs.prop = value` inside `when()` → a modifier callback
- `$subject.method()` inside `when()` (outside `it()`) → a perform callback
- `it("...", fn)` → `test("...", fn)` that runs the full create → modify → perform → assert pipeline

## Editor Support

The TypeScript language service plugin (`"plugins": [{ "name": "@michaelhelvey/vitest-bdd" }]` in
tsconfig) provides:

- **Autocomplete** on `$inputs.` and `$subject.` based on their assigned types
- **Hover information** showing the inferred types of `$inputs` and `$subject`
- **Go-to-definition** navigation from `$inputs`/`$subject` references to their declarations
- **Diagnostic suppression** for false errors that TypeScript would otherwise report on the magic
  globals (e.g., "Cannot find name '$inputs'")

## License

MIT
