import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

export type Stack =
  | "android"
  | "ios"
  | "java"
  | "node"
  | "react"
  | "next"
  | "bun"
  | "vue";
export interface Module {
  id: string;
  path: string;
  stack: Stack;
  dependencies?: string[];
  allowedDependencies?: string[];
}
export interface Check {
  id: string;
  modules: string[];
  phase: "static" | "verify";
  command: string[];
  cwd?: string;
  timeoutMs?: number;
  required?: boolean;
  output?: "text" | "harness-json-v1";
}
export interface Contract {
  id: string;
  file: string;
  provider: string;
  consumers: string[];
  command: string[];
}
export interface Config {
  version: 1;
  modules: Module[];
  checks: Check[];
  contracts?: Contract[];
}
const stacks = new Set([
  "android",
  "ios",
  "java",
  "node",
  "react",
  "next",
  "bun",
  "vue",
]);
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function keys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`${label}: unknown key ${key}`);
}
function string(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${label} must be a nonempty string`);
}
function strings(value: unknown, label: string): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== "string" || !v.trim())
  )
    throw new Error(`${label} must be a string array`);
}
function command(value: unknown, label: string): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    typeof value[0] !== "string" ||
    !value[0].trim() ||
    value.some((v) => typeof v !== "string" || v.includes("\0"))
  )
    throw new Error(
      `${label} must be an argv array with a nonempty executable`,
    );
}
export function inside(root: string, relative: string): string {
  if (path.isAbsolute(relative))
    throw new Error(`Expected repository-relative path: ${relative}`);
  const resolved = path.resolve(root, relative);
  const rel = path.relative(root, resolved);
  if (rel === ".." || rel.startsWith(`..${path.sep}`))
    throw new Error(`Path escapes repository: ${relative}`);
  return resolved;
}
export function validateConfig(input: unknown): Config {
  const value = object(input, "config");
  keys(value, ["version", "modules", "checks", "contracts"], "config");
  if (value.version !== 1) throw new Error("config.version must be 1");
  if (!Array.isArray(value.modules) || !value.modules.length)
    throw new Error("config.modules must not be empty");
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const raw of value.modules) {
    const m = object(raw, "module");
    keys(
      m,
      ["id", "path", "stack", "dependencies", "allowedDependencies"],
      "module",
    );
    string(m.id, "module.id");
    string(m.path, "module.path");
    string(m.stack, "module.stack");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(m.id))
      throw new Error(
        "module.id must use letters, digits, underscores or hyphens",
      );
    if (!stacks.has(m.stack)) throw new Error(`Unsupported stack ${m.stack}`);
    inside("/repository", m.path);
    if (ids.has(m.id)) throw new Error(`Duplicate module ${m.id}`);
    ids.add(m.id);
    const normalized = path.normalize(m.path);
    if (paths.has(normalized))
      throw new Error(`Duplicate module path ${m.path}`);
    paths.add(normalized);
    if (m.dependencies !== undefined)
      strings(m.dependencies, `${m.id}.dependencies`);
    if (m.allowedDependencies !== undefined)
      strings(m.allowedDependencies, `${m.id}.allowedDependencies`);
  }
  const refs = (names: unknown, label: string) => {
    strings(names, label);
    for (const id of names)
      if (!ids.has(id)) throw new Error(`${label}: unknown module ${id}`);
  };
  for (const raw of value.modules) {
    const m = raw as Module;
    refs(m.dependencies ?? [], `${m.id}.dependencies`);
    refs(m.allowedDependencies ?? [], `${m.id}.allowedDependencies`);
  }
  if (!Array.isArray(value.checks))
    throw new Error("config.checks must be an array");
  const checkIds = new Set<string>();
  for (const raw of value.checks) {
    const c = object(raw, "check");
    keys(
      c,
      [
        "id",
        "modules",
        "phase",
        "command",
        "cwd",
        "timeoutMs",
        "required",
        "output",
      ],
      "check",
    );
    string(c.id, "check.id");
    if (checkIds.has(c.id)) throw new Error(`Duplicate check ${c.id}`);
    checkIds.add(c.id);
    refs(c.modules, `${c.id}.modules`);
    if (!(c.modules as string[]).length)
      throw new Error(`${c.id}.modules must not be empty`);
    if (c.phase !== "static" && c.phase !== "verify")
      throw new Error(`${c.id}.phase must be static or verify`);
    command(c.command, `${c.id}.command`);
    if (c.cwd !== undefined) {
      string(c.cwd, `${c.id}.cwd`);
      inside("/repository", c.cwd);
    }
    if (
      c.timeoutMs !== undefined &&
      (!Number.isInteger(c.timeoutMs) || (c.timeoutMs as number) <= 0)
    )
      throw new Error(`${c.id}.timeoutMs must be positive`);
    if (c.required !== undefined && typeof c.required !== "boolean")
      throw new Error(`${c.id}.required must be boolean`);
    if (
      c.output !== undefined &&
      !["text", "harness-json-v1"].includes(c.output as string)
    )
      throw new Error(`${c.id}.output is invalid`);
  }
  if (value.contracts !== undefined) {
    if (!Array.isArray(value.contracts))
      throw new Error("config.contracts must be an array");
    for (const raw of value.contracts) {
      const c = object(raw, "contract");
      keys(c, ["id", "file", "provider", "consumers", "command"], "contract");
      string(c.id, "contract.id");
      if (checkIds.has(c.id))
        throw new Error(`Duplicate check/contract ${c.id}`);
      checkIds.add(c.id);
      string(c.file, "contract.file");
      inside("/repository", c.file);
      string(c.provider, "contract.provider");
      refs([c.provider], "contract.provider");
      refs(c.consumers, "contract.consumers");
      command(c.command, "contract.command");
    }
  }
  return value as unknown as Config;
}
export async function loadConfig(root: string): Promise<Config> {
  return validateConfig(
    parse(await readFile(path.join(root, "harness.yaml"), "utf8")),
  );
}
export async function findRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    try {
      await access(path.join(current, "harness.yaml"));
      return current;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current)
      throw new Error(
        "No harness.yaml found; integrate the project with harness-gate-cli init",
      );
    current = parent;
  }
}
