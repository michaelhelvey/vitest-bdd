# vitest-bdd as a plugin

I'd like to explore making this a plugin that does a bit more with the compiler instead of the
current DSL. Basically I think that we can make a more "RSpec"-like syntax through 2 techniques:

1. Inject some globals, such as `$inputs` and `$perform` into the global namespace, that mean
   different things based on where in the given/when/it tree they are.
2. Pre-process the files with a JS compiler such that we can do more "macro-like" things with those
   globals.

## Examples

Here's an example of how I can imagine some of the existing tests looking after doing more
compiler-level transforms:

```typescript
given("a Foo", () => {
  $inputs = { value: 0 };
  $subject = new Foo($inputs.value);

  when("the user sets the value to 1", () => {
    $inputs.value = 5;

    it("has a value of 5", () => {
      expect($subject.value).toEqual(5);
    });
  });
});
```

You can see that `$inputs` and `$subject` are "magic" globals that are injected, and are
conceptually similar to let/subject in RSpec.. Both are lazily evalulated per-it case, but can be
set up in the traditional BDD given/when/it structure.

The open question for me is how we're going to preserve type-safety and auto-complete etc here. The
types of `$inputs` and `$subject` are fairly trivially inferrable, but context-dependent. Meaning
the type of `$input` might be `{ value: string }` within this test case, but might be a completely
different type somewhere else in the file in a different `given` block.

The only way off the top of my head that I can think of how to make this work is to also create an
entrypoint to this library that's a typescript compiler plugin, but I'm open to other options. I've
provided the source for an existing typescript compiler plugin (that does something totally
different) as an example of generally "building typescript compiler plugins" here, locally:
/Users/michaelhelvey/dev/thirdparty/typescript-eslint-language-service

_Note: I am not interested in supporting .each in this version of the API. The user can iterate over
an array of cases, and define an `it` statement within each one, easily enough themselves. That
being said, however, I do want to continue support .only/.skip_

## Development

I think the right way to approach this is to define our plugin within `./src/plugin.ts` and tests
within `./src/plugin.test.ts`. We can then import our plugin directly within `vitest.config.ts` and
use it as a vite plugin, thus enabling us to use the library to test itself. Once it's complete,
we'll replace index/index.test.tsx with our new files.

We'll then need to do something similar for the typescript compiler plugin part, if we choose to
take that direction.

I think we can use the Typescript compiler API directly to create and walk the AST as necessary:
https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API. I've moved `typescript` to the
`dependencies` array in order to support this.

Additionally, here is the documentation for the Vite plugin API:
https://vite.dev/guide/api-plugin.html. I believe that we'll want to inject ourselves into the
`transform` hook for files that match `*.spec.{ts,tsx}`.

## Process

You should follow the following process:

1.  Read the above, and explore the existing project to understand its purpose, and how we plan to
    adapt it. Note that the plan above represents a _total rewrite_ of the project, with no
    backwards compatibility or other concerns. This is effectively a new library.
2.  Architect how you will implement the compiler. Aim for simplicity and maintainability. Review
    your understanding of the problem with me. Iterate with me until I'm happy with your overall
    approach.
3.  Output your full architectural specification to PLUGIN_REWRITE.md. We'll use this file to
    continue to iterate on the plan and eventually implement it.
