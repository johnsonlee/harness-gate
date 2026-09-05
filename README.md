# Harness

Executable engineering constraints for existing Android, iOS, Java/Gradle, Node.js, React, Next.js and Bun projects.

Install a native integration, declare the rules your project actually follows, and keep using its existing build commands. Violations fail those commands. The agent does not need to remember to invoke a separate CLI.

## Integrations

| Project | Integration | Native entry point |
| --- | --- | --- |
| Android | Gradle plugin + shared Android Lint JAR | `./gradlew assembleDebug` / `check` |
| Java / Spring Boot | Gradle plugin + JVM bytecode architecture library | `./gradlew build` / `check` |
| iOS / Swift | SwiftPM and Xcode Build Tool Plugin | `swift build` / Xcode Build |
| Node.js | ESLint rule library + package-script integration | `npm run build` / `check` |
| React | Same integration, preserving Vite or other original build | `npm run build` |
| Next.js | Same integration, preserving `next build` | `npm run build` |
| Bun | Same integration, explicit Bun scripts | `bun run build` / `check` |

Java/Kotlin packages, Maven group and Gradle plugin ID use **`io.johnsonlee.harness`**. npm packages use `@harness-engine`; no public registry release is implied.

Local builds run static constraints. Complete verification runs the project's existing tests plus configured cross-module and OpenAPI checks. Native build systems own task scheduling; harness does not wrap Gradle or Swift in Node.

## Develop and package

```sh
npm ci
npm run build
npm run check
```

Run `npm run check` for core, CLI, ESLint and independent Node/React/Next/Bun consumer tests. The consumer tests install fixed framework versions in a temporary directory and need registry access or a populated cache. Bun 1.3.11 must be on PATH.

```sh
npm run pack:local
integrations/gradle/gradlew -p integrations/gradle build
swift test --package-path integrations/swift
python3 integrations/swift/scripts/integration.py
HARNESS_OASDIFF=/path/to/oasdiff python3 integrations/openapi/test_integration.py
```

`pack:local` writes npm tarballs to `.harness/artifacts`. Install the core, build and ESLint tarballs together in a target project for local development. Gradle supports `publishToMavenLocal` or an included build. Swift uses a pinned checkout of its package subdirectory; a remotely distributed Swift package must publish that directory as its package root. See the ecosystem documentation before distributing artifacts.

## Integrate an existing project

Start with the [runnable example projects](examples/README.md) to inspect a complete target integration. `npm run examples:verify` builds each example, verifies that an injected violation blocks its original build, and confirms recovery after restoring the source.

```sh
node /path/to/harness/packages/cli/dist/index.js init --root /path/to/target
```

This writes `.harness/integration/integration.patch` and instructions inside the target. Review the candidate policy and apply the patch with `git apply`. Install the packages from your registry or local tarballs, update the target's own lockfile, then run its original build command.

For npm/Bun, the patch preserves the previous build command in `package.json#harness.build`, adds explicit script wiring, and imports existing flat ESLint configuration. Generated rules contain empty candidate restrictions: **choose the prohibited imports or module boundaries before treating the integration as your architecture policy**. No business architecture is inferred silently.

For Gradle, Swift and Xcode, initialization emits explicit integration instructions where configuration cannot be safely rewritten. The native plugins do the actual build wiring. `doctor` reports incomplete cross-stack configuration rather than claiming the manual steps are done.

- [Web/Bun and external checks](docs/web.md)
- [Shared ESLint rules](packages/eslint-plugin/README.md)
- [Android and Java/Gradle](integrations/gradle/README.md)
- [SwiftPM and Xcode](integrations/swift/README.md)
- [OpenAPI compatibility](integrations/openapi/README.md)
- [CI and required checks](docs/ci.md)
- [Verification protocol and task context](docs/protocol.md)

## Scope and evidence

Rules are libraries independent of the auxiliary CLI. They enforce explicit dependency policies; they do not understand all business intent. Java checks bytecode package dependencies; Android checks declared dependencies and explicit imports; Swift checks import declarations; JS/TS uses ESLint ASTs and configured module resolution. Each integration documents its limits.

Reports distinguish failed checks, unavailable checks, and successful checks. Native build failures propagate even when static checks passed. Git-tracked inputs are included in evidence hashes, and mutations during verification invalidate the result. Generated artifacts should be ignored in the target repository.

Actual local consumer tests cover clean builds and deliberate violations for every listed stack, including Android AGP and Xcode iOS Simulator. The repository's CI workflow additionally rejects missing or skipped required platform jobs. CI is a merge gate only when the target repository enables the required status check and reviews changes to policy and build configuration.
