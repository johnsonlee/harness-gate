package io.johnsonlee.harness.gradle;

import org.gradle.api.Plugin;
import org.gradle.api.Project;
import org.gradle.api.artifacts.ProjectDependency;
import java.util.TreeSet;

public class HarnessPlugin implements Plugin<Project> {
    @Override public void apply(Project project) {
        var extension = project.getExtensions().create("harness", HarnessExtension.class);
        var check = project.getTasks().register("harnessCheck", HarnessCheck.class, task -> {
            task.setGroup("verification");
            task.setDescription("Checks declared dependencies against shared harness policies.");
            task.getForbiddenDependencies().set(extension.getForbiddenDependencies());
            task.getAllowedProjectDependencies().set(extension.getAllowedProjectDependencies());
            task.getEnforceProjectBoundaries().set(extension.getEnforceProjectBoundaries());
            task.getReportFile().convention(project.getLayout().getBuildDirectory().file("reports/harness/dependencies.json"));
            // Compute after all configurations and dependencies have been declared; no resolution/network needed.
            task.getDependencies().set(project.provider(() -> {
                var result = new TreeSet<String>();
                project.getConfigurations().forEach(configuration -> configuration.getDependencies().forEach(dependency -> {
                    if (dependency instanceof ProjectDependency local) result.add("project:" + local.getDependencyProject().getPath());
                    else if (dependency.getGroup() != null) result.add(dependency.getGroup() + ":" + dependency.getName());
                }));
                return java.util.List.copyOf(result);
            }));
        });
        project.getTasks().configureEach(task -> {
            String name = task.getName();
            if (name.equals("check") || name.equals("build") || name.equals("assemble") || name.equals("preBuild")) task.dependsOn(check);
        });
        project.getPluginManager().withPlugin("java", ignored -> {
            var sourceSets = project.getExtensions().getByType(org.gradle.api.tasks.SourceSetContainer.class);
            var architecture = project.getTasks().register("harnessArchitectureCheck", HarnessArchitectureCheck.class, task -> {
                task.setGroup("verification");
                task.setDescription("Checks compiled main classes for forbidden package dependencies.");
                task.dependsOn(project.getTasks().named("classes"));
                task.getClasses().from(sourceSets.named("main").map(source -> source.getOutput().getClassesDirs()));
                task.getPackageBoundaries().set(extension.getPackageBoundaries());
                task.getReportFile().convention(project.getLayout().getBuildDirectory().file("reports/harness/architecture.json"));
            });
            project.getTasks().matching(task -> java.util.List.of("assemble", "build", "check").contains(task.getName())).configureEach(task -> task.dependsOn(architecture));
        });
        for (String android : java.util.List.of("com.android.application", "com.android.library")) {
            project.getPluginManager().withPlugin(android, ignored -> {
                project.getDependencies().addProvider("lintChecks", extension.getAndroidLintDependency());
                project.getTasks().configureEach(task -> {
                    // assembleDebug / assembleRelease run full corresponding lint; lint does not depend on assemble.
                    String name = task.getName();
                    if (name.startsWith("assemble") && name.length() > 8) {
                        String lintName = "lint" + name.substring(8);
                        task.dependsOn(project.getTasks().matching(candidate -> candidate.getName().equals(lintName)));
                    }
                });
            });
        }
    }
}
