import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  validateConfig,
  runCheck,
  verify,
  affectedModules,
  digest,
  git,
  summarize,
} from "../packages/core/dist/index.js";

const exec = promisify(execFile);
const buildBin = fileURLToPath(
  new URL("../packages/build/dist/index.js", import.meta.url),
);
const check = (code = "", extra = {}) => ({
  id: "lint",
  modules: ["app"],
  phase: "static",
  command: [process.execPath, "-e", code || "void 0"],
  ...extra,
});
const config = (checks) => ({
  version: 1,
  modules: [{ id: "app", path: ".", stack: "node" }],
  checks,
});
async function write(root, file, data) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(
    path.join(root, file),
    typeof data === "string" ? data : JSON.stringify(data),
  );
}
async function fixture(t, value = config([check()])) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-core-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await write(root, "package.json", {
    name: "fixture",
    private: true,
    type: "module",
  });
  await write(root, "harness.yaml", value);
  return root;
}
async function initGit(root) {
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.name", "Harness Test"]);
  await git(root, ["config", "user.email", "harness@example.invalid"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "fixture baseline"]);
}

test("configuration rejects unknown module references and verify rejects unknown selection", async (t) => {
  assert.throws(
    () => validateConfig(config([check("", { modules: ["missing"] })])),
    /unknown module missing/,
  );
  const root = await fixture(t);
  await assert.rejects(
    verify(root, { module: "missing" }),
    /Unknown module missing/,
  );
});

test("a module without a required static check cannot pass, including optional-only configuration", async (t) => {
  const root = await fixture(t, config([check("", { required: false })]));
  const report = await verify(root, { phase: "static" });
  assert.equal(report.status, "fail");
  assert.ok(
    report.results.some((r) =>
      r.findings.some((f) => f.ruleId === "harness/missing-check"),
    ),
  );
});

test("text checks preserve exact arguments and expose stdout/stderr diagnostics on failure", async (t) => {
  const root = await fixture(t);
  const literal = "argument with spaces; $(do-not-execute)";
  const result = await runCheck(
    root,
    check(
      'console.log(process.argv[1]); console.error("diagnostic stderr"); process.exit(7)',
      {
        command: [
          process.execPath,
          "-e",
          'console.log(process.argv[1]); console.error("diagnostic stderr"); process.exit(7)',
          literal,
        ],
      },
    ),
  );
  assert.equal(result.status, "fail");
  assert.equal(result.stdout.trim(), literal);
  assert.match(result.stderr, /diagnostic stderr/);
  const text = summarize({
    status: "fail",
    phase: "static",
    modules: ["app"],
    results: [result],
  });
  assert.ok(text.includes(literal));
  assert.match(text, /diagnostic stderr/);
});

test("structured reports cannot disguise invalid JSON, error findings or nonzero exits as success", async (t) => {
  const root = await fixture(t);
  const malformed = await runCheck(
    root,
    check('console.log("not-json")', { output: "harness-json-v1" }),
  );
  assert.equal(malformed.status, "error");
  assert.equal(malformed.findings[0].ruleId, "harness/report");
  const report = {
    version: 1,
    checkId: "lint",
    status: "pass",
    findings: [
      {
        ruleId: "custom/error",
        severity: "error",
        message: "violation",
        file: "source.ts",
        line: 4,
      },
    ],
  };
  const errors = await runCheck(
    root,
    check(`console.log(${JSON.stringify(JSON.stringify(report))})`, {
      output: "harness-json-v1",
    }),
  );
  assert.equal(errors.status, "fail");
  assert.equal(errors.findings[0].line, 4);
  const falsePass = await runCheck(
    root,
    check(
      `console.log(${JSON.stringify(JSON.stringify({ ...report, findings: [] }))}); process.exit(2)`,
      { output: "harness-json-v1" },
    ),
  );
  assert.equal(falsePass.status, "fail");
  const unsafe = await runCheck(
    root,
    check(
      `console.log(${JSON.stringify(JSON.stringify({ ...report, findings: [{ ...report.findings[0], file: "../outside.ts" }] }))})`,
      { output: "harness-json-v1" },
    ),
  );
  assert.equal(unsafe.status, "error");
});

test("timed-out checks are errors and their child process is terminated", async (t) => {
  const root = await fixture(t);
  const result = await runCheck(
    root,
    check("console.log(process.pid); setInterval(() => {}, 1000)", {
      timeoutMs: 200,
    }),
  );
  assert.equal(result.status, "error");
  assert.match(result.findings[0].message, /timed out/);
  const pid = Number(result.stdout.trim());
  assert.ok(Number.isInteger(pid) && pid > 0, result.stdout);
  assert.throws(
    () => process.kill(pid, 0),
    (error) => error.code === "ESRCH",
  );
});

