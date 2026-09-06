pluginManagement {
    includeBuild("../../integrations/gradle")
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
// Resolve the plugin's Android lint dependency from the same source checkout.
// A plugin-management include alone does not expose ordinary library modules.
includeBuild("../../integrations/gradle") {
    dependencySubstitution {
        substitute(module("io.johnsonlee.harness:android-lint")).using(project(":android-lint"))
    }
}
dependencyResolutionManagement { repositories { google(); mavenCentral() } }
rootProject.name = "harness-android-example"
