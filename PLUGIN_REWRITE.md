# Plugin Rewrite: Architecture Specification

## Overview

This document specifies the architecture for rewriting `vitest-bdd` as a Vite plugin + TypeScript
language service plugin. The goal is to replace the current function-based DSL with an RSpec-like
syntax using magic globals (`$inputs`, `$subject`), backed by compile-time code transforms and
editor-level type inference.

## Desired User-Facing Syntax

```typescript
given("a Foo", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  when("the user sets the value to 5", () => {
    $inputs.value = 5;

    it("has a value of 5", () => {
      expect($subject.value).toEqual(5);
    });
  });

  when("the user calls inc()", async () => {
    // Side-effects run inline after $subject creation.
    // The transform ensures $subject is created before this code runs.
    $subject.inc();

    it("increments the value to 1", () => {
      expect($subject.value).toEqual(1);
    });
  });
});
```

### Semantics

- `$inputs = { ... }` in a `given` block defines the default inputs factory.
- `$subject = expr` in a `given` block defines how to create the test subject from `$inputs`. Lazily
  evaluated per `it` case.
- `$inputs.prop = expr` in a `when` block overrides specific input values before subject creation.
- Code in a `when` block that references `$subject` (outside of an `it`) runs as a side-effect after
  subject creation (like the old `$.perform()`).
- `$subject` inside an `it` block resolves to the lazily-created subject for that test case.
- Each `it` case gets a completely fresh copy of inputs and a fresh subject instance.
- `.skip` and `.only` modifiers work on `given`, `when`, and `it` (e.g. `given.skip(...)`,
  `when.only(...)`, `it.skip(...)`).
- `.each` is not supported; users iterate manually.
- Cleanup is handled by the user via vitest's `afterEach()` directly.

## System Architecture

The system has three components:

```
                  Test File (.spec.ts)
                        |
                  [Vite Plugin]          <-- compile-time transform
                        |
                  Transformed JS         <-- uses runtime helpers
                        |
                  [Runtime Library]       <-- thin wrappers around vitest describe/test
                        |
                  Vitest

  Separately:
                  [TS Language Service Plugin]  <-- editor-time type inference
```

### Component 1: Vite Plugin (`src/plugin.ts`)

A Vite plugin that hooks into the `transform` step for test files matching `*.{spec,test}.{ts,tsx}`.
It uses the TypeScript compiler API to:

1. Parse the source into a TypeScript AST.
2. Walk the AST looking for `given()`, `when()`, and `it()` calls.
3. Rewrite `$inputs` and `$subject` references into runtime helper calls.
4. Emit transformed JavaScript (with source map).

#### Transform Strategy

The transform operates on the callbacks passed to `given`, `when`, and `it`. It analyzes each
callback body and rewrites it according to the block type.

**given callback transform:**

```typescript
// INPUT:
given("a Foo", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);
  // ... when/it blocks ...
});

// OUTPUT:
__given(
  "a Foo",
  {
    inputs: () => ({ value: 0 }),
    subject: ($inputs) => new Foo($inputs.value),
  },
  ($inputs, $subject) => {
    // ... when/it blocks (transformed) ...
  },
);
```

The transform extracts:

- `$inputs = expr` -> becomes the `inputs` factory function (returns `expr`).
- `$subject = expr` -> becomes the `subject` factory function. Any references to `$inputs` in `expr`
  are rewritten to reference the function parameter.
- Everything else in the callback body (when/it calls) becomes the body of the third argument.

**when callback transform:**

```typescript
// INPUT:
when("the user sets the value to 5", () => {
  $inputs.value = 5;
  $subject.inc(); // side-effect: runs after subject creation

  it("has a value of 5", () => {
    expect($subject.value).toEqual(5);
  });
});

// OUTPUT:
__when(
  "the user sets the value to 5",
  {
    modifier: ($inputs) => {
      $inputs.value = 5;
    },
    perform: ($subject) => {
      $subject.inc();
    },
  },
  ($inputs, $subject) => {
    __it("has a value of 5", ($subject) => {
      expect($subject.value).toEqual(5);
    });
  },
  __ctx,
);
```

The transform splits the `when` callback body into three parts by classifying each **direct
statement** of the callback:

1. **modifier**: Only direct `ExpressionStatement`s whose expression is an assignment to a property
   of `$inputs` (i.e. `$inputs.prop = expr`). No other statement shape qualifies -- loops,
   conditionals, function calls, etc. that happen to reference `$inputs` are NOT extracted as
   modifiers.