test("impact analysis follows reverse dependencies and contract providers transitively", () => {
  const value = {
    version: 1,
    modules: [
      { id: "shared", path: "packages/shared", stack: "node" },
      { id: "api", path: "apps/api", stack: "node", dependencies: ["shared"] },
      { id: "web", path: "apps/web", stack: "react" },
      { id: "shell", path: "apps/shell", stack: "node", dependencies: ["web"] },
      { id: "unrelated", path: "apps/unrelated", stack: "node" },
    ],
    checks: [],
    contracts: [
      {
        id: "api-contract",
        file: "apps/api/openapi.json",
        provider: "api",
        consumers: ["web"],
        command: ["true"],
      },
    ],
  };
  assert.deepEqual(affectedModules(value, ["packages/shared/index.ts"]), [
    "shared",
    "api",
    "web",
    "shell",
  ]);
  assert.deepEqual(affectedModules(value, ["apps/api/handler.ts"]), [
    "api",
    "web",
    "shell",
  ]);
  assert.deepEqual(affectedModules(value, ["apps/api/openapi.json"]), [
    "api",
    "web",
    "shell",
  ]);
  assert.deepEqual(affectedModules(value, []), []);
  assert.deepEqual(
    affectedModules(value, ["unknown/source.ts"]),
    value.modules.map((m) => m.id),
  );
});

test("digest includes tracked build-named source and even tracked normally-excluded directories", async (t) => {
  const root = await fixture(t);
  await write(root, "packages/build/src/index.ts", "export const version = 1;");
  await write(root, "dist/tracked-source.ts", "export const version = 1;");
  await initGit(root);
  const baseline = await digest(root);
  await write(root, "packages/build/src/index.ts", "export const version = 2;");
  const changed = await digest(root);
  assert.notEqual(changed, baseline);
  await write(root, "dist/tracked-source.ts", "export const version = 2;");
  assert.notEqual(await digest(root), changed);
});

test("a passing command that mutates source invalidates the whole verification", async (t) => {
  const root = await fixture(
    t,
    config([check('require("node:fs").writeFileSync("source.ts", "changed")')]),
  );
  await write(root, "source.ts", "original");
  const result = await verify(root, { phase: "static" });
  assert.equal(result.results.find((r) => r.checkId === "lint").status, "pass");
  assert.equal(result.status, "fail");
  assert.ok(
    result.results.some((r) =>
      r.findings.some((f) => f.ruleId === "harness/changed-during-check"),
    ),
  );
});

test("actual workspace package dependencies enforce boundaries and drive reverse impact", async (t) => {
  const value = {
    version: 1,
    modules: [
      { id: "shared", path: "packages/shared", stack: "node" },
      { id: "web", path: "apps/web", stack: "react", allowedDependencies: [] },
    ],
    checks: [check("", { modules: ["shared", "web"] })],
  };
  const root = await fixture(t, value);
  await write(root, "packages/shared/package.json", {
    name: "@fixture/shared",
  });
  await write(root, "packages/shared/index.ts", "export const version = 1;");
  await write(root, "apps/web/package.json", {
    name: "@fixture/web",
    dependencies: { "@fixture/shared": "*" },
  });
  const forbidden = await verify(root, { phase: "static" });
  assert.equal(forbidden.status, "fail");
  assert.ok(
    forbidden.results.some((r) =>
      r.findings.some(
        (f) =>
          f.ruleId === "harness/module-boundary" &&
          f.message.includes("web cannot depend on shared"),
      ),
    ),
  );
  value.modules[1].allowedDependencies = ["shared"];
  await write(root, "harness.yaml", value);
  await write(root, ".gitignore", ".harness/\n");
  await initGit(root);
  await write(root, "packages/shared/index.ts", "export const version = 2;");
  const changed = await verify(root, { phase: "static", base: "HEAD" });
  assert.equal(changed.status, "pass");
  assert.deepEqual(changed.modules, ["shared", "web"]);
});

test("native wrapper persists original build failures and invalidates build-time source mutation", async (t) => {
  const root = await fixture(t);
  await write(root, "package.json", {
    name: "fixture",
    private: true,
    type: "module",
    harness: { build: "node original.mjs" },
  });
  await write(
    root,
    "original.mjs",
    'console.error("compiler failed"); process.exit(9);',
  );
  await assert.rejects(
    exec(process.execPath, [buildBin, "build"], { cwd: root }),
    (error) => {
      assert.match(error.stdout, /Harness FAIL/);
      return error.code === 1;
    },
  );
  let report = JSON.parse(
    await fs.readFile(
      path.join(root, ".harness/native-app-build.json"),
      "utf8",
    ),
  );
  assert.equal(report.status, "fail");
  assert.equal(
    report.results.find((r) => r.checkId === "harness/native-build").status,
    "fail",
  );
  await write(root, "source.ts", "original");
  await write(
    root,
    "original.mjs",
    'import { writeFileSync } from "node:fs"; writeFileSync("source.ts", "changed");',
  );
  await assert.rejects(
    exec(process.execPath, [buildBin, "build"], { cwd: root }),
    (error) => error.code === 1,
  );
  report = JSON.parse(
    await fs.readFile(
      path.join(root, ".harness/native-app-build.json"),
      "utf8",
    ),
  );
  assert.equal(report.status, "fail");
  assert.equal(
    report.results.find((r) => r.checkId === "harness/native-build").status,
    "pass",
  );
  assert.ok(
    report.results.some((r) =>
      r.findings.some((f) => f.ruleId === "harness/changed-during-build"),
    ),
  );
});
