# Android example

A minimal installable Android application. The harness Gradle plugin connects
the shared Android Lint library to the ordinary `assembleDebug` build. The
sample policy in `lint.xml` forbids explicit `java.util` imports solely to make
the failure easy to reproduce; configure your real package restrictions there.

Requirements: JDK 17, Android SDK platform 35, and SDK build tools 35.0.0. Set
`ANDROID_HOME` to the SDK path, or create an untracked `local.properties` with
`sdk.dir=/absolute/path/to/sdk`. Initial builds require dependency downloads.

From this directory:

```sh
../../integrations/gradle/gradlew assembleDebug
```

The APK is `build/outputs/apk/debug/harness-android-example-debug.apk`.
Both the plugin and custom lint JAR resolve from the included repository build;
no Maven-local publication or harness CLI is required.

To verify blocking, add `import java.util.List;` below the package declaration
in `MainActivity.java` and repeat the same build. It must fail with
`HarnessForbiddenImport`. Remove the import and rebuild to restore success.
The `example.json` descriptor automates this exact edit for the examples verifier.
Native lint diagnostics are in `build/reports/lint-results-debug.html`.