2. **perform**: Direct `ExpressionStatement`s that reference `$subject` and are NOT an `it()` call
   and are NOT inside an `it()` call. These are side-effects that run after subject creation.
3. **body**: Everything else -- `it()` calls, loops containing `it()` calls, conditionals, helper
   code, etc. These remain in the body function and are passed through with `it()` calls inside them
   transformed recursively.

The critical distinction is between _direct assignment statements_ (extracted) and _everything else_
(left in place). This ensures that control flow structures like loops and conditionals are never
torn apart by the transform.

**it callback transform:**

```typescript
// INPUT:
it("has a value of 5", () => {
  expect($subject.value).toEqual(5);
});

// OUTPUT:
__it("has a value of 5", ($subject) => {
  expect($subject.value).toEqual(5);
});
```

The `it` callback is the simplest: `$subject` references are rewritten to use the function parameter
that the runtime passes in.

#### Iteration to Generate Test Cases

The transform supports `when()` and `it()` calls appearing inside loops, `.forEach()`, `.map()`, or
any other control flow structure. This is a common pattern for generating parameterized tests
without `.each`:

**Iterating over `when` blocks:**

```typescript
// INPUT:
given("a Calculator", () => {
  $inputs = { a: 0, b: 0 };
  $subject = new Calculator($inputs.a, $inputs.b);

  for (const [a, b, expected] of [
    [1, 2, 3],
    [2, 3, 5],
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

// OUTPUT:
__given(
  "a Calculator",
  {
    inputs: () => ({ a: 0, b: 0 }),
    subject: ($inputs) => new Calculator($inputs.a, $inputs.b),
  },
  ($inputs, $subject) => {
    for (const [a, b, expected] of [
      [1, 2, 3],
      [2, 3, 5],
    ]) {
      __when(
        `adding ${a} + ${b}`,
        {
          modifier: ($inputs) => {
            $inputs.a = a;
            $inputs.b = b;
          },
        },
        ($inputs, $subject) => {
          __it(`equals ${expected}`, ($subject) => {
            expect($subject.sum).toEqual(expected);
          });
        },
        __ctx,
      );
    }
  },
);
```

The `for` loop passes through untouched. Only the `when()` and `it()` calls inside it are
transformed.

**Iterating over `it` blocks:**

```typescript
// INPUT:
when("multiplying", () => {
  const cases = [
    [2, 3, 6],
    [4, 5, 20],
  ] as const;
  for (const [x, y, expected] of cases) {
    it(`${x} * ${y} = ${expected}`, () => {
      expect($subject.multiply(x, y)).toEqual(expected);
    });
  }
});

// OUTPUT:
__when(
  "multiplying",
  {},
  ($inputs, $subject) => {
    const cases = [
      [2, 3, 6],
      [4, 5, 20],
    ] as const;
    for (const [x, y, expected] of cases) {
      __it(`${x} * ${y} = ${expected}`, ($subject) => {
        expect($subject.multiply(x, y)).toEqual(expected);
      });
    }
  },
  __ctx,
);
```

The `const cases = ...` declaration and `for` loop are neither modifier statements nor perform
statements (they're not direct `$inputs.prop = expr` assignments, and they don't directly reference
`$subject` at the statement level). So they stay in the body. The `it()` calls inside the loop are
found by the recursive AST walk and transformed normally.

This works because the transform finds call expressions by **recursively walking the entire AST
subtree**, not by iterating over direct statements. Any `given()`, `when()`, or `it()` call is
transformed regardless of how deeply nested it is in control flow.

#### AST Walk Algorithm

The transform recursively walks the entire AST looking for call expressions. It does NOT iterate
over direct statements only -- `given()`, `when()`, and `it()` calls are found regardless of how
deeply they are nested in control flow (loops, conditionals, `.forEach()`, etc.).

```
function walkNode(node, parentContext):
  if node is a call expression:
    if callee is `given` (or `given.skip`, `given.only`):
      extract the callback argument (2nd arg)
      scan callback body for:
        - `$inputs = expr`     -> extract as inputs factory
        - `$subject = expr`    -> extract as subject factory
      recursively walkNode on remaining callback body with context = "given"

    if callee is `when` (or `when.skip`, `when.only`):
      assert parentContext is "given"
      extract the callback argument (2nd arg)
      classify direct statements of callback body:
        - direct `$inputs.X = expr` assignments   -> extract as modifier
        - direct statements referencing `$subject` (not inside it()) -> extract as perform
        - everything else                          -> leave in body
      recursively walkNode on callback body with context = "when"

    if callee is `it` (or `it.skip`, `it.only`):
      assert parentContext is "when" or "given"
      extract the callback argument (2nd arg)
      rewrite `$subject` references to use parameter

  for each child of node:
    walkNode(child, parentContext)
```

