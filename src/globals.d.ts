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

declare function it(name: string, fn: () => void | Promise<void>): void;
declare namespace it {
  function skip(name: string, fn: () => void | Promise<void>): void;
  function only(name: string, fn: () => void | Promise<void>): void;
}

declare var $inputs: any;
declare var $subject: any;
