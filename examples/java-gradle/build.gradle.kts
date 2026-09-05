plugins {
    application
    id("io.johnsonlee.harness")
}

repositories { mavenCentral() }
java { toolchain { languageVersion = JavaLanguageVersion.of(17) } }
application { mainClass.set("io.johnsonlee.harness.example.service.Main") }

harness {
    // Services may call domain code; domain code must not call services.
    packageBoundaries.put(
        "io.johnsonlee.harness.example.domain",
        listOf("io.johnsonlee.harness.example.service")
    )
}
