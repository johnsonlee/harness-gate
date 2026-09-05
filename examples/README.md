# Runnable target projects

These are checked-in consumer projects, not source strings created by a unit test. Each uses the existing native build entry point and explicit harness policy. Open the source and configuration to see exactly how to integrate the same mechanism in your own project.

| Example                              | Native command from its directory                 | Rule demonstrated                      |
| ------------------------------------ | ------------------------------------------------- | -------------------------------------- |
| [Node.js](node/README.md)            | `npm run build`                                   | Shared ESLint import restriction       |
| [React](react/README.md)             | `npm run build`                                   | Shared ESLint rule before Vite build   |
| [Next.js](next/README.md)            | `npm run build`                                   | Shared ESLint rule before Next build   |
| [Bun](bun/README.md)                 | `bun run build`                                   | Shared ESLint rule before Bun bundling |
| [Java/Gradle](java-gradle/README.md) | `../../integrations/gradle/gradlew build`         | Bytecode package dependency boundary   |
| [Android](android/README.md)         | `../../integrations/gradle/gradlew assembleDebug` | Shared Android Lint import restriction |
| [iOS](ios/README.md)                 | Xcode Build / `swift build`                       | Shared Swift import restriction        |

See each README for installation, toolchain requirements and the exact commands. Java/Kotlin namespaces use `io.johnsonlee.harness`.

## Verify all examples

From the repository root:

```sh
npm ci
npm run examples:verify
```

This builds and packs the local npm libraries, then copies the checked-in examples and required local integrations into fresh temporary directories. For each example it installs dependencies, executes the original native build, injects a real rule violation into source, requires that build to fail with the expected rule diagnostic, restores the source, and requires a successful build again. Your checked-in example sources are never modified.

The full matrix requires Node.js, Bun, Java 17, Android SDK platform 35, and macOS with Xcode for iOS. The verifier uses `ANDROID_HOME`/`ANDROID_SDK_ROOT`, or the standard SDK directory under your home directory. Missing tools are errors, not successful skips. Run a subset when developing one integration:

```sh
npm run pack:local
node scripts/verify-examples.mjs node react next bun
node scripts/verify-examples.mjs java-gradle android
node scripts/verify-examples.mjs ios
```

Results and command logs are stored in `.harness/example-results/`. Failed workspaces are retained and their paths printed for inspection. CI runs each subset on a suitable platform and requires every platform job to succeed.

The npm examples install locally packed tarballs with fixed package versions; the native examples reference the local Gradle/Swift integration. No registry publication or globally installed harness CLI is required.

When changing the packed harness libraries, refresh the examples' npm/Bun lockfiles alongside the library change: their local tarball integrity hashes deliberately bind the examples to the artifacts being tested.
