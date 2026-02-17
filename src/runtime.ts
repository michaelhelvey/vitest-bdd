import { describe, test } from "vitest";

export interface RuntimeContext<TInputs, TSubject> {
  /** Factory that returns a fresh copy of the default inputs */
  inputs: () => TInputs;
  /** Factory that creates a subject from inputs */
  subject: (inputs: TInputs) => TSubject;
  /** Stack of modifier functions to apply to inputs (from nested when blocks) */
  modifiers: ((inputs: TInputs) => void)[];
  /** Stack of perform functions to run after subject creation */
  performs: ((subject: TSubject) => void | Promise<void>)[];
}

export interface GivenConfig<TInputs, TSubject> {
  inputs: () => TInputs;
  subject: (inputs: TInputs) => TSubject;
}

export interface WhenConfig<TInputs, TSubject> {
  modifier?: (inputs: TInputs) => void;
  perform?: (subject: TSubject) => void | Promise<void>;
}

type DescribeFn = (name: string, fn: () => void) => void;
type TestFn = (name: string, fn: () => void | Promise<void>) => void;

export function __given<TInputs extends Record<string, unknown>, TSubject>(
  scenario: string,
  config: GivenConfig<TInputs, TSubject>,
  body: (ctx: RuntimeContext<TInputs, TSubject>) => void,
  describeFn: DescribeFn = describe,
): void {
  describeFn(scenario, () => {
    const ctx: RuntimeContext<TInputs, TSubject> = {
      inputs: config.inputs,
      subject: config.subject,
      modifiers: [],
      performs: [],
    };
    body(ctx);
  });
}

export function __when<TInputs extends Record<string, unknown>, TSubject>(
  scenario: string,
  config: WhenConfig<TInputs, TSubject>,
  body: (ctx: RuntimeContext<TInputs, TSubject>) => void,
  parentCtx: RuntimeContext<TInputs, TSubject>,
  describeFn: DescribeFn = describe,
): void {
  describeFn(scenario, () => {
    const ctx: RuntimeContext<TInputs, TSubject> = {
      inputs: parentCtx.inputs,
      subject: parentCtx.subject,
      modifiers: [...parentCtx.modifiers, ...(config.modifier ? [config.modifier] : [])],
      performs: [...parentCtx.performs, ...(config.perform ? [config.perform] : [])],
    };
    body(ctx);
  });
}

export function __it<TInputs extends Record<string, unknown>, TSubject>(
  scenario: string,
  testFn: (subject: TSubject) => void | Promise<void>,
  ctx: RuntimeContext<TInputs, TSubject>,
  testRunner: TestFn = test,
): void {
  testRunner(scenario, async () => {
    const inputs = ctx.inputs();
    for (const mod of ctx.modifiers) {
      mod(inputs);
    }
    const subject = ctx.subject(inputs);
    for (const perform of ctx.performs) {
      await perform(subject);
    }
    await testFn(subject);
  });
}