The key point: the recursive walk descends into ALL child nodes (including loop bodies, conditional
branches, array method callbacks, etc.), so `when()` and `it()` calls inside a `for` loop or
`.forEach()` are found and transformed just like direct calls.

#### Edge Cases and Validation

The transform should emit compile-time errors for:

- `$inputs` assigned outside a `given` callback
- `$subject` assigned outside a `given` callback
- `$inputs` reassigned (not property-modified) inside a `when` callback
- `$subject` assigned inside a `when` or `it` callback
- `given`/`when`/`it` called outside their expected nesting (e.g. `when` outside `given`)

#### Source Transforms and Source Maps

The transform uses two tools in tandem:

1. **TypeScript compiler API** (`ts.createSourceFile`) -- parses the source into an AST for
   analysis. We walk the AST to find `given`/`when`/`it` calls and `$inputs`/`$subject` references,
   collecting their positions and structural relationships. We do NOT use `ts.factory` or
   `ts.Printer` to produce output.

2. **`magic-string`** -- performs positional text mutations on the original source and generates
   source maps. Each transform operation maps to one or more `magic-string` calls:
   - `s.overwrite(start, end, newText)` -- replace a span (e.g., rewriting `$inputs = expr` into a
     factory function)
   - `s.remove(start, end)` -- remove a span (e.g., extracting a statement from its original
     position)
   - `s.appendLeft(pos, text)` / `s.prependRight(pos, text)` -- insert text at a position (e.g.,
     wrapping extracted statements in a function body)

   At the end, `s.toString()` returns the transformed code and `s.generateMap()` returns a source
   map, which are returned directly from the Vite `transform` hook as `{ code, map }`.

This approach was chosen over the TypeScript Printer for three reasons:

- **Source map quality**: `magic-string` tracks every character-level mutation against the original
  source, producing precise mappings. The TS Printer's source map support is designed for the full
  compiler pipeline and is awkward to use in isolation.
- **Formatting preservation**: Untouched regions of the file (user code inside `it` callbacks,
  import statements, helper functions, etc.) are preserved exactly as written. Only the parts we
  explicitly rewrite change.
- **Ecosystem alignment**: This is the standard pattern for Vite plugin transforms (used by Vue,
  Svelte, and Vite itself). The `transform` hook expects `{ code, map }` and `magic-string` produces
  exactly that.

#### Transform Ordering

When applying mutations via `magic-string`, the order matters. The transform processes the AST
bottom-up (innermost nodes first) to avoid position invalidation:

1. Transform all `it` callbacks (rewrite `$subject` references).
2. Transform all `when` callbacks (split body, extract modifier/perform/it calls).
3. Transform all `given` callbacks (extract `$inputs`/`$subject` assignments, wrap body).
4. Add the runtime import at the top of the file.

Processing inner nodes first ensures that when we process an outer node, the positions of its
children in the original source are still valid (since `magic-string` mutations at inner positions
don't shift the outer node boundaries -- `magic-string` tracks positions in the original source, not
the mutated output).

### Component 2: Runtime Library (`src/runtime.ts`)

The runtime is a set of thin functions that the transformed code calls. They wrap vitest's
`describe` and `test` to provide the BDD semantics.

```typescript
import { afterEach, describe, test } from "vitest";

interface GivenConfig<TInputs, TSubject> {
  inputs: () => TInputs;
  subject: (inputs: TInputs) => TSubject;
}

interface WhenConfig<TInputs, TSubject> {
  modifier?: (inputs: TInputs) => void;
  perform?: (subject: TSubject) => void | Promise<void>;
}

/**
 * Runtime implementation of a `given` block.
 * Wraps vitest's `describe` and manages the inputs/subject lifecycle.
 */
export function __given<TInputs extends Record<string, unknown>, TSubject>(
  scenario: string,
  config: GivenConfig<TInputs, TSubject>,
  body: (inputs: TInputs, subject: TSubject) => void,
  describeFn: typeof describe = describe,
): void {
  // Creates a describe block and passes context down
}

/**
 * Runtime implementation of a `when` block.
 * Manages input modification and side-effects.
 */
export function __when<TInputs extends Record<string, unknown>, TSubject>(
  scenario: string,
  config: WhenConfig<TInputs, TSubject>,
  body: (inputs: TInputs, subject: TSubject) => void,
  ctx: RuntimeContext<TInputs, TSubject>,
  describeFn: typeof describe = describe,
): void {
  // Creates a nested describe block with modified context
}

/**
 * Runtime implementation of an `it` block.
 * Each call creates a fresh inputs copy, builds subject, runs perform, then asserts.
 */
export function __it<TSubject>(
  scenario: string,
  testFn: (subject: TSubject) => void | Promise<void>,
  ctx: RuntimeContext<unknown, TSubject>,
  testRunner: typeof test = test,
): void {
  // Creates a test case with fresh state
}
```

