import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  rm,
  symlink,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { initialize } from "../packages/cli/dist/init.js";

const cli = path.resolve("packages/cli/dist/index.js");
async function temp(t) {
  const root = await mkdtemp(path.join(tmpdir(), "harness-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}
test("init emits an applicable patch, preserves scripts and existing ESLint config, and is idempotent after application", async (t) => {
  const root = await temp(t);
  execFileSync("git", ["init", "-q"], { cwd: root });
  const pkg = {
    name: "consumer",
    version: "1.0.0",
    scripts: { build: "tsc && echo done", check: "node test.mjs" },
    devDependencies: { eslint: "^9.39.0" },
  };
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(pkg, null, 2) + "\n",
  );
  await writeFile(
    path.join(root, "eslint.config.mjs"),
    'export default [{rules:{semi:"error"}}];\n',
  );
  const out = path.join(root, ".harness", "integration");
  const proposal = await initialize(root, out);
  assert.equal(
    JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).scripts
      .build,
    pkg.scripts.build,
  );
  assert.equal(proposal.modules.length, 1);
  execFileSync(
    "git",
    ["apply", "--check", path.join(out, "integration.patch")],
    { cwd: root },
  );
  execFileSync("git", ["apply", path.join(out, "integration.patch")], {
    cwd: root,
  });
  const next = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  assert.deepEqual(next.harness, {
    build: pkg.scripts.build,
    check: pkg.scripts.check,
  });
  assert.equal(next.scripts.build, "harness-gate build");
  assert.match(
    await readFile(path.join(root, "eslint.harness.config.mjs"), "utf8"),
    /import existing from '\.\/eslint.config.mjs'/,
  );
  assert.equal((await initialize(root, out)).patch, "");
  assert.equal(run(root, ["doctor"]).status, 0);
});
test("init identifies Bun explicitly and retains native bun scripts", async (t) => {
  const root = await temp(t);
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "bun-app",
      packageManager: "bun@1.3.11",
      scripts: { build: "bun build index.ts --outdir dist" },
    }),
  );
  const proposal = await initialize(
    root,
    path.join(root, ".harness", "integration"),
  );
  assert.equal(proposal.modules[0].stack, "bun");
  assert.match(proposal.patch, /bun build index.ts/);
  assert.match(proposal.patch, /- bun/);
});
test("init does not overwrite an existing integration and uses requested JVM namespace", async (t) => {
  const root = await temp(t);
  await writeFile(path.join(root, "build.gradle.kts"), "plugins { java }");
  const proposal = await initialize(
    root,
    path.join(root, ".harness", "integration"),
  );
  assert.match(proposal.instructions, /io\.johnsonlee\.harness/);
  assert.equal(
    await readFile(path.join(root, "build.gradle.kts"), "utf8"),
    "plugins { java }",
  );
});
async function taskFixture(t) {
  const root = await temp(t);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "app.js"), "export const x=1;");
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "consumer" }),
  );
  await writeFile(
    path.join(root, "harness.yaml"),
    JSON.stringify({
      version: 1,
      modules: [{ id: "app", path: ".", stack: "node" }],
      checks: [
        {
          id: "lint",
          modules: ["app"],
          phase: "static",
          command: [process.execPath, "-e", "process.exit(0)"],
        },
      ],
    }),
  );
  const task = path.join(root, "task.json");
  await writeFile(
    task,
    JSON.stringify({
      goal: "change app",
      allowedPaths: ["src"],
      acceptance: [{ checkId: "lint" }],
    }),
  );
  assert.equal(run(root, ["start", task]).status, 0);
  return root;
}
test("finish checks actual task scope and required acceptance checks", async (t) => {
  const root = await taskFixture(t);
  await writeFile(path.join(root, "src", "app.js"), "export const x=2;");
  assert.equal(run(root, ["finish"]).status, 0);
  await writeFile(path.join(root, "unrelated.js"), "export const surprise=1;");
  const result = run(root, ["finish"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /harness\/out-of-scope/);
  assert.equal(run(root, ["finish", "--module", "app"]).status, 1);
});
test("manual acceptance cannot be silently certified", async (t) => {
  const root = await taskFixture(t);
  const task = path.join(root, "manual.json");
  await writeFile(
    task,
    JSON.stringify({
      goal: "review",
      allowedPaths: ["."],
      acceptance: ["Human confirms interaction"],
    }),
  );
  assert.equal(run(root, ["start", task]).status, 0);
  const result = run(root, ["finish"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Manual acceptance remains pending/);
});
test("empty, null or unknown acceptance check IDs are rejected", async (t) => {
  const root = await taskFixture(t);
  for (const acceptance of [
    [{ checkId: "" }],
    [{ checkId: null }],
    [{ checkId: "missing" }],
  ]) {
    const file = path.join(root, "bad-task.json");
    await writeFile(
      file,
      JSON.stringify({ goal: "x", allowedPaths: ["."], acceptance }),
    );
    assert.equal(run(root, ["start", file]).status, 1);
  }
});
test("finish delegates to native check and rejects a failing original build; nested build is reused", async (t) => {
  const root = await taskFixture(t);
  await mkdir(path.join(root, "node_modules", ".bin"), { recursive: true });
  const executable = path.resolve("packages/build/dist/index.js");
  await chmod(executable, 0o755);
  await symlink(
    executable,
    path.join(root, "node_modules", ".bin", "harness-gate"),
  );
  const pkg = {
    name: "consumer",
    scripts: { build: "harness-gate build", check: "harness-gate check" },
    harness: { build: 'node -e "process.exit(9)"' },
  };
  await writeFile(path.join(root, "package.json"), JSON.stringify(pkg));
  const taskFile = path.join(root, "native-task.json");
  await writeFile(
    taskFile,
    JSON.stringify({
      goal: "native check",
      allowedPaths: ["."],
      acceptance: [{ checkId: "lint" }],
    }),
  );
  assert.equal(run(root, ["start", taskFile]).status, 0);
  const failed = run(root, ["finish"]);
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /native-build/);
  pkg.harness.build = `node -e "require('fs').appendFileSync('.harness/build-count','1')"`;
  pkg.harness.check = "npm run build";
  await writeFile(path.join(root, "package.json"), JSON.stringify(pkg));
  assert.equal(run(root, ["start", taskFile]).status, 0);
  const passed = run(root, ["finish"]);
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  assert.equal(
    await readFile(path.join(root, ".harness", "build-count"), "utf8"),
    "1",
  );
  assert.equal(
    JSON.parse(
      await readFile(path.join(root, ".harness", "completion.json"), "utf8"),
    ).status,
    "pass",
  );
});
