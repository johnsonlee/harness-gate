# Continuous integration

The repository workflow `.github/workflows/ci.yml` validates the distributed rules and native build integrations, with four required platform jobs:

| Job | Actual checks |
| --- | --- |
| Web | `npm ci`, then `npm run check`; core/rule tests and independent Node.js, React, Next.js and Bun consumers |
| Gradle | Java 17 and Android platform 35; `./gradlew build`, including native Java and AGP consumers and Android Lint rules |
| Swift | Swift unit tests and independent native SwiftPM and Xcode iOS Simulator framework builds on macOS |
| OpenAPI | Real oasdiff v1.27.0, including breaking changes and isolated baseline relative-reference resolution |

The final **Harness Gate required checks** job runs even when dependencies fail. It accepts only an exact set of successful jobs; failed, cancelled, skipped or missing dependencies fail the gate. Gradle JUnit reports must contain the Android, JVM and Lint suites with no skipped tests. The Swift job requires the iOS Simulator SDK and explicit SwiftPM/Xcode success evidence. These checks prevent conditional local skips from being accepted in CI.

Make **Harness Gate required checks** a required status check in branch protection or a repository ruleset. Protect changes to `.github/`, rule configuration, lockfiles and check scripts using the repository's review policy. The workflow itself cannot establish server-side branch protection. Jobs use read-only repository permissions and do not publish packages or deploy anything.

The workflow uses pinned action major versions, Bun 1.3.11, the checked-in Gradle wrapper and a fixed oasdiff module version. Hosted macOS images and the Node 22 patch release can change; their actual tool versions appear in run logs. Pin a specific available Xcode installation when your project requires a fixed SDK version. The workflow does not claim a remote CI run succeeded until an actual GitHub run has completed.

## Existing target repositories

CI should run the same native verification entry points developers use. The following is a template; replace directory and scheme names with those of the target project and install its required SDK versions first:

```yaml
jobs:
  web:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run check
        working-directory: apps/web

  backend_android:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - uses: gradle/actions/setup-gradle@v4
      # Install the project's exact Android SDK/platform before this command.
      - run: ./gradlew check
        working-directory: native

  ios:
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v4
      - run: >-
          xcodebuild -project App.xcodeproj -scheme App
          -destination 'generic/platform=iOS Simulator'
          CODE_SIGNING_ALLOWED=NO build
        working-directory: apps/ios
      # Add the project's native test command with an available simulator destination.
```

In these examples the build plugins and lint rules must already be connected in the target project. Add Bun setup and the project's frozen-lockfile install when its entry point is `bun run check`. An unsigned generic Simulator build verifies compilation and attached checks; it does not run application tests. Add the real native test task separately, using a bootable simulator destination where required.

For full cross-module acceptance, run the target project's Harness Gate contract/verification command after fetching the configured Git base. The [OpenAPI integration](../integrations/openapi/README.md) documents `HARNESS_BASE`, `HARNESS_CONTRACT`, tool installation and consumer selection. Generated clients require an explicit regeneration-and-consistency check.

Copy the workflow's `required` aggregation pattern and change both `needs` and the asserted job set to match the target project's actual required jobs. Do not add `continue-on-error` or path-based skips to mandatory platform checks. Local reports do not substitute for these independent CI executions.

Gradle's native XML/HTML, Swift's Harness Gate JSON, oasdiff's own JSON and the CLI's report are distinct formats. Preserve native reports for diagnostics; an exit-code integration does not automatically convert a report into Harness Gate findings. No universal report schema is implied by this template.

References: [Gradle on GitHub Actions](https://docs.gradle.org/current/userguide/github-actions.html), [Bun setup](https://bun.com/guides/runtime/cicd), [hosted runner images](https://github.com/actions/runner-images), [GitHub job dependencies](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds).

## Checked-in examples

The repository workflow also runs `scripts/verify-examples.mjs` against the projects in `examples/`: Web/Bun on Linux, Java/Android on Linux with SDK 35, and iOS on macOS. Each platform requires a clean build, a rule-specific failing build after source mutation, and a successful recovery build. The scripts use isolated copies, and CI uploads `.harness/example-results/` as evidence. The existing required-job aggregator includes these steps through their platform jobs.
