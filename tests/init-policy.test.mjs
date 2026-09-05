import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ESLint } from "eslint";
import { initialize } from "../packages/cli/dist/init.js";
import { loadConfig } from "../packages/core/dist/index.js";

const exec = promisify(execFile);
const repo = fileURLToPath(new URL("../", import.meta.url));
async function write(root, file, value) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(
    path.join(root, file),
    typeof value === "string" ? value : JSON.stringify(value),
  );
}
async function fixture(
  t,
  pkg = { name: "app", type: "module", scripts: { build: "node build.mjs" } },
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-init-policy-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await write(root, "package.json", pkg);
  return root;
}
async function apply(root) {
  const result = await initialize(root, path.join(root, ".harness/proposal"));
  await exec(
    "git",
    ["apply", path.join(root, ".harness/proposal/integration.patch")],
    { cwd: root },
  );
  return result;
}

test("init detects ancestor flat configs without writing a policy-losing child patch", async (t) => {
  const root = await fixture(t, {
    name: "workspace",
    private: true,
    workspaces: ["apps/*"],
  });
  const policy =
    'export default [{ files: ["apps/web/**/*.js"], rules: { "no-eval": "error" } }];';
  await write(root, "eslint.config.mjs", policy);
  await write(root, "apps/web/package.json", {
    name: "web",
    scripts: { build: "tsc" },
  });
  const out = path.join(root, ".harness/proposal");
  await assert.rejects(
    initialize(root, out),
    (error) =>
      /inherits eslint\.config\.mjs/.test(error.message) &&
      /manually/.test(error.message),
  );
  await assert.rejects(fs.access(out), { code: "ENOENT" });
  assert.equal(
    await fs.readFile(path.join(root, "eslint.config.mjs"), "utf8"),
    policy,
  );
  assert.equal(
    JSON.parse(
      await fs.readFile(path.join(root, "apps/web/package.json"), "utf8"),
    ).scripts.build,
    "tsc",
  );
  // Selecting only the package directory must still notice the real ancestor policy.
  await assert.rejects(
    initialize(path.join(root, "apps/web"), out),
    /inherits .*eslint\.config\.mjs/,
  );
});

test("applied config covers both .mts and .cts syntax and actual forbidden-import diagnostics", async (t) => {
  const root = await fixture(t);
  await apply(root);
  await fs.symlink(
    path.join(repo, "node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  const filename = path.join(root, "eslint.harness.config.mjs");
  await fs.writeFile(
    filename,
    (await fs.readFile(filename, "utf8")).replace(
      "patterns: []",
      "patterns: ['node:fs']",
    ),
  );
  const eslint = new ESLint({ cwd: root, overrideConfigFile: filename });
  for (const extension of ["mts", "cts"]) {
    const filePath = path.join(root, `src/entry.${extension}`);
    const [legal] = await eslint.lintText("export const value: number = 1;", {
      filePath,
    });
    assert.equal(legal.errorCount, 0, JSON.stringify(legal.messages));
    assert.equal(legal.warningCount, 0, JSON.stringify(legal.messages));
    const [illegal] = await eslint.lintText(
      'import "node:fs"; export const value: number = 1;',
      { filePath },
    );
    assert.equal(illegal.errorCount, 1, JSON.stringify(illegal.messages));
    assert.equal(illegal.messages[0].ruleId, "harness/forbidden-imports");
  }
});

test("applied config preserves existing parser, scoped policies and source under build/", async (t) => {
  const root = await fixture(t);
  await write(
    root,
    "eslint.config.mjs",
    `import tseslint from 'typescript-eslint';
import harness from '@harness-engine/eslint-plugin';
const parser = { ...tseslint.parser, meta: { name: 'project-typescript-parser' } };
export default [
  { ignores: ['src/ignored/**'] },
  { files: ['**/*.{ts,mts,cts}'], languageOptions: { parser }, plugins: { harness }, rules: { 'no-eval': 'error', 'harness/forbidden-imports': ['error', { patterns: ['node:fs'] }] } }
];`,
  );
  await apply(root);
  await fs.symlink(
    path.join(repo, "node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: path.join(root, "eslint.harness.config.mjs"),
  });
  const filePath = path.join(root, "build/source.ts");
  const effective = await eslint.calculateConfigForFile(filePath);
  assert.equal(
    effective.languageOptions.parser.meta.name,
    "project-typescript-parser",
  );
  const [result] = await eslint.lintText('import "node:fs"; eval("1");', {
    filePath,
  });
  assert.deepEqual(result.messages.map((message) => message.ruleId).sort(), [
    "harness/forbidden-imports",
    "no-eval",
  ]);
  assert.equal(
    await eslint.isPathIgnored(path.join(root, "src/ignored/file.ts")),
    true,
  );
});

test("init discovers source packages named build while excluding ordinary generated build trees", async (t) => {
  const root = await fixture(t, {
    name: "workspace",
    private: true,
    workspaces: ["packages/*"],
  });
  await write(root, "packages/build/package.json", {
    name: "@workspace/build",
    scripts: { build: "tsc" },
  });
  await write(root, "build/generated-nested/package.json", {
    name: "generated-artifact",
    scripts: { build: "exit 99" },
  });
  const result = await apply(root);
  assert.deepEqual(
    result.modules.map((module) => module.path),
    ["packages/build"],
  );
  const config = await loadConfig(root);
  assert.equal(config.modules[0].id, "packages-build");
  const pkg = JSON.parse(
    await fs.readFile(path.join(root, "packages/build/package.json"), "utf8"),
  );
  assert.equal(pkg.scripts.build, "harness-build build");
  assert.equal(pkg.harness.build, "tsc");
});

test("normalization collisions and unsupported policy loaders fail before writing proposals", async (t) => {
  const root = await fixture(t, { name: "workspace", private: true });
  await write(root, "apps/web/package.json", {
    name: "one",
    scripts: { build: "tsc" },
  });
  await write(root, "apps-web/package.json", {
    name: "two",
    scripts: { build: "tsc" },
  });
  const out = path.join(root, ".harness/proposal");
  await assert.rejects(initialize(root, out), /Module ID collision "apps-web"/);
  await assert.rejects(fs.access(out), { code: "ENOENT" });
  await fs.rm(path.join(root, "apps-web"), { recursive: true });
  await write(root, "apps/web/eslint.config.ts", "export default [];");
  await assert.rejects(
    initialize(root, out),
    /existing TypeScript config loader/,
  );
  await fs.unlink(path.join(root, "apps/web/eslint.config.ts"));
  await write(root, "apps/web/.eslintrc.json", {
    rules: { "no-eval": "error" },
  });
  await assert.rejects(initialize(root, out), /manual flat-config migration/);
  await assert.rejects(fs.access(out), { code: "ENOENT" });
});
