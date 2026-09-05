# OpenAPI compatibility gate

A Python 3.9+ wrapper around the external **oasdiff v1.27.0** CLI. The wrapper delegates semantic compatibility analysis to oasdiff; it does not implement a homegrown schema diff. It runs without Node.js and can be called from a native build verification task or the repository contract gate.

## Install a fixed tool version

Install the [v1.27.0 release](https://github.com/oasdiff/oasdiff/releases/tag/v1.27.0), verifying its release checksum, or build the exact module version:

```sh
GOBIN="$PWD/.tools/bin" go install github.com/oasdiff/oasdiff@v1.27.0
export HARNESS_OASDIFF="$PWD/.tools/bin/oasdiff"
```

This version requires Go 1.26 to build; Go's automatic toolchain selection may download it. Runtime consumers only need the resulting executable, Git, and Python. A source build's `--version` banner can say `main`; `go version -m "$HARNESS_OASDIFF"` records the installed module version. The wrapper never downloads or updates tools. `HARNESS_OASDIFF` selects an executable path, defaulting to `oasdiff` on PATH.

## Native use

Run from anywhere in the target Git working tree:

```sh
HARNESS_BASE=origin/main \
HARNESS_CONTRACT=contracts/api.yaml \
python3 vendor/harness/integrations/openapi/check.py
```

- `HARNESS_BASE` must resolve to an available commit. CI must fetch the comparison base beforehand.
- `HARNESS_CONTRACT` is a repository-root-relative specification file.
- The wrapper resolves the base to a commit ID and extracts a full isolated `git archive`. Local relative `$ref` files are resolved from that baseline tree, never accidentally from the current checkout.
- It runs `oasdiff breaking --fail-on WARN --format json BASE CURRENT`. WARN and ERR compatibility findings fail the command. An explicit empty config prevents implicit `.oasdiff.*` files from weakening the gate.
- Missing tool, missing base/current contract, malformed specs, and unresolved refs fail. New contracts lacking a baseline require an explicit reviewed onboarding change; they are not silently accepted.
- JSON stdout is **oasdiff's native finding array**, not Harness JSON. Register this wrapper in command/exit-code mode. Diagnostics and the resolved base commit go to stderr.

For reproducible results, vendor all referenced specifications into Git. Remote references use oasdiff's standard external-ref resolution and are not pinned by this wrapper. Files outside the checkout, submodule contents, baseline symlinks, and Git `export-ignore` files are not part of the isolated baseline; contracts depending on them must vendor regular tracked files. The script omits baseline symbolic/hard links rather than following them into the host or working tree.

## Harness contract configuration

```yaml
contracts:
  - id: public-api
    file: contracts/api.yaml
    provider: backend
    consumers: [web, android, ios]
    command: [python3, vendor/harness/integrations/openapi/check.py]
```

The repository runner supplies `HARNESS_BASE` and `HARNESS_CONTRACT`. It is responsible for selecting affected consumers and invoking their native compilation/tests; this checker verifies the API contract itself. Register client regeneration and generated-file consistency as explicit required checks, so a compatible API addition can still expose stale generated clients. Relative-reference changes must also select the contract gate; either declare their paths in the runner's supported input configuration or run the contract gate unconditionally during full verification.

## Verified scenarios

```sh
HARNESS_OASDIFF="$PWD/.tools/bin/oasdiff" \
python3 integrations/openapi/test_integration.py
```

The test creates an independent temporary Git repository and uses the real external CLI. It verifies unchanged and documentation-only changes pass; endpoint removal and a response-type change in a relative reference fail; spaces in paths are safe; missing baseline/tool/files and invalid traversal/ref inputs fail.

Primary references: [installation](https://github.com/oasdiff/oasdiff/tree/v1.27.0#installation), [breaking-change exit behavior](https://github.com/oasdiff/oasdiff/blob/v1.27.0/docs/BREAKING-CHANGES.md), [reference-resolution defaults](https://github.com/oasdiff/oasdiff/blob/v1.27.0/docs/DIFF.md).
