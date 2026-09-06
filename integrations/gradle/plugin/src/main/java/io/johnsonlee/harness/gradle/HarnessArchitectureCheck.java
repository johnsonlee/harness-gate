package io.johnsonlee.harness.gradle;
import io.johnsonlee.harness.jvm.PackageBoundaryRules;
import org.gradle.api.DefaultTask;
import org.gradle.api.GradleException;
import org.gradle.api.file.ConfigurableFileCollection;
import org.gradle.api.file.RegularFileProperty;
import org.gradle.api.provider.MapProperty;
import org.gradle.api.tasks.*;
import java.nio.file.Files;
import java.util.*;

public abstract class HarnessArchitectureCheck extends DefaultTask {
    @Classpath public abstract ConfigurableFileCollection getClasses();
    @Input public abstract MapProperty<String, List<String>> getPackageBoundaries();
    @OutputFile public abstract RegularFileProperty getReportFile();
    @TaskAction public void check() throws Exception {
        var report = getReportFile().get().getAsFile().toPath();
        Files.createDirectories(report.getParent());
        try {
            var rules = new ArrayList<PackageBoundaryRules.Boundary>();
            getPackageBoundaries().get().forEach((from,targets) -> targets.forEach(to -> rules.add(new PackageBoundaryRules.Boundary(from,to))));
            var findings = PackageBoundaryRules.check(getClasses().getFiles().stream().map(java.io.File::toPath).toList(), rules);
            var json = new ArrayList<String>();
            findings.forEach(f -> json.add("{\"ruleId\":\"architecture/package-boundary\",\"severity\":\"error\",\"message\":\"" + escape(f.sourceClass()+" must not depend on "+f.targetClass()) + "\"}"));
            Files.writeString(report, "{\"version\":1,\"checkId\":\"gradle-architecture\",\"status\":\"" + (json.isEmpty()?"pass":"fail") + "\",\"findings\":["+String.join(",",json)+"]}\n");
            if (!findings.isEmpty()) throw new GradleException("Harness found " + findings.size() + " package boundary violation(s). See " + report);
        } catch (GradleException failure) { throw failure; }
        catch (Exception error) {
            Files.writeString(report,"{\"version\":1,\"checkId\":\"gradle-architecture\",\"status\":\"error\",\"findings\":[{\"ruleId\":\"harness/bytecode\",\"severity\":\"error\",\"message\":\""+escape(error.toString())+"\"}]}\n");
            throw error;
        }
    }
    private static String escape(String value) {
        StringBuilder out = new StringBuilder();
        for (char c : value.toCharArray()) { if(c=='"'||c=='\\') out.append('\\').append(c); else if(c<32) out.append(String.format("\\u%04x",(int)c)); else out.append(c); }
        return out.toString();
    }
}
