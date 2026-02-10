import { afterEach, describe, test } from "vitest";

/**
 * Arguments passed to the modifier function in a `when` block.
 *
 * @typeParam TInputs - The type of the input object passed to the `given` block.
 * @typeParam TWorldState - The type of the world state created by the factory function.
 */
interface ModifierArgs<TInputs, TWorldState> {
  /** A proxy to the inputs object; modifications here affect state creation. */
  inputs: TInputs;
  /** The lazily-created world state (accessing it triggers creation). */
  state: TWorldState;
  /** Registers an async action to run after state creation but before assertions. */
  perform: (performFn: () => void | Promise<void>) => void;
}

/**
 * A test assertion function used within `when` blocks to define individual test cases.
 *
 * @typeParam TWorldState - The type of the world state created by the `given` block's factory function.
 *
 * @example
 * ```tsx
 * // Inside a when() block:
 * ({ it }) => {
 *   it("has a value of 5", (worldState) => {
 *     expect(worldState.value).toEqual(5);
 *   });
 *
 *   // Skip a test
 *   it.skip("not implemented yet", (worldState) => {
 *     // ...
 *   });
 *
 *   // Focus on a single test
 *   it.only("debug this", (worldState) => {
 *     // ...
 *   });
 *
 *   // Parameterized tests
 *   it.each([
 *     [1, 2, 3],
 *     [2, 3, 5],
 *   ])("adds %d + %d = %d", (a, b, expected, worldState) => {
 *     expect(worldState.add(a, b)).toBe(expected);
 *   });
 * }
 * ```
 */
export interface ItFunction<TWorldState> {
  (scenario: string, testFn: (worldState: TWorldState) => void | Promise<void>): void;
  /** Skip this test. */
  skip: ItFunction<TWorldState>;
  /** Only run this test (and others marked with only). */
  only: ItFunction<TWorldState>;
  /** Run parameterized tests with printf-style formatting. WorldState is passed as the last argument. */
  each: <T extends readonly unknown[] | readonly [unknown]>(
    cases: readonly T[],
  ) => (scenario: string, testFn: (...args: [...T, TWorldState]) => void | Promise<void>) => void;
}

/**
 * A function for defining a scenario within a `given` block that modifies the world state
 * before running assertions.
 *
 * @typeParam TInputs - The type of the input object passed to the `given` block.
 * @typeParam TWorldState - The type of the world state created by the factory function.
 *
 * @example
 * ```tsx
 * // Inside a given() block:
 * ({ when }) => {
 *   when(
 *     "the user sets the value to 10",
 *     ($) => {
 *       $.inputs.initialValue = 10;
 *     },
 *     ({ it }) => {
 *       it("reflects the new value", (state) => {
 *         expect(state.value).toEqual(10);
 *       });
 *     }
 *   );
 *
 *   // Skip a scenario
 *   when.skip("not implemented", ($) => {}, ({ it }) => { ... });
 *
 *   // Focus on a scenario
 *   when.only("debug this", ($) => {}, ({ it }) => { ... });
 *
 *   // Parameterized scenarios
 *   when.each([
 *     [1, "click"],
 *     [2, "double-click"],
 *   ])("user performs %s %d times", ($, count, action) => {
 *     $.perform(async () => { ... });
 *   }, ({ it }) => { ... });
 * }
 * ```
 */
export interface WhenFunction<TInputs, TWorldState> {
  (
    scenario: string,
    modifier: (args: ModifierArgs<TInputs, TWorldState>) => void | Promise<void>,
    tests: (helpers: { it: ItFunction<TWorldState> }) => void,
  ): void;
  /** Skip this scenario. */
  skip: WhenFunction<TInputs, TWorldState>;
  /** Only run this scenario (and others marked with only). */
  only: WhenFunction<TInputs, TWorldState>;
  /** Run parameterized scenarios with printf-style formatting. Case args are passed after ModifierArgs. */
  each: <T extends readonly unknown[] | readonly [unknown]>(
    cases: readonly T[],
  ) => (
    scenario: string,
    modifier: (
      args: ModifierArgs<TInputs, TWorldState>,
      ...caseArgs: [...T]
    ) => void | Promise<void>,
    tests: (helpers: { it: ItFunction<TWorldState> }) => void,
  ) => void;
}

type GivenTestsCallback<TInputs, TWorldState> = (helpers: {
  when: WhenFunction<TInputs, TWorldState>;
  cleanup: (cleanupFn: () => void | Promise<void>) => void;
}) => void;