The key data structure is a **RuntimeContext** that flows from `__given` down through `__when` to
`__it`:

```typescript
interface RuntimeContext<TInputs, TSubject> {
  /** Factory that returns a fresh copy of the default inputs */
  inputs: () => TInputs;
  /** Factory that creates a subject from inputs */
  subject: (inputs: TInputs) => TSubject;
  /** Stack of modifier functions to apply to inputs (from nested when blocks) */
  modifiers: Array<(inputs: TInputs) => void>;
  /** Stack of perform functions to run after subject creation */
  performs: Array<(subject: TSubject) => void | Promise<void>>;
}
```

When `__it` executes a test:

1. Call `ctx.inputs()` to get a fresh copy of the default inputs.
2. Apply all `ctx.modifiers` in order (from outermost `when` to innermost).
3. Call `ctx.subject(modifiedInputs)` to create the subject.
4. Run all `ctx.performs` in order.
5. Call the test function with the subject.

This gives us the same isolation guarantees as the current implementation: every `it` case gets
completely fresh state.

#### Skip/Only Support

The runtime functions accept an optional `describeFn`/`testRunner` parameter that defaults to
vitest's `describe`/`test`. The Vite transform detects `.skip`/`.only` modifiers and passes
`describe.skip`, `describe.only`, `test.skip`, or `test.only` accordingly.

### Component 3: TypeScript Language Service Plugin (`src/ts-plugin.ts`)

The TS language service plugin provides editor support for the magic globals. It hooks into the
TypeScript language server and:

1. **Suppresses diagnostics** for `$inputs` and `$subject` being undeclared variables.
2. **Provides type information** by analyzing the `given` block context to infer the types of
   `$inputs` and `$subject`.
3. **Enables completions, hover, and go-to-definition** for the magic globals.

#### How Type Inference Works

The plugin infers types for `$inputs` and `$subject` sequentially, building up context so that each
subsequent inference has the declarations it needs:

**Step 1 -- Infer `$inputs`**: Find the `$inputs = expr` assignment in the `given` callback.

- If the user wrote an explicit type via `satisfies` or `as` (e.g.,
  `$inputs = { value: 0 } satisfies MyInputs` or `$inputs = { value: 0 } as MyInputs`), use that
  type.
- Otherwise, ask the checker for the type of `expr`. This is self-contained -- `$inputs` doesn't
  reference any other magic global.
- Result: `TInputs`.

**Step 2 -- Inject `$inputs` declaration**: Virtually inject `declare let $inputs: TInputs` into the
checker's view of the file, scoped to the `given` callback. This makes `$inputs` a known variable so
the checker can resolve expressions like `$inputs.value`.

**Step 3 -- Infer `$subject`**: Find the `$subject = expr` assignment.

- If the user wrote an explicit type (e.g., `$subject = new Foo($inputs.value) satisfies Foo`), use
  that type.
- Otherwise, ask the checker for the type of `expr`. Because `$inputs` is now declared (from step
  2), expressions like `new Foo($inputs.value)` resolve correctly -- the checker knows the type of
  `$inputs.value` and can infer constructor argument types, return types, generic type parameters,
  etc.
- Result: `TSubject`.

**Step 4 -- Inject `$subject` declaration**: Virtually inject `declare let $subject: TSubject` into
the checker's view. Now both magic globals are fully typed throughout the `given`/`when`/`it` tree.

#### Scoping

Each `given` callback is a separate scope. If a file contains multiple `given` blocks with different
`$inputs` types, each gets its own virtual declarations. The plugin determines which `given` block a
cursor position falls within by walking the AST to find the enclosing `given()` call expression.

#### Explicit Type Annotations

Users can explicitly annotate `$inputs` or `$subject` using standard TypeScript expressions:

```typescript
given("a Foo", () => {
  // Using `satisfies` -- validates the expression conforms to the type, preserves narrow type
  $inputs = { value: 0 } satisfies FooInputs;

  // Using `as` -- type assertion, overrides inference entirely
  $subject = createFoo($inputs) as Foo;
});
```

