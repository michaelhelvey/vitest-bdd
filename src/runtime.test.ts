import { describe, expect, test } from "vitest";
import { __given, __it, __when } from "./runtime.ts";

class Foo {
  constructor(public value: number) {}
  inc() {
    this.value++;
  }
}

// Test 1: Basic given/it
__given(
  "a Foo",
  {
    inputs: () => ({ value: 0 }),
    subject: (inputs) => new Foo(inputs.value),
  },
  (ctx) => {
    __it(
      "has a value of 0",
      (subject) => {
        expect(subject.value).toEqual(0);
      },
      ctx,
    );
  },
);

// Test 2: Fresh state per it -- each __it gets its own subject
__given(
  "a Foo with fresh state",
  {
    inputs: () => ({ value: 0 }),
    subject: (inputs) => new Foo(inputs.value),
  },
  (ctx) => {
    __it(
      "starts at 0 and mutates to 1",
      (subject) => {
        expect(subject.value).toEqual(0);
        subject.inc();
        expect(subject.value).toEqual(1);
      },
      ctx,
    );

    __it(
      "also starts at 0 (not affected by previous test)",
      (subject) => {
        expect(subject.value).toEqual(0);
      },
      ctx,
    );
  },
);

// Test 3: when modifier -- modifies inputs before subject creation
__given(
  "a Foo with when modifier",
  {
    inputs: () => ({ value: 0 }),
    subject: (inputs) => new Foo(inputs.value),
  },
  (ctx) => {
    __when(
      "value is set to 5",
      {
        modifier: (inputs) => {
          inputs.value = 5;
        },
      },
      (whenCtx) => {
        __it(
          "has a value of 5",
          (subject) => {
            expect(subject.value).toEqual(5);
          },
          whenCtx,
        );
      },
      ctx,
    );
  },
);

// Test 4: when perform -- calls a method on the subject after creation
__given(
  "a Foo with when perform",
  {
    inputs: () => ({ value: 0 }),
    subject: (inputs) => new Foo(inputs.value),
  },
  (ctx) => {
    __when(
      "inc is called",
      {
        perform: (subject) => {
          subject.inc();
        },
      },
      (whenCtx) => {
        __it(
          "has a value of 1",
          (subject) => {
            expect(subject.value).toEqual(1);
          },
          whenCtx,
        );
      },
      ctx,
    );
  },
);

// Test 5: Nested when blocks -- both modifiers applied in order
__given(
  "a Foo with nested when modifiers",
  {
    inputs: () => ({ value: 0 }),
    subject: (inputs) => new Foo(inputs.value),
  },
  (ctx) => {
    __when(
      "value is set to 10",
      {
        modifier: (inputs) => {
          inputs.value = 10;
        },
      },
      (outerCtx) => {
        __it(
          "has a value of 10",
          (subject) => {
            expect(subject.value).toEqual(10);
          },
          outerCtx,
        );

        __when(
          "value is doubled",
          {
            modifier: (inputs) => {
              inputs.value = inputs.value * 2;
            },
          },
          (innerCtx) => {
            __it(
              "has a value of 20 (both modifiers applied in order)",
              (subject) => {
                expect(subject.value).toEqual(20);
              },
              innerCtx,
            );
          },
          outerCtx,
        );
      },
      ctx,
    );
  },
);

// Test 6: Nested when with perform stack -- performs run outer-first, then inner
__given(
  "a Foo with nested performs",
  {
    inputs: () => ({ value: 0 }),
    subject: (inputs) => new Foo(inputs.value),
  },
  (ctx) => {
    __when(
      "inc is called (outer)",
      {
        perform: (subject) => {
          subject.inc(); // 0 -> 1
        },
      },
      (outerCtx) => {
        __it(
          "has a value of 1 after outer perform",
          (subject) => {
            expect(subject.value).toEqual(1);
          },
          outerCtx,
        );

        __when(
          "inc is called again (inner)",
          {
            perform: (subject) => {
              subject.inc(); // 1 -> 2
            },
          },
          (innerCtx) => {
            __it(
              "has a value of 2 (both performs ran in order)",
              (subject) => {
                expect(subject.value).toEqual(2);
              },
              innerCtx,
            );
          },
          outerCtx,
        );
      },
      ctx,
    );
  },
);

// Test 7: Async perform -- async perform completes before test fn runs
__given(
  "a Foo with async perform",
  {
    inputs: () => ({ value: 0 }),
    subject: (inputs) => new Foo(inputs.value),
  },
  (ctx) => {
    __when(
      "an async operation increments value",
      {
        perform: async (subject) => {
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
          subject.inc();
        },
      },
      (whenCtx) => {
        __it(
          "has a value of 1 after async perform completes",
          (subject) => {
            expect(subject.value).toEqual(1);
          },
          whenCtx,
        );
      },
      ctx,
    );
  },
);

// Test 8: skip/only support -- pass custom describeFn/testRunner
__given(
  "a Foo with skip support",
  {
    inputs: () => ({ value: 0 }),
    subject: (inputs) => new Foo(inputs.value),
  },
  (ctx) => {
    __it(
      "this test is skipped via test.skip",
      () => {
        throw new Error("should not run");
      },
      ctx,
      test.skip,
    );
  },
);

__given(
  "a Foo that is entirely skipped",
  {
    inputs: () => ({ value: 0 }),
    subject: (inputs) => new Foo(inputs.value),
  },
  (ctx) => {
    __it(
      "should not run because describe.skip was used",
      () => {
        throw new Error("should not run");
      },
      ctx,
    );
  },
  describe.skip,
);