/**
 * Creates a BDD-style test suite with isolated world state for each test case.
 *
 * The `given` function establishes a test context with:
 * - A scenario description
 * - Initial inputs that can be modified per-scenario
 * - A factory function that creates fresh world state from inputs
 * - Nested `when` blocks for different scenarios with their own `it` assertions
 *
 * Each `it` test receives a completely fresh world state, ensuring test isolation.
 * Inputs can be modified in `when` blocks before state creation, but not after
 * state has been accessed (this throws an error to prevent confusing behavior).
 *
 * @example
 * ```tsx
 * // Basic usage
 * given(
 *   "a Counter",
 *   { initialValue: 0 },
 *   ({ initialValue }) => new Counter(initialValue),
 *   ({ when }) => {
 *     when(
 *       "initialized with value 5",
 *       ($) => { $.inputs.initialValue = 5; },
 *       ({ it }) => {
 *         it("has value 5", (counter) => {
 *           expect(counter.value).toEqual(5);
 *         });
 *       }
 *     );
 *   }
 * );
 *
 * // Skip a test suite
 * given.skip("disabled feature", inputs, factory, tests);
 *
 * // Focus on a test suite
 * given.only("debug this", inputs, factory, tests);
 *
 * // Parameterized test suites
 * given.each([
 *   [1, 2, 3],
 *   [2, 3, 5],
 * ])(
 *   "adding %d + %d = %d",
 *   (a, b, expected) => ({ a, b, expected }),
 *   (inputs) => ({ sum: inputs.a + inputs.b }),
 *   ({ when }) => { ... }
 * );
 * ```
 */
export interface GivenFunction {
  <TInputs extends Record<string, unknown>, TWorldState>(
    scenario: string,
    inputs: TInputs,
    createWorldState: (inputs: TInputs) => TWorldState,
    tests: GivenTestsCallback<TInputs, TWorldState>,
  ): void;
  /** Skip this test suite. */
  skip: GivenFunction;
  /** Only run this test suite (and others marked with only). */
  only: GivenFunction;
  /** Run parameterized test suites with printf-style formatting. Inputs can be a function of case args. */
  each: <T extends readonly unknown[] | readonly [unknown]>(
    cases: readonly T[],
  ) => <TInputs extends Record<string, unknown>, TWorldState>(
    scenario: string,
    inputs: TInputs | ((...caseArgs: [...T]) => TInputs),
    createWorldState: (inputs: TInputs) => TWorldState,
    tests: GivenTestsCallback<TInputs, TWorldState>,
  ) => void;
}

type DescribeLike = (name: string, fn: () => void) => void;
type TestLike = (name: string, fn: () => void | Promise<void>) => void;
type EachFn = (
  cases: readonly (readonly unknown[])[],
) => (name: string, fn: (...args: unknown[]) => void | Promise<void>) => void;

async function runTest<TInputs extends Record<string, unknown>, TWorldState>(
  inputs: TInputs,
  createWorldState: (inputs: TInputs) => TWorldState,
  modifier: (args: ModifierArgs<TInputs, TWorldState>) => void | Promise<void>,
  getCleanupFn: () => (() => void | Promise<void>) | undefined,
  testCallback: (worldState: TWorldState) => void | Promise<void>,
) {
  const testInputs = { ...inputs };
  let worldState: TWorldState | undefined;
  let stateCreated = false;

  const getState = (): TWorldState => {
    if (!stateCreated) {
      worldState = createWorldState(testInputs);
      stateCreated = true;
    }
    return worldState as TWorldState;
  };

  const inputsProxy = new Proxy(testInputs, {
    get(target, prop) {
      return (target as Record<string, unknown>)[prop as string];
    },
    set(target, prop, value) {
      if (stateCreated) {
        throw new Error(
          "Cannot modify inputs after state has been accessed, as this would re-create the world state, destroying the point of why you accessed state in the first place.",
        );
      }
      (target as Record<string, unknown>)[prop as string] = value;
      return true;
    },
  });

  let _performFn: (() => void | Promise<void>) | undefined;

  await modifier({
    inputs: inputsProxy,
    get state() {
      return getState();
    },
    perform: (performFn) => {
      if (stateCreated) {
        throw new Error(
          "perform() cannot be called after state has been accessed, as this would re-create the world state, destroying any potential side-effects you were trying to perform in the first place.",
        );
      }
      if (_performFn) {
        throw new Error(
          "perform() can only be called once in a modifier, as allowing multiple calls would make it unclear when the perform function is supposed to be called.",
        );
      }
      _performFn = performFn;
    },
  });

  const finalState = getState();
  await _performFn?.();
  await testCallback(finalState);
  await getCleanupFn()?.();
}

