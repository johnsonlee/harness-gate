package io.johnsonlee.harness.gradle;
import org.gradle.testkit.runner.GradleRunner;
import org.junit.Test;
import org.junit.Assume;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.junit.Assert.*;

/** Real AGP consumer; requires SDK platform 35. CI provides ANDROID_HOME. */
public class AndroidConsumerTest {
    @Test public void assembleRunsCustomLint() throws Exception {
        String home = System.getenv("ANDROID_HOME");
        if (home == null) home = System.getProperty("user.home") + "/Library/Android/sdk";
        Assume.assumeTrue("Android SDK platform 35 required", Files.isDirectory(Path.of(home,"platforms/android-35")));
        Path root = Files.createTempDirectory("harness-android-consumer");
        Files.writeString(root.resolve("settings.gradle"), "pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\nrootProject.name='android-consumer'\n");
        Files.writeString(root.resolve("local.properties"), "sdk.dir=" + home + "\n");
        Files.writeString(root.resolve("build.gradle"), "plugins { id 'com.android.library' version '8.9.1'; id 'io.johnsonlee.harness' }\nrepositories { google(); mavenCentral() }\nandroid { namespace 'dev.test'; compileSdk 35; defaultConfig { minSdk 23 }; lint { disable 'NewApi'; abortOnError true } }\nconfigurations.lintChecks.dependencies.clear()\ndependencies { lintChecks files('" + System.getProperty("harness.lint.jar").replace("\\", "/") + "') }\n");
        Files.createDirectories(root.resolve("src/main/java/dev/test"));
        Files.writeString(root.resolve("src/main/AndroidManifest.xml"), "<manifest />");
        Path source = root.resolve("src/main/java/dev/test/Example.java");
        Files.writeString(source, "package dev.test; public class Example {}\n");
        Files.writeString(root.resolve("lint.xml"), "<lint><issue id=\"HarnessForbiddenImport\"><option name=\"forbiddenPackages\" value=\"java.util\" /></issue></lint>");
        var clean = GradleRunner.create().withProjectDir(root.toFile()).withPluginClasspath(java.util.Arrays.stream(System.getProperty("harness.plugin.classpath").split(java.io.File.pathSeparator)).map(java.io.File::new).toList()).withArguments("assembleDebug", "--stacktrace").build();
        assertTrue(clean.getOutput().contains(":lintDebug"));
        assertTrue(clean.getOutput().contains(":harnessCheck"));
        Files.writeString(source, "package dev.test; import java.util.List; public class Example { List<String> values; }\n");
        var failed = GradleRunner.create().withProjectDir(root.toFile()).withPluginClasspath(java.util.Arrays.stream(System.getProperty("harness.plugin.classpath").split(java.io.File.pathSeparator)).map(java.io.File::new).toList()).withArguments("assembleDebug").buildAndFail();
        assertTrue(failed.getOutput().contains("HarnessForbiddenImport"));
    }
}
