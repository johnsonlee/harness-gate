#!/usr/bin/env node
import { readFile, writeFile, mkdir, rm, access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  findRoot,
  loadConfig,
  verify,
  summarize,
  digest,
  snapshot,
  inside,
} from "@harness-engine/core";
import { initialize } from "./init.js";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: "string" },
      out: { type: "string" },
      base: { type: "string" },
      module: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  const [command, taskFile] = positionals;
  if (values.help || !command) {
    console.log(
      "harness init [--root path] [--out path]\nharness doctor [--root path]\nharness verify [--base ref | --module id] [--json]\nharness start <task.json>\nharness finish [--base ref] [--json]\nNative builds use their existing Gradle, Swift, npm or Bun entry points.",
    );
    return;
  }
  const start = path.resolve(values.root ?? process.cwd());
  if (command === "init") {
    const out = path.resolve(
      values.out ?? path.join(start, ".harness", "integration"),
    );
    const result = await initialize(start, out);
    console.log(
      `Integration proposal written to ${out}. ${result.modules.length} modules discovered; target files unchanged.`,
    );
    return;
  }
  const root = await findRoot(start);
  if (command === "doctor") {
    const c = await loadConfig(root);
    const issues: string[] = [];
    for (const check of c.checks) {
      const cwd = inside(root, check.cwd ?? ".");
      try {
        if (!(await stat(cwd)).isDirectory()) throw new Error("not a directory");
      } catch {
        issues.push(`${check.id}: working directory is unavailable: ${cwd}`);
      }
      const executable = check.command[0];
      const candidates = executable.includes("/") || executable.includes("\\")
        ? [path.resolve(cwd, executable)]
        : (process.env.PATH ?? "").split(path.delimiter).map(dir => path.join(dir, executable));
      const availability = await Promise.all(candidates.map(async file => {
        try { await access(file, constants.X_OK); return true; } catch { return false; }
      }));
      if (!availability.some(Boolean)) issues.push(`${check.id}: executable not found: ${executable}`);
    }
    for (const m of c.modules) {
      if (
        !c.checks.some(
          (check) =>
            check.required !== false &&
            check.phase === "static" &&
            check.modules.includes(m.id),
        )
      )
        issues.push(`${m.id}: missing required static check`);
      if (["node", "bun", "react", "next", "vue"].includes(m.stack)) {
        const p = JSON.parse(
          await readFile(path.join(root, m.path, "package.json"), "utf8"),
        );
        if (p.scripts?.build !== "harness-build build" || !p.harness?.build)
          issues.push(`${m.id}: native build integration is missing`);
      }
    }
    console.log(
      issues.length
        ? issues.join("\n")
        : `Configuration valid: ${c.modules.length} modules, ${c.checks.length} checks. Run native builds to verify toolchains.`,
    );
    process.exitCode = issues.length ? 1 : 0;
    return;
  }
  if (command === "start") {
    if (!taskFile) throw new Error("start requires a task JSON file");
    const task = JSON.parse(await readFile(path.resolve(taskFile), "utf8"));
    if (
      typeof task.goal !== "string" ||
      !task.goal.trim() ||
      !Array.isArray(task.allowedPaths) ||
      !task.allowedPaths.length ||
      task.allowedPaths.some((p: unknown) => typeof p !== "string" || !p) ||
      !Array.isArray(task.acceptance) ||
      !task.acceptance.length
    )
      throw new Error(
        "Task needs goal, nonempty allowedPaths string array, and nonempty acceptance array",
      );
    for (const p of task.allowedPaths) inside(root, p);
    const config = await loadConfig(root);
    for (const acceptance of task.acceptance) {
      if (typeof acceptance === "string" && acceptance.trim()) continue;
      if (
        !acceptance ||
        typeof acceptance !== "object" ||
        typeof acceptance.checkId !== "string" ||
        !acceptance.checkId.trim() ||
        !config.checks.some((c) => c.id === acceptance.checkId)
      )
        throw new Error(
          "Acceptance must be nonempty manual text or reference a configured checkId",
        );
    }
    await mkdir(path.join(root, ".harness"), { recursive: true });
    await writeFile(
      path.join(root, ".harness", "task.json"),
      JSON.stringify(
        {
          ...task,
          base: values.base,
          initialSnapshot: await snapshot(root),
          initialDigest: await digest(root),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      JSON.stringify(
        { task, modules: config.modules, checks: config.checks },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "verify" || command === "finish") {
    if (command === "finish")
      await rm(path.join(root, ".harness", "completion.json"), { force: true });
    if (command === "finish" && values.module)
      throw new Error(
        "finish requires repository-wide verification; --module is only for verify",
      );
    let task;
    if (command === "finish")
      try {
        task = JSON.parse(
          await readFile(path.join(root, ".harness", "task.json"), "utf8"),
        );
      } catch {
        throw new Error("finish requires a task established with start");
      }
    if (values.base && values.module)
      throw new Error("Choose --base or --module");
    const report = await verify(root, {
      base: values.base ?? task?.base,
      module: values.module,
      native: true,
    });
    if (command === "finish") {
      const current = await snapshot(root);
      for (const file of new Set([
        ...Object.keys(task.initialSnapshot),
        ...Object.keys(current),
      ])) {
        if (task.initialSnapshot[file] === current[file]) continue;
        if (
          !task.allowedPaths.some((p: string) => {
            const rel = path
              .relative(root, inside(root, p))
              .replaceAll(path.sep, "/");
            return rel === "" || file === rel || file.startsWith(rel + "/");
          })
        ) {
          report.status = "fail";
          report.results.push({
            version: 1,
            checkId: "harness/task-scope",
            status: "fail",
            required: true,
            findings: [
              {
                ruleId: "harness/out-of-scope",
                severity: "error",
                message: "Change is outside task.allowedPaths",
                file,
              },
            ],
          });
        }
      }
      if (
        !Array.isArray(task.acceptance) ||
        !task.acceptance.length ||
        task.acceptance.some(
          (a: unknown) =>
            typeof a === "string" ||
            !a ||
            typeof a !== "object" ||
            !("checkId" in a) ||
            typeof a.checkId !== "string" ||
            !a.checkId.trim(),
        )
      ) {
        report.status = "fail";
        report.results.push({
          version: 1,
          checkId: "harness/manual-acceptance",
          status: "skipped",
          required: true,
          findings: [
            {
              ruleId: "harness/manual-acceptance",
              severity: "warning",
              message:
                "Manual acceptance remains pending; CLI cannot certify it",
            },
          ],
        });
      }
      for (const a of task.acceptance)
        if (
          a?.checkId &&
          !report.results.some(
            (r) => r.checkId === a.checkId && r.status === "pass",
          )
        ) {
          report.status = "fail";
          report.results.push({
            version: 1,
            checkId: `harness/acceptance/${a.checkId}`,
            status: "error",
            required: true,
            findings: [
              {
                ruleId: "harness/missing-acceptance",
                severity: "error",
                message: `Acceptance check ${a.checkId} did not pass`,
              },
            ],
          });
        }
      await writeFile(
        path.join(root, ".harness", "completion.json"),
        JSON.stringify(report, null, 2) + "\n",
      );
    }
    console.log(
      values.json ? JSON.stringify(report, null, 2) : summarize(report),
    );
    process.exitCode = report.status === "pass" ? 0 : 1;
    return;
  }
  throw new Error(`Unknown command ${command}`);
}
main().catch((error) => {
  console.error(`Harness: ${error.message}`);
  process.exitCode = 1;
});
