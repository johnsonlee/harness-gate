import harness from 'eslint-plugin-harness-gate';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', '.next/**', '.harness/**', 'next-env.d.ts'] },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { harness },
    // This is an explicit example policy, not an inferred architecture rule.
    rules: { 'harness/forbidden-imports': ['error', { patterns: ['node:fs'] }] },
  },
];
