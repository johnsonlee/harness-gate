# Native Gradle integration

Java 17+, Gradle 8.13 and Android Gradle Plugin 8.9.1 are the tested baseline. The plugin and Android Lint rules execute inside Gradle; Node and the harness CLI are not required.

## Development and publishing

```sh
./gradlew build
./gradlew publishToMavenLocal
```

Published coordinates are `io.johnsonlee.harness:plugin:0.1.0`, plugin marker `io.johnsonlee.harness:io.johnsonlee.harness.gradle.plugin:0.1.0`, and `io.johnsonlee.harness:android-lint:0.1.0`. No public release is implied. Configure an internal Maven publication repository before distributing these artifacts. For local development, add `mavenLocal()` to both plugin and dependency repositories, or use `pluginManagement { includeBuild("/path/to/harness/integrations/gradle") }` and publish only the lint artifact locally.

## Target project

Apply to every Java/Android module whose dependencies should be checked:

```kotlin
plugins {
    java // or existing com.android.application / com.android.library
    id("io.johnsonlee.harness") version "0.1.0"
}
harness {
    forbiddenDependencies.set(listOf("legacy.vendor:client", "unsafe.vendor:*"))
    enforceProjectBoundaries.set(true)
    allowedProjectDependencies.set(listOf(":shared", ":api"))
}
```

The plugin adds `harnessCheck` to `build`, `check`, `assemble` and Android `preBuild`. Android variant assembly also depends on the corresponding existing `lint<Variant>` task. A failed check fails those original commands. No lifecycle task invokes itself. Android integration automatically adds the versioned custom lint JAR to `lintChecks`; `androidLintDependency` can override its coordinate.

Dependencies are checked across all declared configurations without resolving artifacts. External rules match exact `group:name` or `group:*`. Project boundaries match Gradle project paths; an enabled empty allowlist rejects all project dependencies. These checks inspect declarations, not transitive dependencies or source-level fully qualified references. Apply policy to each affected subproject; root policy does not implicitly propagate.

The dependency check emits `build/reports/harness/dependencies.json`, with protocol version, check ID, pass/fail status and findings. Policy and dependency declarations are task inputs; changing them invalidates the output. Gradle's own task implementation fingerprint invalidates changed plugin code. Configuration cache and isolated projects are not currently supported; the dependency snapshot provider reads the current project model. No remote build-cache reuse is enabled for this task.

## Shared custom Android Lint rule

Configure the rule using the target project's existing `lint.xml`:

```xml
<lint>
  <issue id="HarnessForbiddenImport" severity="error">
    <option name="forbiddenPackages" value="com.example.storage,legacy.client" />
  </issue>
</lint>
```

The UAST rule checks Java and Kotlin explicit imports against exact package names and descendant prefixes. An empty option imposes no package restriction. It does not claim to catch fully qualified references without imports. Android Lint owns suppression, baseline, severity and native reports; configure these explicitly and require `abortOnError = true` (the default) for blocking behavior. Use Android Lint's native HTML/XML reports for import diagnostics.

## Additional custom tools

Register your ordinary Gradle task and connect it to the desired lifecycle. For example:

```kotlin
val architectureCheck by tasks.registering(Exec::class) {
    commandLine("python3", rootProject.file("tools/check_architecture.py"))
}
tasks.named("check") { dependsOn(architectureCheck) }
```

A nonzero exit fails Gradle. This supports existing internal checkers without a new harness API. Attach lightweight static checks to `assemble` as well when local builds must block.

## Verification

`./gradlew build` runs detector positive/negative tests and isolated TestKit Java consumers covering ordinary build/assemble, illegal boundaries, forbidden dependencies and policy cache invalidation. A real AGP consumer test runs when Android SDK platform 35 is installed (`ANDROID_HOME`, otherwise macOS's standard SDK path); it builds a clean library, then injects an import violation and requires `assembleDebug` to fail. The test is reported as skipped when that SDK is missing, so JVM-only results are not evidence of Android assembly coverage.

References: [Gradle Java lifecycle](https://docs.gradle.org/current/userguide/java_plugin.html), [official custom Android Lint guide](https://googlesamples.github.io/android-custom-lint-rules/api-guide.html).

## JVM bytecode architecture library

`io.johnsonlee.harness:jvm-rules:0.1.0` is a separate, reusable Java 17 library. The Gradle plugin depends on it; applications can also call `PackageBoundaryRules.check(classDirectories, boundaries)` from their own Java test runner without applying the plugin. The public `Boundary(fromPackage, forbiddenPackage)` record uses dotted package names; both include descendant packages. Wildcards and blank package names are rejected.

```kotlin
harness {
    packageBoundaries.put("com.example.domain", listOf("com.example.storage"))
}
```

When the Java plugin is applied, `harnessArchitectureCheck` consumes compiled **main** classes after `classes`; `assemble`, `build` and `check` depend on this check. It never depends on any of those lifecycle tasks, avoiding a cycle. Android projects continue using Android Lint and do not acquire this Java-only task.

The checker uses [ASM ClassReader](https://asm.ow2.io/javadoc/org/objectweb/asm/ClassReader.html) and [ClassRemapper](https://asm.ow2.io/javadoc/org/objectweb/asm/commons/ClassRemapper.html) to inspect bytecode references, including method/field owners, descriptors, superclasses, interfaces, generic signatures, annotations, class literals and bootstrap handles. Fully qualified references are therefore checked even without an import. Reflection names stored only as strings and dynamically loaded classes cannot be inferred. Test classes are outside the default main-class policy. Bytecode unsupported by the pinned ASM version causes an execution error rather than a pass.

The report is `build/reports/harness/architecture.json` with check ID `gradle-architecture`, source/target class diagnostics and pass/fail/error status. Compiled classes and package rules are task inputs, so source recompilation or policy changes invalidate the result. An empty policy checks no package boundaries; target projects must explicitly declare their architecture.

Packaged consumer tests prove ordinary `assemble` runs the check after compilation, fully qualified method references and generic field types fail build/check, legal classes pass, package matching respects segment boundaries, and invalid configuration fails closed.
