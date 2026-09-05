plugins {
    id("com.android.application") version "8.9.1"
    id("io.johnsonlee.harness")
}

android {
    namespace = "io.johnsonlee.harness.example.android"
    compileSdk = 35
    defaultConfig {
        applicationId = "io.johnsonlee.harness.example.android"
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }
    lint { abortOnError = true }
}
