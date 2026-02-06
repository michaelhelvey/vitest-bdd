import { afterEach, describe, test } from "vitest";

interface ModifierArgs<TInputs, TWorldState> {
  inputs: TInputs;
  state: TWorldState;
  perform: (performFn: () => void | Promise<void>) => void;
}

/**
 * A test assertion function used within `when` blocks to define individual test cases.
 *
 * @typeParam TWorldState - The type of the world state created by the `given` block's factory function.
 *
 * @param scenario - A description of what the test is asserting (e.g., "has a value of 5").
 * @param testFn - The test function that receives the world state and performs assertions.
 *
 * @example
 * ```tsx
 * // Inside a when() block:
 * ({ it }) => {
 *   it("has a value of 5", (worldState) => {
 *     expect(worldState.value).toEqual(5);
 *   });
 *
 *   it("can be incremented", (worldState) => {
 *     worldState.inc();
 *     expect(worldState.value).toEqual(6);
 *   });
 * }
 * ```
 */
export type ItFunction<TWorldState> = (
  scenario: string,
  testFn: (worldState: TWorldState) => void | Promise<void>,
) => void;

/**
 * A function for defining a scenario within a `given` block that modifies the world state
 * before running assertions.
 *
 * @typeParam TInputs - The type of the input object passed to the `given` block.
 * @typeParam TWorldState - The type of the world state created by the factory function.
 *
 * @param scenario - A description of the scenario (e.g., "the user clicks the button").
 * @param modifier - A function that can modify inputs, access state, and register a `perform` action.
 *   - `inputs`: A proxy to the inputs object; modifications here affect state creation.
 *   - `state`: The lazily-created world state (accessing it triggers creation).
 *   - `perform`: Registers an async action to run after state creation but before assertions.
 * @param tests - A function that receives `{ it }` to define individual test cases.
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
 *   when(
 *     "the user clicks increment",
 *     ($) => {
 *       $.perform(async () => {
 *         await userEvent.click($.state.getByRole("button"));
 *       });
 *     },
 *     ({ it }) => {
 *       it("increments the counter", (state) => {
 *         expect(state.value).toEqual(1);
 *       });
 *     }
 *   );
 * }
 * ```
 */
export type WhenFunction<TInputs, TWorldState> = (
  scenario: string,
  modifier: (args: ModifierArgs<TInputs, TWorldState>) => void | Promise<void>,
  tests: (helpers: { it: ItFunction<TWorldState> }) => void,
) => void;

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
 * @typeParam TInputs - The shape of the inputs object (must extend `Record<string, unknown>`).
 * @typeParam TWorldState - The type of the world state returned by the factory function.
 *
 * @param scenario - A description of the initial context (e.g., "a logged-in user").
 * @param inputs - The initial input values used to create world state.
 * @param createWorldState - Factory function that receives inputs and returns the world state.
 * @param tests - Function that receives `{ when, cleanup }` helpers to define scenarios.
 *   - `when`: Define a scenario with input modifications and assertions.
 *   - `cleanup`: Register a cleanup function to run after each test (e.g., unmounting components).
 *
 * @example
 * ```tsx
 * // Testing a simple class
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
 *
 *     when(
 *       "incremented",
 *       ($) => { $.state.inc(); },
 *       ({ it }) => {
 *         it("has value 1", (counter) => {
 *           expect(counter.value).toEqual(1);
 *         });
 *       }
 *     );
 *   }
 * );
 *
 * // Testing a React component
 * given(
 *   "a Button component",
 *   { label: "Click me" },
 *   (inputs) => render(<Button>{inputs.label}</Button>),
 *   ({ when, cleanup }) => {
 *     cleanup(() => testingLibraryCleanup());
 *
 *     when(
 *       "rendered with custom label",
 *       ($) => { $.inputs.label = "Submit"; },
 *       ({ it }) => {
 *         it("displays the label", ({ getByRole }) => {
 *           expect(getByRole("button").innerText).toEqual("Submit");
 *         });
 *       }
 *     );
 *
 *     when(
 *       "clicked",
 *       ($) => {
 *         $.perform(async () => {
 *           await userEvent.click($.state.getByRole("button"));
 *         });
 *       },
 *       ({ it }) => {
 *         it("triggers the click handler", (result) => {
 *           // assertions...
 *         });
 *       }
 *     );
 *   }
 * );
 * ```
 */
export function given<TInputs extends Record<string, unknown>, TWorldState>(
  scenario: string,
  inputs: TInputs,
  createWorldState: (inputs: TInputs) => TWorldState,
  tests: (helpers: {
    when: WhenFunction<TInputs, TWorldState>;
    cleanup: (cleanupFn: () => void | Promise<void>) => void;
  }) => void,
) {
  describe(`given: ${scenario}`, () => {
    let _cleanupFn: (() => void | Promise<void>) | undefined;
    const cleanup = (cleanupFn: () => void | Promise<void>) => {
      _cleanupFn = cleanupFn;
      afterEach(async () => {
        await cleanupFn();
      });
    };

    const when = (
      scenario: string,
      modifier: (args: ModifierArgs<TInputs, TWorldState>) => void | Promise<void>,
      tests: (helpers: { it: ItFunction<TWorldState> }) => void,
    ) => {
      describe(`when: ${scenario}`, () => {
        const it = (
          testScenario: string,
          testFn: (worldState: TWorldState) => void | Promise<void>,
        ) => {
          test(`it: ${testScenario}`, async () => {
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
            await testFn(finalState);
            await _cleanupFn?.();
          });
        };

        tests({ it });
      });
    };

    tests({ when, cleanup });
  });
}
