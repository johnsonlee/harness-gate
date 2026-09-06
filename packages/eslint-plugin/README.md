# Harness ESLint rules

Reusable AST-based rules for JavaScript and TypeScript imports. Install this package alongside ESLint 9 or 10. TypeScript syntax requires the target project's TypeScript parser; JSX requires its existing JSX parser options. Keep existing framework and parser configuration.

```js
import harness from 'eslint-plugin-harness-gate';

export default [
  harness.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}'],
    rules: {
      'harness/forbidden-imports': ['error', {
        patterns: ['private-server', 'private-server/**'],
      }],
      'harness/dependency-boundaries': ['error', {
        rootDir: '.',
        modules: [
          { name: 'web', root: 'apps/web' },
          { name: 'server', root: 'apps/server' },
          { name: 'shared', root: 'packages/shared' },
        ],
        allow: { web: ['shared'], server: ['shared'], shared: [] },
        aliases: { '@shared/*': ['packages/shared/src/*'] },
      }],
    },
  },
];
```

Run your existing ESLint command in the native build/check script. Error diagnostics make ESLint fail. Harness CLI is not required.

## Rules

`forbidden-imports` accepts `{ patterns: string[] }`. Patterns match entire module specifiers: `*` matches within one path segment; `**` matches across segments. Use both `pkg` and `pkg/**` to prohibit a package and its subpaths. No default restrictions are enabled.

`dependency-boundaries` accepts `{ rootDir?, modules, allow, aliases? }`:

- `rootDir` defaults to ESLint's working directory; module roots and alias targets resolve against it.
- `modules` contains unique `{ name, root }` entries. The most specific containing root owns a file.
- `allow` maps source module names to permitted destination module names. An empty array prohibits cross-module imports; self imports are always allowed. Omitting a source module leaves it unrestricted. Unknown module names are configuration errors.
- `aliases` maps import specifiers to ordered target arrays using TypeScript paths-style single `*` substitutions. Exact mappings take precedence over wildcard mappings, then more specific wildcard patterns win. Existing files select the first resolving target. Relative imports resolve against the importing file. Common JS/TS extensions, index files, and emitted `.js` to `.ts` source mappings are supported. When no candidate exists, the first declared target is still checked lexically against module roots.

Checks inspect static imports, re-exports, literal `require()`, literal dynamic imports, and TypeScript external import-equals syntax. Constant template literals are supported. Comments, unrelated strings, and computed dynamic expressions are not source dependencies. Bare dependencies without an explicit alias are outside the boundary rule; use `forbidden-imports` for them. This is a static declared boundary check, not complete bundler/package-exports resolution or a runtime call graph. Symlink targets are not canonicalized. The rule does not load tsconfig automatically: pass the project aliases explicitly from your shared config.

`recommended` is a flat config registering the plugin under `harness` with no enabled rules. Architecture policy must be explicit. Named export `rules` also supports programmatic integrations. No autofixes are provided.
