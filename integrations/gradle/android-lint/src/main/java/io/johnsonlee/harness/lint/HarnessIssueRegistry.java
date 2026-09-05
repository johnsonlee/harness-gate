package io.johnsonlee.harness.lint;
import com.android.tools.lint.client.api.IssueRegistry;
import com.android.tools.lint.detector.api.Issue;
import java.util.List;
public final class HarnessIssueRegistry extends IssueRegistry {
    @Override public int getApi() { return com.android.tools.lint.detector.api.ApiKt.CURRENT_API; }
    @Override public int getMinApi() { return 14; }
    @Override public List<Issue> getIssues() { return List.of(ForbiddenImportDetector.ISSUE); }
}
