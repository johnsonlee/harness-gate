import { spawn } from "node:child_process";
import path from "node:path";
import { inside, type Check } from "./config.js";

export interface Finding {
  ruleId: string;
  severity: "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
}
export interface CheckResult {
  version: 1;
  checkId: string;
  status: "pass" | "fail" | "skipped" | "error";
  findings: Finding[];
  command?: string[];
  cwd?: string;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  required?: boolean;
}
export function parseReport(text: string, id: string): CheckResult {
  const r = JSON.parse(text);
  if (
    r.version !== 1 ||
    r.checkId !== id ||
    !["pass", "fail", "skipped", "error"].includes(r.status) ||
    !Array.isArray(r.findings)
  )
    throw new Error(`Invalid harness-json-v1 report for ${id}`);
  for (const f of r.findings) {
    if (
      !f ||
      typeof f.ruleId !== "string" ||
      !f.ruleId ||
      !["error", "warning", "info"].includes(f.severity) ||
      typeof f.message !== "string"
    )
      throw new Error(`Invalid finding from ${id}`);
    if (f.file !== undefined) {
      if (typeof f.file !== "string")
        throw new Error("finding.file must be a string");
      inside("/repository", f.file);
    }
    if (f.line !== undefined && (!Number.isInteger(f.line) || f.line <= 0))
      throw new Error("finding.line must be positive");
  }
  return { version: 1, checkId: id, status: r.status, findings: r.findings };
}
export async function runCheck(
  root: string,
  check: Check,
  extraEnv: Record<string, string> = {},
): Promise<CheckResult> {
  const started = Date.now();
  const cwd = inside(root, check.cwd ?? ".");
  const base = {
    version: 1 as const,
    checkId: check.id,
    command: check.command,
    cwd: path.relative(root, cwd) || ".",
    required: check.required !== false,
  };
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timeout = false;
    let overflow = false;
    const child = spawn(check.command[0], check.command.slice(1), {
      cwd,
      env: { ...process.env, ...extraEnv },
      shell: false,
      detached: process.platform !== "win32",
    });
    const terminate = () => {
      try {
        if (child.pid && process.platform !== "win32")
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    };
    const timer = setTimeout(() => {
      timeout = true;
      terminate();
    }, check.timeoutMs ?? 600_000);
    const collect = (chunk: Buffer, stream: "out" | "err") => {
      if (stream === "out") stdout += chunk;
      else stderr += chunk;
      if (stdout.length + stderr.length > 8 * 1024 * 1024) {
        overflow = true;
        terminate();
      }
    };
    child.stdout.on("data", (c: Buffer) => collect(c, "out"));
    child.stderr.on("data", (c: Buffer) => collect(c, "err"));
    let done = false;
    const finish = (result: CheckResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        ...result,
        ...base,
        durationMs: Date.now() - started,
        stdout,
        stderr,
      });
    };
    child.on("error", (error) =>
      finish({
        ...base,
        status: "error",
        findings: [
          {
            ruleId: "harness/execution",
            severity: "error",
            message: error.message,
          },
        ],
      }),
    );
    child.on("close", (code, signal) => {
      if (timeout || overflow || signal) {
        finish({
          ...base,
          status: "error",
          findings: [
            {
              ruleId: "harness/execution",
              severity: "error",
              message: timeout
                ? "Check timed out"
                : overflow
                  ? "Check output exceeded 8 MiB"
                  : `Check terminated by ${signal}`,
            },
          ],
        });
        return;
      }
      try {
        const result: CheckResult =
          check.output === "harness-json-v1"
            ? parseReport(stdout, check.id)
            : {
                ...base,
                status: code === 0 ? "pass" : "fail",
                findings:
                  code === 0
                    ? []
                    : [
                        {
                          ruleId: "harness/exit-code",
                          severity: "error",
                          message: `Check exited with code ${code}`,
                        },
                      ],
              };
        if (code !== 0 && result.status === "pass") result.status = "fail";
        if (
          result.findings.some((f) => f.severity === "error") &&
          result.status === "pass"
        )
          result.status = "fail";
        finish(result);
      } catch (error) {
        finish({
          ...base,
          status: "error",
          findings: [
            {
              ruleId: "harness/report",
              severity: "error",
              message: String(error),
            },
          ],
        });
      }
    });
  });
}
