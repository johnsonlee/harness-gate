import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { stringify } from "yaml";
import { type Config, type Module } from "@harness-engine/core";

const ignore = new Set([
  "node_modules",
  ".git",
  ".harness",
  "dist",
  ".build",
  ".gradle",
  ".next",
]);
const manifests = [
  "package.json",
  "build.gradle",
  "build.gradle.kts",
  "Package.swift",
];
const flatConfigNames = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
];
const legacyConfigNames = [
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yaml",
  ".eslintrc.yml",
];
async function files(root: string, relative = ""): Promise<string[]> {
  const result: string[] = [];
  for (const e of await readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    if (ignore.has(e.name)) continue;
    const file = path.posix.join(relative, e.name);
    if (e.isDirectory()) {
      // A build directory containing a project manifest is source, e.g. packages/build.
      if (
        e.name === "build" &&
        !(await readdir(path.join(root, file))).some((name) =>
          manifests.includes(name),
        )
      )
        continue;
      result.push(...(await files(root, file)));
    } else result.push(file);
  }
  return result;
}
async function read(root: string, file: string) {
  try {
    return await readFile(path.join(root, file), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
}
export async function initialize(
  root: string,
  out: string,
): Promise<{ patch: string; instructions: string; modules: Module[] }> {
  const inventory = await files(root);
  const modules: Module[] = [];
  const replacements = new Map<string, string>();
  const instructions: string[] = [];
  const existing = await read(root, "harness.yaml");
  if (existing) {
    const instructions =
      "harness.yaml already exists. Initialization does not rewrite an established policy. Update native integration and policy explicitly; run harness doctor to inspect it.\n";
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, "integration.patch"), "");
    await writeFile(path.join(out, "README.md"), instructions);
    return { patch: "", instructions, modules: [] };
  }
  const config: Config = { version: 1, modules, checks: [] };
  const register = (dir: string, stack: Module["stack"]) => {
    const id = dir === "." ? "root" : dir.replace(/[^a-zA-Z0-9_-]/g, "-");
    const duplicate = modules.find((module) => module.id === id);
    if (duplicate)
      throw new Error(
        `Module ID collision "${id}" between "${duplicate.path}" and "${dir}". Register explicit unique IDs in a manual harness.yaml before integrating; no proposal was written.`,
      );
    modules.push({ id, path: dir, stack });
    return id;
  };
  for (const file of inventory.filter(
    (f) => path.basename(f) === "package.json",
  )) {
    const dir = path.posix.dirname(file);
    const pkg = JSON.parse(await read(root, file));
    // A workspace container without a build script is orchestration, not a runnable application.
    if (!pkg.scripts?.build) {
      instructions.push(
        `${file}: no build script; no runnable module generated. Add a native build/check entry before integration.`,
      );
      continue;
    }
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    const bun =
      inventory.includes(path.posix.join(dir, "bun.lock")) ||
      inventory.includes(path.posix.join(dir, "bun.lockb")) ||
      String(pkg.packageManager ?? "").startsWith("bun@") ||
      inventory.includes("bun.lock");
    const stack: Module["stack"] = dependencies.next
      ? "next"
      : dependencies.react
        ? "react"
        : dependencies.vue
          ? "vue"
          : bun
            ? "bun"
            : "node";
    const id = register(dir, stack);
    const existingLint = flatConfigNames.find((name) =>
      inventory.includes(path.posix.join(dir, name)),
    );
    if (existingLint && /\.(ts|mts|cts)$/.test(existingLint))
      throw new Error(
        `${file}: ${path.posix.join(dir, existingLint)} needs its existing TypeScript config loader. Add Harness rules to that configuration manually and retain the existing lint invocation; no proposal was written.`,
      );
    if (!existingLint) {
      const legacy = legacyConfigNames.find((name) =>
        inventory.includes(path.posix.join(dir, name)),
      );
      if (legacy || pkg.eslintConfig)
        throw new Error(
          `${file}: existing legacy ESLint policy ${legacy ?? "package.json#eslintConfig"} requires a manual flat-config migration; no proposal was written.`,
        );
      let parent = path.dirname(path.resolve(root, dir));
      while (true) {
        const entries = await readdir(parent);
        const ancestor = [...flatConfigNames, ...legacyConfigNames].find(
          (name) => entries.includes(name),
        );
        if (ancestor)
          throw new Error(
            `${file}: inherits ${path.relative(root, path.join(parent, ancestor))}. A child --config wrapper would change the base of its file globs and ignores. Add Harness rules to that ancestor configuration manually and retain its existing lint invocation; no proposal was written.`,
          );
        const next = path.dirname(parent);
        if (next === parent) break;
        parent = next;
      }
    }
    if (pkg.harness)
      throw new Error(
        `${file}: harness field already exists; integrate manually to avoid replacing commands`,
      );
    pkg.harness = {
      build: pkg.scripts.build,
      ...(pkg.scripts.check ? { check: pkg.scripts.check } : {}),
    };
    if (pkg.scripts["lint:harness"])
      throw new Error(
        `${file}: lint:harness already exists; integrate manually`,
      );
    pkg.scripts = {
      ...pkg.scripts,
      build: "harness-build build",
      check: "harness-build check",
      "lint:harness": "eslint --config eslint.harness.config.mjs .",
    };
    pkg.devDependencies = {
      ...pkg.devDependencies,
      "@harness-engine/build": "0.1.0",
      "@harness-engine/eslint-plugin": "0.1.0",
    };
    if (!dependencies.eslint) pkg.devDependencies.eslint = "^9.39.0";
    if (!dependencies["typescript-eslint"])
      pkg.devDependencies["typescript-eslint"] = "^8.69.0";
    replacements.set(file, JSON.stringify(pkg, null, 2) + "\n");
    const lintFile = path.posix.join(dir, "eslint.harness.config.mjs");
    if (inventory.includes(lintFile))
      throw new Error(`${lintFile} already exists; integrate manually`);
    const candidate = existingLint
      ? `  // Add explicit Harness rule parameters here; existing rules and parsers remain authoritative.\n`
      : `  { ignores: ['dist/**', 'build/**', '.next/**', 'node_modules/**', '.harness/**'] },\n  { files: ['**/*.{ts,tsx,mts,cts}'], languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } } },\n`;
    replacements.set(
      lintFile,
      `import harness from '@harness-engine/eslint-plugin';\n${existingLint ? `import existing from './${existingLint}';\n` : `import tseslint from 'typescript-eslint';\n`}\nexport default [\n${existingLint ? "  ...(Array.isArray(existing) ? existing : [existing]),\n" : ""}${candidate}  {\n    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}'],\n${existingLint ? "" : `    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },\n`}    plugins: { harness },\n    rules: {\n      // Candidate policy: replace patterns with your explicit prohibited imports.\n${existingLint ? `      // 'harness/forbidden-imports': ['error', { patterns: [] }]\n` : `      'harness/forbidden-imports': ['error', { patterns: [] }]\n`}    }\n  }\n];\n`,
    );
    config.checks.push({
      id: `${id}-lint`,
      modules: [id],
      phase: "static",
      cwd: dir,
      command: [bun ? "bun" : "npm", "run", "lint:harness"],
      required: true,
    });
    instructions.push(
      `${file}: review candidate lint policy before applying. Existing build/check commands are preserved in package.json#harness. Add required tests/typechecks to the original check command or harness.yaml. If an existing check calls build, both remain explicit native tasks. ${existingLint ? "Existing flat config, parsers, ignores and rules are preserved. Configure TypeScript/JSX parsing there if needed." : "Legacy .eslintrc requires manual flat-config migration if present."}`,
    );
  }
  for (const file of inventory.filter((f) =>
    /^build\.gradle(\.kts)?$/.test(path.basename(f)),
  )) {
    const dir = path.posix.dirname(file);
    if (modules.some((m) => m.path === dir)) continue;
    const source = await read(root, file);
    const android = /com\.android\.|android\s*\{/.test(source);
    const id = register(dir, android ? "android" : "java");
    instructions.push(
      `${file}: apply Gradle plugin id("io.johnsonlee.harness") version "0.1.0" from your configured Maven repository or includeBuild. Configure harness.forbiddenDependencies and allowedProjectDependencies explicitly. See integrations/gradle/README.md. Dynamic Gradle files are not rewritten. Native assemble/build/check tasks are connected by the plugin.`,
    );
    // Actual task paths and wrapper roots can differ; never invent a runnable verification command.
    instructions.push(
      `${id}: register the actual Gradle wrapper/task in harness.yaml if using cross-stack CLI verification. doctor will flag missing required checks until configured.`,
    );
  }
  for (const file of inventory.filter(
    (f) => path.basename(f) === "Package.swift",
  )) {
    const dir = path.posix.dirname(file);
    if (modules.some((m) => m.path === dir)) continue;
    const id = register(dir, "ios");
    instructions.push(
      `${file}: add the pinned HarnessSwift package dependency and HarnessBuildPlugin to each checked target. Create harness-swift.json with an explicit targets map and forbiddenImports. See integrations/swift/README.md. Target names and Swift code are not guessed; apply this step manually.`,
    );
  }
  for (const file of inventory.filter((f) =>
    f.endsWith(".xcodeproj/project.pbxproj"),
  )) {
    instructions.push(
      `${file}: add the HarnessSwift package and HarnessBuildPlugin to target Build Tool Plug-ins. Register target policy in harness-swift.json. Use the Xcode integration instructions; binary/dynamic project configuration is not rewritten.`,
    );
  }
  if (!modules.length)
    throw new Error(
      "No runnable package, Gradle, or Swift package discovered. For Xcode-only projects, follow integrations/swift/README.md and register the module explicitly.",
    );
  replacements.set(
    "harness.yaml",
    `# Candidate configuration. Review rule parameters and complete native check commands before use.\n${stringify(config)}`,
  );
  const gitignore = await read(root, ".gitignore");
  if (!gitignore.split("\n").some((line) => line.trim() === ".harness/"))
    replacements.set(
      ".gitignore",
      gitignore +
        (gitignore && !gitignore.endsWith("\n") ? "\n" : "") +
        ".harness/\n",
    );
  let patch = "";
  for (const [file, next] of replacements) {
    const previous = await read(root, file);
    patch += createTwoFilesPatch(
      previous ? `a/${file}` : "/dev/null",
      `b/${file}`,
      previous,
      next,
      "",
      "",
    );
  }
  const header =
    "# Target integration\n\nThis directory contains a proposed patch; no target files have been modified. Review the patch and explicit rule parameters, then apply with `git apply <patch-file>` from the target root. Install fixed package versions from your configured registry or use locally packed artifacts while developing; these names are not assumed to be publicly published. Update and commit the target lockfile with its own package manager. Then run the existing build and check commands.\n\n";
  const text = header + instructions.map((i) => "- " + i).join("\n") + "\n";
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "integration.patch"), patch);
  await writeFile(path.join(out, "README.md"), text);
  return { patch, instructions: text, modules };
}
