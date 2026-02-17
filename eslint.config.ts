import path from "node:path";
import { includeIgnoreFile } from "@eslint/compat";
import type { RuleConfig } from "@eslint/core";
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const typescriptEslintRules = [
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
]
  .map((c) => c.rules)
  .filter(Boolean)
  .map((o) => Object.keys(o!))
  .flat();

export default defineConfig(
  includeIgnoreFile(path.join(import.meta.dirname, ".gitignore"), "exclude files from .gitignore"),
  {
    ignores: ["examples/**"],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "separate-type-imports", prefer: "type-imports" },
      ],
    },
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
  },
  {
    files: ["**/*.test.tsx", "**/*.test.ts", "eslint.config.ts"],
    rules: typescriptEslintRules.reduce<Record<string, RuleConfig>>((acc, curr) => {
      acc[curr] = "off";
      return acc;
    }, {}),
  },
);