The plugin respects these annotations: if a `satisfies` or `as` expression wraps the assignment, the
annotated type is used directly. No special syntax is needed beyond standard TypeScript.

#### Plugin Structure

Following the pattern from the reference project:

```typescript
// src/ts-plugin.ts
import type ts from "typescript";

const pluginModuleFactory: ts.server.PluginModuleFactory = ({ typescript }) => {
  return {
    create(info: ts.server.PluginCreateInfo): ts.LanguageService {
      const proxy = createLanguageServiceProxy(info);
      return proxy;
    },
  };
};

export = pluginModuleFactory;
```

Methods to proxy:

- `getSemanticDiagnostics` -- filter out "undeclared variable" errors for `$inputs`/`$subject`
- `getCompletionsAtPosition` -- provide completions based on inferred types (e.g., `$inputs.` shows
  properties of `TInputs`, `$subject.` shows properties of `TSubject`)
- `getQuickInfoAtPosition` -- show inferred type on hover
- `getDefinitionAtPosition` -- jump to the `$inputs`/`$subject` assignment

#### Configuration

Users add the plugin to their `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "@michaelhelvey/vitest-bdd" }]
  }
}
```

## File Structure

After the rewrite, the project will have:

```
src/
  plugin.ts          # Vite plugin (transform hook)
  plugin.test.ts     # Tests for the plugin (uses itself!)
  runtime.ts         # Runtime helpers (__given, __when, __it)
  runtime.test.ts    # Unit tests for runtime (direct calls, no transform)
  ts-plugin.ts       # TypeScript language service plugin
  transform.ts       # AST transform logic (used by plugin.ts)
```

The existing `src/index.ts` and `src/index.test.tsx` remain unchanged until the rewrite is complete
and validated, at which point they are replaced.

## Implementation Plan

### Phase 1: Runtime Library

Build and test the runtime helpers (`__given`, `__when`, `__it`) independently. These can be tested
directly without any transform, by calling them with manually-constructed configs. This validates
the core BDD semantics work correctly.

### Phase 2: Vite Plugin (Transform)

Build the AST transform that rewrites user code into runtime calls. Test by writing actual
`.spec.ts` files using the new syntax, with the Vite plugin active in `vitest.config.ts`. Since the
plugin transforms test files, the library tests itself.

### Phase 3: TypeScript Language Service Plugin

Build the TS plugin for editor support. This is tested via the reference project's pattern: fork a
real `tsserver` process, send it requests, and verify the responses.

### Phase 4: Cleanup

Remove old DSL code, update package exports, documentation, and CI.

## Open Questions / Risks

1. **Virtual declaration injection**: The TS plugin needs to inject `declare let $inputs: T` and
   `declare let $subject: T` into the checker's view of the file without modifying the actual
   source. The mechanism for doing this within a language service plugin needs investigation --
   options include modifying the `SourceFile` AST in the plugin's virtual view, or intercepting
   `getScriptSnapshot` to provide a modified source with the declarations prepended to each `given`
   callback. The sequential inference (infer `$inputs` first, inject its declaration, then infer
   `$subject`) may require two passes through the checker for each `given` block.

2. **Error messages**: Validation errors (e.g., non-inline callback, `$inputs` used outside a
   `given` block) are emitted by the transform _before_ any output is produced. Since the transform
   has the original AST, it can use `ts.getLineAndCharacterOfPosition(sourceFile, node.getStart())`
   to produce clear, human-readable errors pointing at the offending call in the original source.
   For example:

   ```
   vitest-bdd: when() at src/foo.test.ts:14:5 requires an inline function
   expression as its second argument, but got an identifier.
   ```

   This is unrelated to source maps. Source maps handle the separate concern of mapping positions in
   the _transformed output_ back to original source (for stack traces, debugger breakpoints, etc.).

3. **Transform robustness**: The transform assumes `given`/`when`/`it` are called with a string
   literal and an inline callback (arrow function or function expression). Patterns that break this
   assumption will not be transformed:
   - Aliasing: `const g = given; g("...", () => { ... })` -- callee is `g`, not `given`
   - Spread args: `given(...args)` -- callback cannot be statically identified
   - Computed names: `given(getName(), () => { ... })` -- fine, this actually works (we don't care
     about the name argument's shape, only the callback)
   - Callback stored in variable: `const cb = () => { ... }; given("...", cb)` -- the callback body
     is not inline, so we can't analyze it

   We should emit clear errors when we detect a `given`/`when`/`it` call whose callback argument is
   not an inline function expression. The aliasing case is harder to detect and will simply not be
   transformed (no error, no magic -- it just won't work).
