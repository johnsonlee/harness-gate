package io.johnsonlee.harness.lint;
import com.android.tools.lint.checks.infrastructure.LintDetectorTest;
import com.android.tools.lint.detector.api.Detector;
import com.android.tools.lint.detector.api.Issue;
import java.util.List;
public class ForbiddenImportDetectorTest extends LintDetectorTest {
    @Override protected Detector getDetector() { return new ForbiddenImportDetector(); }
    @Override protected List<Issue> getIssues() { return List.of(ForbiddenImportDetector.ISSUE); }
    public void testViolation() {
        lint().testModes(com.android.tools.lint.checks.infrastructure.TestMode.DEFAULT).allowMissingSdk().files(
            xml("lint.xml", "<lint><issue id=\"HarnessForbiddenImport\"><option name=\"forbiddenPackages\" value=\"java.util\" /></issue></lint>"),
            java("src/test/Example.java", "package test; import java.util.List; public class Example { List<String> values; }")
        ).run().expectErrorCount(1);
    }
    public void testKotlinViolation() {
        lint().testModes(com.android.tools.lint.checks.infrastructure.TestMode.DEFAULT).allowMissingSdk().files(
            xml("lint.xml", "<lint><issue id=\"HarnessForbiddenImport\"><option name=\"forbiddenPackages\" value=\"java.util\" /></issue></lint>"),
            kotlin("src/test/Example.kt", "package test\nimport java.util.ArrayList\nclass Example { val values = ArrayList<String>() }")
        ).run().expectErrorCount(1);
    }
    public void testKotlinAliasViolation() {
        lint().testModes(com.android.tools.lint.checks.infrastructure.TestMode.DEFAULT).allowMissingSdk().files(
            xml("lint.xml", "<lint><issue id=\"HarnessForbiddenImport\"><option name=\"forbiddenPackages\" value=\"java.util\" /></issue></lint>"),
            kotlin("src/test/Example.kt", "package test\nimport java.util.ArrayList as Values\nclass Example { val values = Values<String>() }")
        ).run().expectErrorCount(1);
    }
    public void testAllowedPackage() {
        lint().testModes(com.android.tools.lint.checks.infrastructure.TestMode.DEFAULT).allowMissingSdk().files(
            xml("lint.xml", "<lint><issue id=\"HarnessForbiddenImport\"><option name=\"forbiddenPackages\" value=\"java.utilx\" /></issue></lint>"),
            java("src/test/Example.java", "package test; import java.util.List; public class Example { List<String> values; }")
        ).run().expectClean();
    }
}
