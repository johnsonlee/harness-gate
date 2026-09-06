import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, lstat, readdir, readlink } from "node:fs/promises";
import path from "node:path";
const exec = promisify(execFile);
export async function git(root: string, args: string[]): Promise<string> {
  return (await exec("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024 }))
    .stdout;
}
export async function changedFiles(
  root: string,
  base: string,
): Promise<string[]> {
  await git(root, ["rev-parse", "--verify", `${base}^{commit}`]);
  const [diff, untracked] = await Promise.all([
    git(root, ["diff", "--name-only", "--no-renames", "-z", base, "--"]),
    git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  return [...new Set((diff + untracked).split("\0").filter(Boolean))];
}
const excluded = new Set([
  ".git",
  "node_modules",
  ".harness",
  "dist",
  ".gradle",
  ".build",
  ".next",
  "coverage",
]);
async function walk(root: string, dir = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(path.join(root, dir), {
    withFileTypes: true,
  })) {
    if (excluded.has(entry.name)) continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(root, rel)));
    else result.push(rel);
  }
  return result;
}
export async function snapshot(root: string): Promise<Record<string, string>> {
  let files: string[];
  try {
    const tracked = (await git(root, ["ls-files", "--cached", "-z"]))
      .split("\0")
      .filter(Boolean);
    const other = (
      await git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    )
      .split("\0")
      .filter(Boolean)
      .filter((f) => !f.split("/").some((part) => excluded.has(part)));
    files = [...tracked, ...other];
  } catch {
    files = await walk(root);
  }
  const result: Record<string, string> = {};
  for (const file of [...new Set(files)].sort()) {
    const hash = createHash("sha256");
    try {
      const stat = await lstat(path.join(root, file));
      hash.update(String(stat.mode));
      if (stat.isSymbolicLink())
        hash.update(await readlink(path.join(root, file)));
      else if (stat.isFile())
        hash.update(await readFile(path.join(root, file)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        hash.update("<deleted>");
      else throw e;
    }
    result[file] = hash.digest("hex");
  }
  return result;
}
export async function digest(root: string): Promise<string> {
  return createHash("sha256")
    .update(JSON.stringify(await snapshot(root)))
    .digest("hex");
}
