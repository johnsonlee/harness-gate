import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { inside, loadConfig, type Config, type Module } from "./config.js";
import { changedFiles, digest } from "./git.js";
import {
  runCheck,
  parseReport,
  type CheckResult,
  type Finding,
} from "./runner.js";

export interface Verification {
  version: 1;
  status: "pass" | "fail";
  phase: "static" | "verify";
  digest: string;
  startedAt: string;
  modules: string[];
  results: CheckResult[];
}
function owns(m: Module, file: string): boolean {
  const dir = path.posix
    .normalize(m.path.replaceAll("\\", "/"))
    .replace(/\/$/, "");
  return dir === "." || file === dir || file.startsWith(dir + "/");
}
export function affectedModules(config: Config, files?: string[]): string[] {
  if (!files) return config.modules.map((m) => m.id);
  const selected = new Set<string>();
  // Relative OpenAPI refs can live outside the provider. Without a complete ref
  // graph, any changed input conservatively selects contract participants.
  if (files.length)
    for (const c of config.contracts ?? []) {
      selected.add(c.provider);
      c.consumers.forEach((id) => selected.add(id));
    }
  for (const file of files) {
    if (
      /(^|\/)(harness\.yaml|package-lock\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock|settings\.gradle(\.kts)?|gradle\.properties|Package\.resolved)$/.test(
        file,
      ) ||
      !file.includes("/")
    )
      return config.modules.map((m) => m.id);
    const matches = config.modules
      .filter((m) => owns(m, file))
      .sort((a, b) => b.path.length - a.path.length);
    if (!matches.length) return config.modules.map((m) => m.id);
    selected.add(matches[0].id);
    for (const c of config.contracts ?? [])
      if (file === c.file) {
        selected.add(c.provider);
        c.consumers.forEach((id) => selected.add(id));
      }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of config.modules)
      if (
        !selected.has(m.id) &&
        (m.dependencies ?? []).some((id) => selected.has(id))
      ) {
        selected.add(m.id);
        changed = true;
      }
    for (const c of config.contracts ?? [])
      if (selected.has(c.provider))
        for (const id of c.consumers)
          if (!selected.has(id)) {
            selected.add(id);
            changed = true;
          }
  }
  return config.modules.filter((m) => selected.has(m.id)).map((m) => m.id);
}
async function actualDependencies(
  root: string,
  config: Config,
): Promise<{ config: Config; findings: Finding[] }> {
  const names = new Map<string, string>();
  const packages = new Map<string, Record<string, unknown>>();
  const findings: Finding[] = [];
  for (const m of config.modules) {
    if (!["node", "react", "next", "bun", "vue"].includes(m.stack)) continue;
    try {
      const p = JSON.parse(
        await readFile(path.join(inside(root, m.path), "package.json"), "utf8"),
      );
      if (typeof p.name === "string") {
        if (names.has(p.name))
          throw new Error(`Duplicate package name ${p.name}`);
        names.set(p.name, m.id);
      }
      packages.set(m.id, p);
    } catch (error) {
      findings.push({
        ruleId: "harness/module-manifest",
        severity: "error",
        message: `${m.id}: ${error}`,
        file: path.posix.join(m.path, "package.json"),
      });
    }
  }
  const modules = config.modules.map((m) => {
    const deps = new Set(m.dependencies ?? []);
    const pkg = packages.get(m.id);
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      const entries = pkg?.[field];
      if (entries && typeof entries === "object")
        for (const name of Object.keys(entries)) {
          const id = names.get(name);
          if (id && id !== m.id) deps.add(id);
        }
    }
    if (m.allowedDependencies)
      for (const dependency of deps)
        if (!m.allowedDependencies.includes(dependency))
          findings.push({
            ruleId: "harness/module-boundary",
            severity: "error",
            message: `${m.id} cannot depend on ${dependency}`,
            file: path.posix.join(m.path, "package.json"),
          });
    return { ...m, dependencies: [...deps] };
  });
  return { config: { ...config, modules }, findings };
}
export async function verify(
  root: string,
  options: {
    phase?: "static" | "verify";
    module?: string;
    base?: string;
    env?: Record<string, string>;
    native?: boolean;
    contracts?: boolean;
  } = {},
): Promise<Verification> {
  const before = await digest(root);
  const startedAt = new Date().toISOString();
  const raw = await loadConfig(root);
  const { config, findings } = await actualDependencies(root, raw);
  const phase = options.phase ?? "verify";
  if (options.module && !config.modules.some((m) => m.id === options.module))
    throw new Error(`Unknown module ${options.module}`);
  const modules = options.module
    ? [options.module]
    : affectedModules(
        config,
        options.base ? await changedFiles(root, options.base) : undefined,
      );
  const results: CheckResult[] = [
    {
      version: 1,
      checkId: "harness/module-graph",
      status: findings.length ? "fail" : "pass",
      findings,
      required: true,
    },
  ];
  const delegated = new Map<string, { manager: string; module: Module }>();
  if (options.native && phase === "verify")
    for (const m of config.modules.filter(
      (m) =>
        modules.includes(m.id) &&
        ["node", "react", "next", "bun", "vue"].includes(m.stack),
    )) {
      const pkg = JSON.parse(
        await readFile(path.join(root, m.path, "package.json"), "utf8"),
      );
      if (pkg.scripts?.check === "harness-build check" && pkg.harness?.build)
        delegated.set(m.id, {
          manager:
            m.stack === "bun" ||
            String(pkg.packageManager ?? "").startsWith("bun@")
              ? "bun"
              : "npm",
          module: m,
        });
      else if (pkg.scripts?.build || pkg.harness)
        results.push({
          version: 1,
          checkId: `harness/native-wiring/${m.id}`,
          status: "error",
          required: true,
          findings: [
            {
              ruleId: "harness/native-wiring",
              severity: "error",
              message: `${m.id}: expected integrated check entry and preserved build command`,
            },
          ],
        });
    }
  for (const module of modules) {
    if (
      !config.checks.some(
        (c) =>
          c.phase === "static" &&
          c.required !== false &&
          c.modules.includes(module),
      )
    )
      results.push({
        version: 1,
        checkId: `harness/coverage/${module}`,
        status: "error",
        required: true,
        findings: [
          {
            ruleId: "harness/missing-check",
            severity: "error",
            message: `${module} has no required static check`,
          },
        ],
      });
  }
  for (const check of config.checks) {
    if (
      !check.modules.some((m) => modules.includes(m)) ||
      (phase === "static" && check.phase !== "static")
    )
      continue;
    if (
      check.modules
        .filter((m) => modules.includes(m))
        .every((m) => delegated.has(m))
    )
      continue;
    results.push(await runCheck(root, check, options.env));
  }
  for (const [id, { manager, module }] of delegated) {
    const reportFile = path.join(
      root,
      ".harness",
      `native-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}-check.json`,
    );
    await rm(reportFile, { force: true });
    const invocation = await runCheck(
      root,
      {
        id: `harness/native-verification/${id}`,
        modules: [id],
        phase: "verify",
        cwd: module.path,
        command: [manager, "run", "check"],
        required: true,
      },
      {
        ...options.env,
        HARNESS_DELEGATED: "1",
        ...(options.base ? { HARNESS_BASE: options.base } : {}),
      },
    );
    results.push(invocation);
    try {
      const native = JSON.parse(await readFile(reportFile, "utf8"));
      if (
        native.version !== 1 ||
        native.digest !== before ||
        !Array.isArray(native.modules) ||
        !native.modules.includes(id) ||
        !Array.isArray(native.results)
      )
        throw new Error(
          "Native report does not match current inputs and module",
        );
      for (const r of native.results) {
        const parsed = parseReport(JSON.stringify(r), r.checkId);
        results.push({
          ...r,
          ...parsed,
          checkId: r.checkId.startsWith("harness/")
            ? `${id}/${r.checkId}`
            : r.checkId,
        });
      }
    } catch (error) {
      results.push({
        version: 1,
        checkId: `harness/native-report/${id}`,
        status: "error",
        required: true,
        findings: [
          {
            ruleId: "harness/native-report",
            severity: "error",
            message: String(error),
          },
        ],
      });
    }
  }
  if (phase === "verify" && options.contracts !== false)
    for (const contract of config.contracts ?? []) {
      if (
        ![contract.provider, ...contract.consumers].some((m) =>
          modules.includes(m),
        )
      )
        continue;
      if (!options.base)
        results.push({
          version: 1,
          checkId: contract.id,
          status: "error",
          required: true,
          findings: [
            {
              ruleId: "harness/contract-base",
              severity: "error",
              message:
                "Contract compatibility requires an explicit base revision",
            },
          ],
        });
      else
        results.push(
          await runCheck(
            root,
            {
              id: contract.id,
              phase: "verify",
              modules: [contract.provider, ...contract.consumers],
              command: contract.command,
              required: true,
            },
            {
              ...options.env,
              HARNESS_BASE: options.base,
              HARNESS_CONTRACT: contract.file,
            },
          ),
        );
    }
  if ((await digest(root)) !== before)
    results.push({
      version: 1,
      checkId: "harness/evidence",
      status: "error",
      required: true,
      findings: [
        {
          ruleId: "harness/changed-during-check",
          severity: "error",
          message:
            "Repository inputs changed during verification; rerun checks",
        },
      ],
    });
  const report: Verification = {
    version: 1,
    status: results.some((r) => r.required !== false && r.status !== "pass")
      ? "fail"
      : "pass",
    phase,
    digest: before,
    startedAt,
    modules,
    results,
  };
  await mkdir(path.join(root, ".harness"), { recursive: true });
  const suffix = options.module
    ? options.module.replace(/[^a-zA-Z0-9_-]/g, "_")
    : "all";
  await writeFile(
    path.join(root, ".harness", `report-${suffix}-${phase}.json`),
    JSON.stringify(report, null, 2) + "\n",
  );
  return report;
}
export function summarize(report: Verification): string {
  return [
    `Harness ${report.status.toUpperCase()} (${report.phase}; modules: ${report.modules.join(", ") || "no changes"})`,
    ...report.results.flatMap((r) => [
      `${r.status.toUpperCase()} ${r.checkId}`,
      ...r.findings.map(
        (f) =>
          `  ${f.file ? `${f.file}${f.line ? ":" + f.line : ""}: ` : ""}${f.ruleId}: ${f.message}`,
      ),
      ...(r.status !== "pass" && r.stdout ? [r.stdout.trim()] : []),
      ...(r.status !== "pass" && r.stderr ? [r.stderr.trim()] : []),
    ]),
  ].join("\n");
}
