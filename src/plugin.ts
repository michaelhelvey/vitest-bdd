import type { Plugin } from "vite";
import { transformBddSyntax } from "./transform.ts";

export function vitestBddPlugin(): Plugin {
  return {
    name: "vitest-bdd",
    enforce: "pre",
    transform(code, id) {
      // Only transform test files
      if (!/\.(spec|test)\.(ts|tsx|js|jsx)$/.test(id)) {
        return null;
      }
      return transformBddSyntax(code, id);
    },
  };
}
