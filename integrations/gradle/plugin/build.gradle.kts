plugins { `java-gradle-plugin`; `maven-publish` }
java { toolchain { languageVersion = JavaLanguageVersion.of(17) } }
gradlePlugin { plugins { create("harness") { id = "io.johnsonlee.harness"; implementationClass = "io.johnsonlee.harness.gradle.HarnessPlugin" } } }
dependencies { implementation(project(":jvm-rules")); testImplementation("junit:junit:4.13.2") }
tasks.test { maxParallelForks = 1 }
tasks.test {
    dependsOn(":android-lint:jar", ":jvm-rules:jar", tasks.jar)
    doFirst { systemProperty("harness.plugin.classpath", (files(tasks.jar.get().archiveFile) + configurations.runtimeClasspath.get()).asPath) }
    systemProperty("harness.lint.jar", project(":android-lint").layout.buildDirectory.file("libs/android-lint-0.1.0.jar").get().asFile.absolutePath)
}
