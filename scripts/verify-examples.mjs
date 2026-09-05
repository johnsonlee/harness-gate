#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const available = [
  "node",
  "react",
  "next",
  "bun",
  "java-gradle",
  "android",
  "ios",
];
const selected = process.argv.slice(2);
if (!selected.length) selected.push(...available);
if (
  selected.some((name) => !available.includes(name)) ||
  new Set(selected).size !== selected.length
) {
  throw new Error(`Choose unique example names: ${available.join(", ")}`);
}
const evidenceDirectory = path.join(repository, ".harness", "example-results");
await mkdir(evidenceDirectory, { recursive: true });
const ignored = new Set([
  "node_modules",
  "build",
  "dist",
  ".gradle",
  ".build",
  ".swiftpm",
  ".next",
  ".harness",
  ".DS_Store",
]);

async function copySources(from, to) {
  await cp(from, to, {
    recursive: true,
    filter: (file) => !ignored.has(path.basename(file)),
  });
}

function run(argv, cwd, environment) {
  assert.ok(
    Array.isArray(argv) &&
      argv.length > 0 &&
      argv.every((item) => typeof item === "string"),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: {
        ...process.env,
        ...environment,
        NEXT_TELEMETRY_DISABLED: "1",
        CI: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid && process.platform !== "win32")
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    }, 600_000);
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, output });
    });
  });
}

function localFile(root, relative) {
  assert.equal(typeof relative, "string");
  const resolved = path.resolve(root, relative);
  assert.ok(
    resolved.startsWith(root + path.sep),
    `Expected path inside example: ${relative}`,
  );
  return resolved;
}

for (const name of selected) {
  const scratch = await mkdtemp(
    path.join(tmpdir(), `harness-example-${name}-`),
  );
  const startedAt = new Date().toISOString();
  const result = { example: name, status: "error", startedAt, commands: [] };
  let successful = false;
  try {
    const original = path.join(repository, "examples", name);
    const target = path.join(scratch, "examples", name);
    const description = JSON.parse(
      await readFile(path.join(original, "example.json"), "utf8"),
    );
    const environment = {};
    if (name === "android") {
      const sdk =
        process.env.ANDROID_HOME ||
        process.env.ANDROID_SDK_ROOT ||
        path.join(
          homedir(),
          process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk",
        );
      assert.ok(
        (
          await stat(path.join(sdk, "platforms", "android-35", "android.jar"))
        ).isFile(),
        "Android SDK platform 35 is required; set ANDROID_HOME",
      );
      environment.ANDROID_HOME = sdk;
    }
    await copySources(original, target);
    if (["node", "react", "next", "bun"].includes(name)) {
      await cp(
        path.join(repository, ".harness", "artifacts"),
        path.join(scratch, ".harness", "artifacts"),
        { recursive: true },
      );
    } else {
      const integration = name === "ios" ? "swift" : "gradle";
      await copySources(
        path.join(repository, "integrations", integration),
        path.join(scratch, "integrations", integration),
      );
    }
    const execute = async (argv, label) => {
      const executed = await run(argv, target, environment);
      const log = `${name}-${label}.log`;
      await writeFile(path.join(evidenceDirectory, log), executed.output);
      result.commands.push({
        label,
        argv,
        code: executed.code,
        signal: executed.signal,
        timedOut: executed.timedOut,
        log,
      });
      assert.equal(executed.timedOut, false, `${name} ${label} timed out`);
      assert.equal(executed.signal, null, `${name} ${label} was terminated`);
      return executed;
    };
    if (description.install) {
      const installation = await execute(description.install, "install");
      assert.equal(installation.code, 0, installation.output.slice(-12000));
    }
    const entry = localFile(target, description.entry);
    const source = await readFile(entry, "utf8");
    const builds = [description.build, ...(description.additionalBuilds ?? [])];
    for (let index = 0; index < builds.length; index++) {
      const label = String(index + 1);
      console.log(`Checking ${name}: ${builds[index].join(" ")}`);
      const good = await execute(builds[index], `${label}-clean`);
      assert.equal(good.code, 0, good.output.slice(-12000));
      if (index === 0 && description.artifact) {
        assert.ok(
          await stat(localFile(target, description.artifact)),
          `Missing build artifact ${description.artifact}`,
        );
      }
      let violation;
      if (description.mutation) {
        const { find, replace } = description.mutation;
        assert.equal(typeof find, "string");
        assert.ok(
          find.length > 0 && source.split(find).length === 2,
          "Mutation must match exactly once",
        );
        assert.equal(typeof replace, "string");
        violation = source.replace(find, replace);
      } else {
        assert.equal(typeof description.violation, "string");
        assert.ok(description.violation.length > 0);
        violation = source + description.violation;
      }
      try {
        await writeFile(entry, violation);
        const bad = await execute(builds[index], `${label}-violation`);
        assert.notEqual(
          bad.code,
          0,
          "Violation did not block the native build",
        );
        assert.equal(typeof description.expectedDiagnostic, "string");
        assert.ok(
          description.expectedDiagnostic.length > 0 &&
            bad.output.includes(description.expectedDiagnostic),
          bad.output.slice(-12000),
        );
      } finally {
        await writeFile(entry, source);
      }
      const recovered = await execute(builds[index], `${label}-recovery`);
      assert.equal(recovered.code, 0, recovered.output.slice(-12000));
    }
    result.status = "pass";
    successful = true;
    console.log(
      `PASS ${name}: clean build, lint/architecture violation blocked, restored build`,
    );
  } catch (error) {
    result.error = String(error);
    result.workspace = scratch;
    console.error(`FAIL ${name}: ${error}\nRetained workspace: ${scratch}`);
    process.exitCode = 1;
  } finally {
    result.finishedAt = new Date().toISOString();
    await writeFile(
      path.join(evidenceDirectory, `${name}.json`),
      JSON.stringify(result, null, 2) + "\n",
    );
    if (successful) await rm(scratch, { recursive: true, force: true });
  }
}
