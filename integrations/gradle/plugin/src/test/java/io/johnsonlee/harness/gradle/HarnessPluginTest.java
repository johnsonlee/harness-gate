package io.johnsonlee.harness.gradle;
import org.gradle.testkit.runner.GradleRunner;
import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.junit.Assert.*;

public class HarnessPluginTest {
    @Rule public TemporaryFolder folder = new TemporaryFolder();
    private Path fixture(String body) throws Exception {
        Path root = folder.newFolder().toPath();
        Files.writeString(root.resolve("settings.gradle"), "rootProject.name='consumer'\ninclude ':shared'\n");
        Files.createDirectories(root.resolve("shared"));
        Files.writeString(root.resolve("shared/build.gradle"), "plugins { id 'java-library' }\n");
        Files.writeString(root.resolve("build.gradle"), "plugins { id 'java'; id 'io.johnsonlee.harness' }\n" + body);
        return root;
    }
    private GradleRunner runner(Path root, String... tasks) { return GradleRunner.create().withProjectDir(root.toFile()).withPluginClasspath(java.util.Arrays.stream(System.getProperty("harness.plugin.classpath").split(java.io.File.pathSeparator)).map(java.io.File::new).toList()).withArguments(tasks); }
    @Test public void normalBuildAndBoundaryFailure() throws Exception {
        var root = fixture("harness { enforceProjectBoundaries.set(true); allowedProjectDependencies.set([':shared']) }\ndependencies { implementation project(':shared') }\n");
        assertTrue(runner(root,"build").build().getOutput().contains(":harnessCheck"));
        assertTrue(Files.readString(root.resolve("build/reports/harness/dependencies.json")).contains("\"status\":\"pass\""));
        Files.writeString(root.resolve("build.gradle"), "plugins { id 'java'; id 'io.johnsonlee.harness' }\nharness { enforceProjectBoundaries.set(true) }\ndependencies { implementation project(':shared') }\n");
        assertTrue(runner(root,"build").buildAndFail().getOutput().contains("dependency violation"));
        assertTrue(Files.readString(root.resolve("build/reports/harness/dependencies.json")).contains("architecture/module-boundary"));
    }
    @Test public void forbiddenDeclarationFailsWithoutResolvingIt() throws Exception {
        var root = fixture("configurations { policyOnly }\ndependencies { policyOnly 'bad.group:client:1.0' }\nharness { forbiddenDependencies.set(['bad.group:*']) }\n");
        runner(root,"assemble").buildAndFail();
        assertTrue(Files.readString(root.resolve("build/reports/harness/dependencies.json")).contains("bad.group:client"));
    }
    @Test public void changedPolicyInvalidatesReport() throws Exception {
        var root = fixture("");
        runner(root,"check").build();
        assertTrue(runner(root,"check").build().getOutput().contains(":harnessCheck UP-TO-DATE"));
        Files.writeString(root.resolve("build.gradle"), "plugins { id 'java'; id 'io.johnsonlee.harness' }\nharness { forbiddenDependencies.set(['bad:*']) }\n");
        assertFalse(runner(root,"check").build().getOutput().contains(":harnessCheck UP-TO-DATE"));
    }

    @Test public void bytecodeBoundariesBlockFullyQualifiedReferences() throws Exception {
        var root = fixture("harness { packageBoundaries.put('example.domain', ['example.storage']) }\n");
        Files.createDirectories(root.resolve("src/main/java/example/domain"));
        Files.createDirectories(root.resolve("src/main/java/example/storage"));
        Files.writeString(root.resolve("src/main/java/example/storage/Store.java"), "package example.storage; public class Store { public static String read() { return \"ok\"; } }");
        var source = root.resolve("src/main/java/example/domain/Order.java");
        Files.writeString(source, "package example.domain; public class Order { public String read() { return \"ok\"; } }");
        var clean = runner(root,"assemble").build();
        assertTrue(clean.getOutput().contains(":harnessArchitectureCheck"));
        assertTrue(clean.getOutput().indexOf(":classes") < clean.getOutput().indexOf(":harnessArchitectureCheck"));
        Files.writeString(source, "package example.domain; public class Order { public String read() { return example.storage.Store.read(); } }");
        runner(root,"build").buildAndFail();
        var report = Files.readString(root.resolve("build/reports/harness/architecture.json"));
        assertTrue(report.contains("example.domain.Order must not depend on example.storage.Store"));
        assertTrue(report.contains("\"status\":\"fail\""));
        runner(root,"assemble").buildAndFail();
        // Erased generic types remain dependency-bearing through the classfile Signature attribute.
        Files.writeString(source, "package example.domain; public class Order { java.util.List<example.storage.Store> values; }");
        runner(root,"check").buildAndFail();
        // Prefixes respect package segment boundaries.
        Files.writeString(root.resolve("build.gradle"), "plugins { id 'java'; id 'io.johnsonlee.harness' }\nharness { packageBoundaries.put('example.domainx', ['example.storage']) }\n");
        runner(root,"build").build();
    }
    @Test public void invalidArchitecturePolicyFailsClosed() throws Exception {
        var root = fixture("harness { packageBoundaries.put('example.*', ['example.storage']) }\n");
        runner(root,"assemble").buildAndFail();
        assertTrue(Files.readString(root.resolve("build/reports/harness/architecture.json")).contains("\"status\":\"error\""));
    }
}
