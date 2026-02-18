/* eslint-disable no-var */
declare function given(scenario: string, fn: () => void): void;
declare namespace given {
  function skip(scenario: string, fn: () => void): void;
  function only(scenario: string, fn: () => void): void;
}

declare function when(scenario: string, fn: () => void): void;
declare namespace when {
  function skip(scenario: string, fn: () => void): void;
  function only(scenario: string, fn: () => void): void;
}

/**
 * Re-export vitest's `it` type so that it is available as a global without
 * conflicting with `vitest/globals`.  Using `typeof import('vitest')['it']`
 * keeps the full `TestAPI` shape (including `.each`, `.for`, `.skipIf`, etc.)
 * and avoids the duplicate-identifier error that arose from the previous
 * `declare function` + `declare namespace` pattern.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
declare var it: (typeof import("vitest"))["it"];

declare var $inputs: any;
declare var $subject: any;
