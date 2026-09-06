# Java / Gradle example

A runnable Java 17 application with a domain package and a service package.
The service may depend on the domain; the configured harness rule forbids the
reverse dependency. The native Gradle `build` and `assemble` tasks execute the
bytecode architecture check, including fully qualified references.

From this directory:

```sh
../../integrations/gradle/gradlew build
../../integrations/gradle/gradlew run
```

The included Gradle build loads the repository's actual plugin and rules. No
Node CLI or local Maven publication is needed. Internet access is needed on the
first run for Gradle and dependencies. Use JDK 17 or newer, with a JDK 17 toolchain
installed.

`example.json` describes the build, expected artifact, and a deliberate violation
for the examples verifier. Appending that violation to `Greeting.java` creates
valid Java that illegally calls the service. `build` must then fail with
`package boundary violation`; details appear in
`build/reports/harness/architecture.json`. Remove the appended class to restore
the passing build.
