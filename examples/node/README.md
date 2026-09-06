# Node example

A standalone consumer of locally packed harness libraries. Its ordinary build runs the shared ESLint rule before the original TypeScript build. `harness.yaml` explicitly selects this module; `eslint.config.mjs` explicitly forbids `node:fs` imports.

From the repository root (Node.js 20.19+):

```sh
npm ci
npm run pack:local
cd examples/node
npm ci --no-audit --no-fund
npm run build
npm run check
```

The build produces `dist/index.js` and `.harness/native-app-build.json`. The saved original command is in `package.json` under `harness.build`; no auxiliary harness CLI step is required.

To demonstrate rejection, append `import "node:fs";` to `src/index.ts` and repeat `npm run build`: it must fail with `harness/forbidden-imports` before the original build. Remove that import to restore success. `npm run lint` also executes the rule independently.

Local tarball dependencies are intentional: run `npm run pack:local` before installing. Published consumers would use pinned registry versions instead.
