import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Standalone Node scraper/utility scripts — CommonJS by design.
    files: ["scripts/**/*.js", "test-memory-system.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // The queue worker consumes an ungenerated Supabase relationship shape.
    // Keep this exception scoped to the DB row adapters; generated database
    // types can remove it later without weakening the rest of the project.
    files: ["src/lib/tesco-queue-worker.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
