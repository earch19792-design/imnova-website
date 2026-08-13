import tsParser from "@typescript-eslint/parser"

export default [
  {
    ignores: ["**/.next/**", "**/node_modules/**", "coverage/**", "public/**", "supabase/**", "tools/fixtures/**", "**/*.tsbuildinfo"],
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    rules: {
      "no-debugger": "error",
      "no-unreachable": "error",
      "no-constant-condition": ["error", { "checkLoops": false }],
    },
  },
]
