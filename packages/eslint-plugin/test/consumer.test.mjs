import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

test('packed rule library runs in an independent TS/JSX consumer', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-eslint-consumer-'));
  try {
    const packageDir = fileURLToPath(new URL('../', import.meta.url));
    const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', scratch, '--ignore-scripts'], { cwd: packageDir, encoding: 'utf8' }));
    assert.ok(packed[0].files.some(file => file.path === 'src/index.d.ts'));
    assert.ok(!packed[0].files.some(file => file.path.startsWith('test/')));
    await fs.writeFile(path.join(scratch, 'package.json'), JSON.stringify({ name: 'external-consumer', private: true, type: 'module' }));
    execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', path.join(scratch, packed[0].filename)], { cwd: scratch, encoding: 'utf8' });
    const plugin = (await import(pathToFileURL(path.join(scratch, 'node_modules/@harness-engine/eslint-plugin/src/index.js')).href)).default;
    await fs.mkdir(path.join(scratch, 'apps/server'), { recursive: true });
    await fs.mkdir(path.join(scratch, 'apps/web'), { recursive: true });
    await fs.mkdir(path.join(scratch, 'packages/shared'), { recursive: true });
    await fs.writeFile(path.join(scratch, 'apps/server/private.ts'), 'export type Secret = string;');
    await fs.writeFile(path.join(scratch, 'packages/shared/index.ts'), 'export type Props = { title: string };');
    const eslint = new ESLint({
      cwd: scratch,
      overrideConfigFile: true,
      overrideConfig: [{
        files: ['**/*.{ts,tsx}'],
        languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { harness: plugin },
        rules: {
          'harness/forbidden-imports': ['error', { patterns: ['server-only/**'] }],
          'harness/dependency-boundaries': ['error', {
            modules: [{ name: 'web', root: 'apps/web' }, { name: 'server', root: 'apps/server' }, { name: 'shared', root: 'packages/shared' }],
            allow: { web: ['shared'] },
            aliases: { '@/*': ['apps/server/*'], '@/public': ['packages/shared/index.ts'], '@fallback/*': ['absent/*', 'apps/server/*'] },
          }],
        },
      }],
    });
    const lint = async (code, name = 'apps/web/page.tsx') => (await eslint.lintText(code, { filePath: path.join(scratch, name) }))[0];
    const react = await lint('"use client"; import type { Props } from "@/public"; export default function Page({title}: Props) { return <main>{title}</main>; }');
    assert.equal(react.errorCount, 0, JSON.stringify(react.messages));
    const next = await lint('import type { Metadata } from "next"; export const metadata: Metadata = { title: "Home" }; export default function Page() { return <div>Home</div>; }');
    assert.equal(next.errorCount, 0, JSON.stringify(next.messages));
    const vue = await lint('import { defineComponent } from "vue"; export default defineComponent({ setup() { return () => <div>Hello</div>; } });');
    assert.equal(vue.errorCount, 0, JSON.stringify(vue.messages));
    for (const code of [
      'import type { Secret } from "@/private.js"; export type Props = { secret: Secret };',
      'export type { Secret } from "../server/private.js";',
      'const loader = () => import("@fallback/private");',
      'import server = require("@/private");',
    ]) {
      const result = await lint(code);
      assert.equal(result.errorCount, 1, JSON.stringify(result.messages));
      assert.equal(result.messages[0].ruleId, 'harness/dependency-boundaries');
      assert.equal(result.messages[0].line, 1);
    }
    const forbidden = await lint('import type { Secret } from "server-only/types";');
    assert.equal(forbidden.messages[0].ruleId, 'harness/forbidden-imports');
    assert.equal(forbidden.errorCount, 1);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