function createItBase<TInputs extends Record<string, unknown>, TWorldState>(
  testFn: TestLike,
  inputs: TInputs,
  createWorldState: (inputs: TInputs) => TWorldState,
  modifier: (args: ModifierArgs<TInputs, TWorldState>) => void | Promise<void>,
  getCleanupFn: () => (() => void | Promise<void>) | undefined,
) {
  return (
    testScenario: string,
    testCallback: (worldState: TWorldState) => void | Promise<void>,
  ) => {
    testFn(`it: ${testScenario}`, async () => {
      await runTest(inputs, createWorldState, modifier, getCleanupFn, testCallback);
    });
  };
}

function createItEach<TInputs extends Record<string, unknown>, TWorldState>(
  testEachFn: EachFn,
  inputs: TInputs,
  createWorldState: (inputs: TInputs) => TWorldState,
  modifier: (args: ModifierArgs<TInputs, TWorldState>) => void | Promise<void>,
  getCleanupFn: () => (() => void | Promise<void>) | undefined,
) {
  return <T extends readonly unknown[] | readonly [unknown]>(cases: readonly T[]) => {
    return (
      scenario: string,
      testCallback: (...args: [...T, TWorldState]) => void | Promise<void>,
    ) => {
      testEachFn(cases)(`it: ${scenario}`, async (...caseArgs: unknown[]) => {
        await runTest(inputs, createWorldState, modifier, getCleanupFn, (state) =>
          testCallback(...(caseArgs as [...T]), state),
        );
      });
    };
  };
}

function createIt<TInputs extends Record<string, unknown>, TWorldState>(
  inputs: TInputs,
  createWorldState: (inputs: TInputs) => TWorldState,
  modifier: (args: ModifierArgs<TInputs, TWorldState>) => void | Promise<void>,
  getCleanupFn: () => (() => void | Promise<void>) | undefined,
): ItFunction<TWorldState> {
  const it = createItBase(test, inputs, createWorldState, modifier, getCleanupFn);

  Object.defineProperty(it, "skip", {
    get() {
      return createItBase(test.skip, inputs, createWorldState, modifier, getCleanupFn);
    },
  });

  Object.defineProperty(it, "only", {
    get() {
      return createItBase(test.only, inputs, createWorldState, modifier, getCleanupFn);
    },
  });

  Object.defineProperty(it, "each", {
    get() {
      return createItEach(
        test.each.bind(test) as EachFn,
        inputs,
        createWorldState,
        modifier,
        getCleanupFn,
      );
    },
  });

  return it as ItFunction<TWorldState>;
}

function createWhenBase<TInputs extends Record<string, unknown>, TWorldState>(
  describeFn: DescribeLike,
  inputs: TInputs,
  createWorldState: (inputs: TInputs) => TWorldState,
  getCleanupFn: () => (() => void | Promise<void>) | undefined,
) {
  return (
    scenario: string,
    modifier: (args: ModifierArgs<TInputs, TWorldState>) => void | Promise<void>,
    tests: (helpers: { it: ItFunction<TWorldState> }) => void,
  ) => {
    describeFn(`when: ${scenario}`, () => {
      const it = createIt(inputs, createWorldState, modifier, getCleanupFn);
      tests({ it });
    });
  };
}

function createWhenEach<TInputs extends Record<string, unknown>, TWorldState>(
  describeEachFn: EachFn,
  inputs: TInputs,
  createWorldState: (inputs: TInputs) => TWorldState,
  getCleanupFn: () => (() => void | Promise<void>) | undefined,
) {
  return <T extends readonly unknown[] | readonly [unknown]>(cases: readonly T[]) => {
    return (
      scenario: string,
      modifier: (
        args: ModifierArgs<TInputs, TWorldState>,
        ...caseArgs: [...T]
      ) => void | Promise<void>,
      tests: (helpers: { it: ItFunction<TWorldState> }) => void,
    ) => {
      describeEachFn(cases)(`when: ${scenario}`, (...caseArgs: unknown[]) => {
        const boundModifier = (args: ModifierArgs<TInputs, TWorldState>) =>
          modifier(args, ...(caseArgs as [...T]));
        const it = createIt(inputs, createWorldState, boundModifier, getCleanupFn);
        tests({ it });
      });
    };
  };
}

function createWhen<TInputs extends Record<string, unknown>, TWorldState>(
  inputs: TInputs,
  createWorldState: (inputs: TInputs) => TWorldState,
  getCleanupFn: () => (() => void | Promise<void>) | undefined,
): WhenFunction<TInputs, TWorldState> {
  const when = createWhenBase(describe, inputs, createWorldState, getCleanupFn);

  Object.defineProperty(when, "skip", {
    get() {
      return createWhenBase(describe.skip, inputs, createWorldState, getCleanupFn);
    },
  });

  Object.defineProperty(when, "only", {
    get() {
      return createWhenBase(describe.only, inputs, createWorldState, getCleanupFn);
    },
  });

  Object.defineProperty(when, "each", {
    get() {
      return createWhenEach(
        describe.each.bind(describe) as EachFn,
        inputs,
        createWorldState,
        getCleanupFn,
      );
    },
  });

  return when as WhenFunction<TInputs, TWorldState>;
}

