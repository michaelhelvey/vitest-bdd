import path from "node:path";
import { defineConfig } from "vite-plus";
import vitestBddPlugin from "./src/plugin.ts";

export default defineConfig({
  // Formatter (replaces Prettier)
  fmt: {
    ignorePatterns: ["**/dist/**", "**/node_modules/**", "**/coverage/**"],
    printWidth: 100,
    semi: true,
    singleQuote: false,
    tabWidth: 2,
    trailingComma: "all",
    useTabs: false,
    proseWrap: "always",
    sortImports: {
      customGroups: [
        { groupName: "builtin", selector: "builtin" },
        { groupName: "thirdparty", selector: "external" },
        { groupName: "everything-else", elementNamePattern: ["*"] },
      ],
      newlinesBetween: false,
      sortPackageJson: true,
    },
  },

  // Linter (replaces ESLint + typescript-eslint)
  lint: {
    ignorePatterns: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "examples/**"],
    categories: {
      correctness: "error",
      suspicious: "warn",
      perf: "warn",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "typescript/no-unsafe-type-assertion": "off",
      "eslint/no-await-in-loop": "off",
    },
    overrides: [
      {
        files: ["**/*.test.ts", "**/*.test.tsx"],
        rules: {
          "typescript/unbound-method": "off",
          "eslint/no-shadow": "off",
          "eslint-plugin-unicorn/consistent-function-scoping": "off",
        },
      },
    ],
  },

  // Pre-commit hooks (replaces lefthook / lint-staged)
  staged: {
    "*": "vp check --fix",
  },

  // Pack (replaces tsdown) — library publishing
  pack: [
    {
      entry: ["./src/plugin.ts", "./src/runtime.ts"],
      format: "esm",
      dts: true,
      sourcemap: true,
      unbundle: true,
    },
    {
      entry: ["./src/ts-plugin.ts"],
      format: "cjs",
      failOnWarn: false,
      dts: false,
      sourcemap: true,
      unbundle: true,
    },
  ],

  // Test (replaces vitest.config.ts)
  plugins: [vitestBddPlugin()],
  resolve: {
    alias: {
      "@michaelhelvey/vitest-bdd/runtime": path.resolve(import.meta.dirname, "src/runtime.ts"),
    },
  },
  test: {
    environment: "happy-dom",
    mockReset: true,
    exclude: ["**/examples/**", "**/dist/**", "**/node_modules/**"],
  },
});
