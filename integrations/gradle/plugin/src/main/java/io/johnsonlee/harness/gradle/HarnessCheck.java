package io.johnsonlee.harness.gradle;

import org.gradle.api.DefaultTask;
import org.gradle.api.GradleException;
import org.gradle.api.file.RegularFileProperty;
import org.gradle.api.provider.ListProperty;
import org.gradle.api.provider.Property;
import org.gradle.api.tasks.*;
import java.nio.file.Files;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** Checks declared dependencies, including declarations in non-resolvable configurations. */
public abstract class HarnessCheck extends DefaultTask {
    @Input public abstract ListProperty<String> getDependencies();
    @Input public abstract ListProperty<String> getForbiddenDependencies();
    @Input public abstract ListProperty<String> getAllowedProjectDependencies();
    @Input public abstract Property<Boolean> getEnforceProjectBoundaries();
    @OutputFile public abstract RegularFileProperty getReportFile();
    @TaskAction public void check() throws IOException {
        List<String> findings = new ArrayList<>();
        for (String dependency : getDependencies().get()) {
            for (String forbidden : getForbiddenDependencies().get()) {
                if (dependency.equals(forbidden) || (forbidden.endsWith(":*") && dependency.startsWith(forbidden.substring(0, forbidden.length()-1)))) {
                    findings.add(finding("dependencies/forbidden", "Forbidden dependency: " + dependency));
                }
            }
            if (dependency.startsWith("project:") && getEnforceProjectBoundaries().get() && !getAllowedProjectDependencies().get().contains(dependency.substring(8))) {
                findings.add(finding("architecture/module-boundary", "Project dependency is not allowed: " + dependency.substring(8)));
            }
        }
        var report = getReportFile().get().getAsFile().toPath();
        Files.createDirectories(report.getParent());
        Files.writeString(report, "{\"version\":1,\"checkId\":\"gradle-dependencies\",\"status\":\"" + (findings.isEmpty() ? "pass" : "fail") + "\",\"findings\":[" + String.join(",", findings) + "]}\n");
        if (!findings.isEmpty()) throw new GradleException("Harness found " + findings.size() + " dependency violation(s). See " + report);
    }
    private static String finding(String rule, String message) { return "{\"ruleId\":\"" + rule + "\",\"severity\":\"error\",\"message\":\"" + escape(message) + "\"}"; }
    private static String escape(String value) {
        StringBuilder out = new StringBuilder();
        for (char c : value.toCharArray()) {
            if (c == '"' || c == '\\') out.append('\\').append(c);
            else if (c < 32) out.append(String.format("\\u%04x", (int)c));
            else out.append(c);
        }
        return out.toString();
    }
}
