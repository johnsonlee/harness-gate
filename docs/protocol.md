# Configuration and evidence

`packages/core/schema.json` describes `harness.yaml` version 1. Runtime validation additionally checks unique IDs, module references and repository-relative paths. Unknown keys fail validation. Policies are explicit, and a selected module without a required static check cannot pass.

Each check declares an ID, applicable modules, `static` or `verify` phase, argv array, optional cwd, timeout, required flag and output format. `required` defaults to true. Text-mode success means exit code zero; warning policy belongs to the invoked tool.

Structured tools use `output: harness-json-v1` and emit one JSON object to stdout (logs go to stderr):

```json
{
  "version": 1,
  "checkId": "internal-architecture",
  "status": "pass",
  "findings": []
}
```

Statuses are `pass`, `fail`, `skipped`, `error`. A finding contains `ruleId`, `severity` (`error`, `warning`, `info`), `message`, and optional repository-relative `file` and positive `line`. Error findings override a claimed pass, as does a nonzero process exit. Required skipped checks fail the overall gate. A malformed report is an execution error. Native tools can retain their own reports and use text mode; they do not have to implement this JSON format.

Core reports are written to `.harness/report-<module>-<phase>.json`. Web native entry points additionally write `.harness/native-<module>-<build|check>.json`, including the original command's result. A static report alone is not evidence that the original build succeeded. Reports include module coverage, commands, diagnostics and a hash of repository inputs. Tool package versions are bound by the checked-in manifests and lockfiles; the executor also preserves commands and execution duration.

All tracked files contribute to the hash, including tracked files beneath directories named `build` or `dist`. Untracked generated artifacts follow Git ignore rules and standard tool-output exclusions. Keep artifacts out of tracked source. Native Gradle and Swift use their own build inputs and output declarations for invalidation. A pass report is historical evidence, not an authorization token; CI reruns tasks for the candidate revision.

## Optional task context

Native builds do not require a task session. The auxiliary CLI can give agents explicit scope and acceptance context:

```json
{
  "goal": "Update order validation",
  "allowedPaths": ["apps/api/src", "apps/api/test"],
  "acceptance": [{"checkId": "api-tests"}]
}
```

`harness start task.json` records initial inputs. `allowedPaths` are repository-relative files or directory prefixes, not glob expressions. `harness finish` reruns verification, rejects changes outside those paths, and requires each referenced acceptance check to pass. It cannot certify arbitrary prose or human review; those acceptance items remain pending. `finish --module` is rejected because partial verification is not whole-task completion.

Use `--base <commit>` when cross-version contracts are configured. The task snapshot and reports are local context; modifying local files cannot replace required CI enforcement. No command starts or controls an agent session.
