package io.johnsonlee.harness.lint;
import com.android.tools.lint.detector.api.*;
import org.jetbrains.uast.*;
import com.android.tools.lint.client.api.UElementHandler;
import java.util.List;

/** Configure comma-separated package prefixes with the forbiddenPackages lint.xml option. */
public final class ForbiddenImportDetector extends Detector implements SourceCodeScanner {
    public static final Issue ISSUE = Issue.create("HarnessForbiddenImport", "Forbidden package import",
        "Project source must respect the configured package boundaries.", Category.CORRECTNESS, 8,
        Severity.ERROR, new Implementation(ForbiddenImportDetector.class, Scope.JAVA_FILE_SCOPE));
    @Override public List<Class<? extends UElement>> getApplicableUastTypes() { return List.of(UImportStatement.class); }
    @Override public UElementHandler createUastHandler(JavaContext context) {
        String configured = context.getConfiguration().getOption(ISSUE, "forbiddenPackages", "");
        return new UElementHandler() {
            @Override public void visitImportStatement(UImportStatement node) {
                if (node.getImportReference() == null) return;
                String imported = node.getImportReference().asSourceString();
                for (String item : configured.split(",")) {
                    String prefix = item.trim();
                    if (!prefix.isEmpty() && (imported.equals(prefix) || imported.startsWith(prefix + "."))) {
                        context.report(ISSUE, node, context.getLocation(node), "Import violates package boundary: " + imported);
                        break;
                    }
                }
            }
        };
    }
}