function givenImpl<TInputs extends Record<string, unknown>, TWorldState>(
  describeFn: DescribeLike,
  scenario: string,
  inputs: TInputs,
  createWorldState: (inputs: TInputs) => TWorldState,
  tests: GivenTestsCallback<TInputs, TWorldState>,
): void {
  describeFn(`given: ${scenario}`, () => {
    let _cleanupFn: (() => void | Promise<void>) | undefined;
    const getCleanupFn = () => _cleanupFn;

    const cleanup = (cleanupFn: () => void | Promise<void>) => {
      _cleanupFn = cleanupFn;
      afterEach(async () => {
        await cleanupFn();
      });
    };

    const when = createWhen(inputs, createWorldState, getCleanupFn);
    tests({ when, cleanup });
  });
}

function givenEachImpl<T extends readonly unknown[] | readonly [unknown]>(
  describeEachFn: EachFn,
  cases: readonly T[],
): <TInputs extends Record<string, unknown>, TWorldState>(
  scenario: string,
  inputs: TInputs | ((...caseArgs: [...T]) => TInputs),
  createWorldState: (inputs: TInputs) => TWorldState,
  tests: GivenTestsCallback<TInputs, TWorldState>,
) => void {
  return <TInputs extends Record<string, unknown>, TWorldState>(
    scenario: string,
    inputs: TInputs | ((...caseArgs: [...T]) => TInputs),
    createWorldState: (inputs: TInputs) => TWorldState,
    tests: GivenTestsCallback<TInputs, TWorldState>,
  ) => {
    describeEachFn(cases)(`given: ${scenario}`, (...caseArgs: unknown[]) => {
      let _cleanupFn: (() => void | Promise<void>) | undefined;
      const getCleanupFn = () => _cleanupFn;

      const cleanup = (cleanupFn: () => void | Promise<void>) => {
        _cleanupFn = cleanupFn;
        afterEach(async () => {
          await cleanupFn();
        });
      };

      const resolvedInputs =
        typeof inputs === "function"
          ? (inputs as (...caseArgs: [...T]) => TInputs)(...(caseArgs as [...T]))
          : inputs;

      const when = createWhen(resolvedInputs, createWorldState, getCleanupFn);
      tests({ when, cleanup });
    });
  };
}

function createGiven(): GivenFunction {
  const baseFn = <TInputs extends Record<string, unknown>, TWorldState>(
    scenario: string,
    inputs: TInputs,
    createWorldState: (inputs: TInputs) => TWorldState,
    tests: GivenTestsCallback<TInputs, TWorldState>,
  ) => {
    givenImpl(describe, scenario, inputs, createWorldState, tests);
  };

  Object.defineProperty(baseFn, "skip", {
    get() {
      const skipFn = <TInputs extends Record<string, unknown>, TWorldState>(
        scenario: string,
        inputs: TInputs,
        createWorldState: (inputs: TInputs) => TWorldState,
        tests: GivenTestsCallback<TInputs, TWorldState>,
      ) => {
        givenImpl(describe.skip, scenario, inputs, createWorldState, tests);
      };

      Object.defineProperty(skipFn, "each", {
        get() {
          return <T extends readonly unknown[] | readonly [unknown]>(cases: readonly T[]) =>
            givenEachImpl(describe.skip.each.bind(describe.skip) as EachFn, cases);
        },
      });

      return skipFn;
    },
  });

  Object.defineProperty(baseFn, "only", {
    get() {
      const onlyFn = <TInputs extends Record<string, unknown>, TWorldState>(
        scenario: string,
        inputs: TInputs,
        createWorldState: (inputs: TInputs) => TWorldState,
        tests: GivenTestsCallback<TInputs, TWorldState>,
      ) => {
        givenImpl(describe.only, scenario, inputs, createWorldState, tests);
      };

      Object.defineProperty(onlyFn, "each", {
        get() {
          return <T extends readonly unknown[] | readonly [unknown]>(cases: readonly T[]) =>
            givenEachImpl(describe.only.each.bind(describe.only) as EachFn, cases);
        },
      });

      return onlyFn;
    },
  });

  Object.defineProperty(baseFn, "each", {
    get() {
      return <T extends readonly unknown[] | readonly [unknown]>(cases: readonly T[]) =>
        givenEachImpl(describe.each.bind(describe) as EachFn, cases);
    },
  });

  return baseFn as GivenFunction;
}

export const given: GivenFunction = createGiven();
