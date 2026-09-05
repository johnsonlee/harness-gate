# Node.js, React, Next.js and Bun

## Install shared libraries

From a configured package registry, install `@harness-engine/core`, `@harness-engine/build`, and `@harness-engine/eslint-plugin` at a fixed matching version. During development, `npm run pack:local` creates all artifacts; install their tarball paths together so internal dependencies resolve locally. Also install the target's compatible ESLint and TypeScript parser versions. These are development tools, not application runtime dependencies.

Existing project commands are preserved explicitly:

```json
{
  "scripts": {
    "build": "harness-build build",
    "check": "harness-build check",
    "lint:harness": "eslint --config eslint.harness.config.mjs ."
  },
  "harness": {
    "build": "next build",
    "check": "tsc --noEmit && node --test"
  }
}
```

The saved build command can instead be `tsc`, `vite build`, `bun build src/index.ts --outdir dist`, or another existing command. The integration preserves its shell semantics and propagates failure. It does not rely on `prebuild` behavior, so the same scripts work with npm and Bun.

Register the module and static checks in repository-root `harness.yaml`:

```yaml
version: 1
modules:
  - id: web
    path: apps/web
    stack: next
checks:
  - id: web-lint
    modules: [web]
    phase: static
    cwd: apps/web
    command: [npm, run, 'lint:harness']
    required: true
```

Use `[bun, run, 'lint:harness']` for Bun. For a single-package project, set `path: .`. ESLint receives the framework's original parser configuration plus the shared custom rules. Configure Vue SFC parsing through the project's existing Vue parser; the generic generated candidate only handles JS/TS/JSX/TSX.

`npm run build` now runs required static checks before the saved build. `npm run check` runs static and verification checks, the saved build, then the saved check. If the saved check calls `npm run build`, the completed build is reused only within that enclosing check and only while inputs remain unchanged. A configured check must not call the same wrapped task recursively: for example, `web-lint` runs `lint:harness`, not `build`. Recursive task invocation is rejected.

## Monorepos

Each buildable package has its own preserved commands and a module entry. Actual package dependency declarations and explicitly declared `modules[].dependencies` form the impact graph. `allowedDependencies`, when present, constrains local module dependencies. Native Gradle/Swift plugins enforce their own source and build models; cross-stack relationships are explicit.

`harness verify --base <commit>` selects changed modules and consumers transitively, delegates integrated Web/Bun modules to their native check scripts, and aggregates their reports. Root configuration, lockfiles and unknown changed paths select all modules. OpenAPI participants are conservatively selected whenever any inputs change, covering relative references outside the provider without pretending to have a complete reference graph. Set the root package's existing check script to this command for cross-stack verification. Module-local `HARNESS_BASE=<commit> npm run check` provides a baseline for that module's contract checks; it does not replace repository-wide consumer validation. Without a baseline, configured contracts fail as unavailable rather than bypassing compatibility.

## Custom lint

Develop reusable rules in the harness repository, publish versioned native libraries, and enable them in the target's existing tool. The lint engine owns parsing, rule options and native suppression. No additional harness plugin is needed for a command that already exits nonzero on violations.

```yaml
checks:
  - id: internal-architecture
    modules: [web]
    phase: static
    command: [python3, tools/check_architecture.py]
    cwd: .
    timeoutMs: 30000
    required: true
```

Commands are argument arrays executed without an implicit shell. Put complex custom shell logic in a checked-in script. Default timeout is 10 minutes; timeout, launch failure and malformed structured reports fail required verification. Both stdout and stderr are retained, including actionable lint diagnostics.

Core report aggregation does not invent a second suppression system. Use ESLint configuration, Android Lint baselines or your custom tool's explicit policy for approved exceptions; native nonzero exits remain failures.
