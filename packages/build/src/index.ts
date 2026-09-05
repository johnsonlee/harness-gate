#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  findRoot,
  loadConfig,
  verify,
  summarize,
  runCheck,
  digest,
} from "@harness-engine/core";

async function main() {
  const phase = process.argv[2];
  if (phase !== "build" && phase !== "check")
    throw new Error("Usage: harness-build <build|check>");
  const cwd = process.cwd();
  const root = await findRoot(cwd);
  const before = await digest(root);
  const config = await loadConfig(root);
  const relative = path.relative(root, cwd).replaceAll(path.sep, "/") || ".";
  const module = config.modules.find(
    (m) => path.posix.normalize(m.path) === relative,
  );
  if (!module) throw new Error(`No harness module registered at ${relative}`);
  const pkg = JSON.parse(
    await readFile(path.join(cwd, "package.json"), "utf8"),
  );
  const original = pkg.harness?.[phase];
  if (
    original !== undefined &&
    (typeof original !== "string" || !original.trim())
  )
    throw new Error(`package.json harness.${phase} must be a nonempty command`);
  if (typeof pkg.harness?.build !== "string" || !pkg.harness.build.trim())
    throw new Error(
      "package.json harness.build must preserve the original build command",
    );
  const key = `${module.id}:${phase}`;
  const stack: string[] = JSON.parse(
    process.env.HARNESS_INVOCATION_STACK ?? "[]",
  );
  if (!Array.isArray(stack) || stack.some((x) => typeof x !== "string"))
    throw new Error("Invalid harness invocation stack");
  if (stack.includes(key))
    throw new Error(
      `Recursive native task invocation: ${[...stack, key].join(" -> ")}`,
    );
  if (
    phase === "build" &&
    stack.includes(`${module.id}:check`) &&
    process.env.HARNESS_COMPLETED_BUILD_MODULE === module.id &&
    process.env.HARNESS_COMPLETED_BUILD_DIGEST === before
  ) {
    console.log(
      `Harness: ${module.id} build already passed in this enclosing check; inputs unchanged.`,
    );
    return;
  }
  const env = { HARNESS_INVOCATION_STACK: JSON.stringify([...stack, key]) };
  const base = phase === "check" ? process.env.HARNESS_BASE : undefined;
  const report = await verify(root, {
    phase: phase === "build" ? "static" : "verify",
    module: module.id,
    base,
    env,
    contracts: process.env.HARNESS_DELEGATED !== "1",
  });
  const commands =
    phase === "check"
      ? [
          ["build", pkg.harness?.build],
          ["check", original],
        ]
      : [["build", original]];
  for (const [name, script] of commands) {
    if (report.results.some((r) => r.required !== false && r.status !== "pass"))
      break;
    if (!script) continue;
    if (typeof script !== "string")
      throw new Error(`harness.${name} must be a command string`);
    // Explicitly preserve the consumer's existing package-script shell semantics.
    const command =
      process.platform === "win32"
        ? ["cmd.exe", "/d", "/s", "/c", script]
        : ["/bin/sh", "-c", script];
    const result = await runCheck(
      root,
      {
        id: `harness/native-${name}`,
        modules: [module.id],
        phase: "verify",
        command,
        cwd: relative,
      },
      {
        ...env,
        ...(name === "check"
          ? {
              HARNESS_COMPLETED_BUILD_MODULE: module.id,
              HARNESS_COMPLETED_BUILD_DIGEST: before,
            }
          : {}),
      },
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    report.results.push(result);
  }
  if ((await digest(root)) !== before)
    report.results.push({
      version: 1,
      checkId: "harness/native-evidence",
      status: "error",
      required: true,
      findings: [
        {
          ruleId: "harness/changed-during-build",
          severity: "error",
          message:
            "Repository inputs changed during the native build; rerun checks",
        },
      ],
    });
  report.status = report.results.some(
    (r) => r.required !== false && r.status !== "pass",
  )
    ? "fail"
    : "pass";
  await writeFile(
    path.join(
      root,
      ".harness",
      `native-${module.id.replace(/[^a-zA-Z0-9_-]/g, "_")}-${phase}.json`,
    ),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(summarize(report));
  process.exitCode = report.status === "pass" ? 0 : 1;
}
main().catch((error) => {
  console.error(`Harness: ${error.message}`);
  process.exitCode = 1;
});
