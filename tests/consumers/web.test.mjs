import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repo = fileURLToPath(new URL('../../', import.meta.url));
function run(command, args, cwd, timeout = 240_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${command} timed out\n${output}`)); }, timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, output }); });
  });
}
async function write(root, file, text) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), text);
}

test('packed harness gates real Node, React, Next and Bun native builds', { timeout: 600_000 }, async t => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-web-consumers-'));
  try {
    const tarballs = [];
    for (const name of ['core', 'build', 'eslint-plugin']) {
      const result = await run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', scratch], path.join(repo, 'packages', name));
      assert.equal(result.status, 0, result.output);
      const [packed] = JSON.parse(result.output);
      if (name !== 'eslint-plugin') assert.ok(packed.files.some(file => file.path === 'dist/index.js'), `Build ${name} before consumer tests`);
      tarballs.push(path.join(scratch, packed.filename));
    }
    await write(scratch, 'package.json', JSON.stringify({ name: 'external-harness-gate-consumers', private: true, type: 'module' }));
    // One independent installation is shared by four child projects, as in a monorepo.
    // Versions are fixed; these builds never import source from the harness repository.
    const installation = await run('npm', ['install', '--no-audit', '--no-fund', ...tarballs,
      'eslint@9.39.5', 'typescript-eslint@8.69.0', 'typescript@5.9.3',
      'vite@8.2.2', 'next@16.3.4', 'react@19.2.8', 'react-dom@19.2.8',
      '@types/react@19.2.14', '@types/node@20.19.0'], scratch);
    assert.equal(installation.status, 0, installation.output);
    const eslintBin = path.join(scratch, 'node_modules/eslint/bin/eslint.js');
    const cases = [
      {
        stack: 'node', build: 'tsc -p tsconfig.json', entry: 'src/index.ts', artifact: 'dist/index.js',
        files: {
          'src/index.ts': 'export const greeting: string = "hello"; console.log(greeting);',
          'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', outDir: 'dist', rootDir: 'src', strict: true, skipLibCheck: true }, include: ['src'] }),
        },
      },
      {
        stack: 'react', build: 'vite build', entry: 'src/main.tsx', artifact: 'dist/index.html',
        files: {
          'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
          'src/main.tsx': 'import React from "react"; import { createRoot } from "react-dom/client"; createRoot(document.getElementById("root")!).render(<main>Harness React</main>);',
        },
      },
      {
        stack: 'next', build: 'next build --webpack', entry: 'app/page.tsx', artifact: '.next/BUILD_ID',
        files: {
          'app/layout.tsx': 'import type { ReactNode } from "react"; export default function Layout({children}: {children: ReactNode}) { return <html><body>{children}</body></html>; }',
          'app/page.tsx': 'export default function Page() { return <main>Harness Next</main>; }',
          'next.config.mjs': 'export default { experimental: { cpus: 1 }, outputFileTracingRoot: process.cwd() };',
          'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['dom', 'dom.iterable', 'esnext'], strict: true, noEmit: true, module: 'esnext', moduleResolution: 'bundler', jsx: 'react-jsx', allowJs: true, incremental: true, tsBuildInfoFile: '.next/cache/tsconfig.tsbuildinfo', esModuleInterop: true, resolveJsonModule: true, isolatedModules: true, skipLibCheck: true, plugins: [{ name: 'next' }] }, include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts', '.next/dev/types/**/*.ts'], exclude: ['node_modules'] }),
        },
      },
      {
        stack: 'bun', build: 'bun build src/index.ts --target=bun --outdir=dist', entry: 'src/index.ts', artifact: 'dist/index.js',
        files: { 'src/index.ts': 'export const greeting: string = "Harness Bun"; console.log(greeting);' },
      },
    ];
    for (const fixture of cases) await t.test(`${fixture.stack}: original build passes and lint blocks before invoking it`, { timeout: 240_000 }, async () => {
      const root = path.join(scratch, fixture.stack);
      const pkg = {
        name: `consumer-${fixture.stack}`, private: true, type: 'module',
        scripts: { build: 'harness-gate build' },
        harness: { build: `node mark-build.mjs && ${fixture.build}` },
        dependencies: { 'harness-gate': '0.1.0', 'eslint-plugin-harness-gate': '0.1.0', react: '19.2.8', 'react-dom': '19.2.8' },
      };
      await write(root, 'package.json', JSON.stringify(pkg, null, 2));
      await write(root, 'mark-build.mjs', 'import { mkdirSync, writeFileSync } from "fs"; mkdirSync(".harness", {recursive:true}); writeFileSync(".harness/build-invoked.marker", "invoked");');
      await write(root, 'harness.yaml', JSON.stringify({ version: 1, modules: [{ id: 'app', path: '.', stack: fixture.stack }], checks: [{ id: 'lint', modules: ['app'], phase: 'static', command: ['node', eslintBin, '.'] }] }));
      await write(root, 'eslint.config.mjs', `import harness from 'eslint-plugin-harness-gate';
import tseslint from 'typescript-eslint';
export default [
  { ignores: ['dist/**', '.next/**', '.harness/**', 'next-env.d.ts'] },
  { files: ['**/*.{js,mjs,ts,tsx}'], languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { harness }, rules: { 'harness/forbidden-imports': ['error', { patterns: ['node:fs'] }] } }
];`);
      for (const [file, contents] of Object.entries(fixture.files)) await write(root, file, contents);
      if (fixture.stack === 'next') {
        // Existing Next projects already contain generated ambient type declarations.
        // Bootstrap those before capturing the native build's input evidence.
        const generated = await run('node', [path.join(scratch, 'node_modules/next/dist/bin/next'), 'typegen'], root);
        assert.equal(generated.status, 0, generated.output);
      }
      const runner = fixture.stack === 'bun' ? 'bun' : 'npm';
      const good = await run(runner, ['run', 'build'], root);
      assert.equal(good.status, 0, good.output);
      assert.equal(await fs.readFile(path.join(root, '.harness/build-invoked.marker'), 'utf8'), 'invoked');
      assert.ok((await fs.stat(path.join(root, fixture.artifact))).isFile());
      await fs.unlink(path.join(root, '.harness/build-invoked.marker'));
      await fs.appendFile(path.join(root, fixture.entry), '\nimport "node:fs";\n');
      const bad = await run(runner, ['run', 'build'], root);
      assert.notEqual(bad.status, 0, bad.output);
      await assert.rejects(fs.access(path.join(root, '.harness/build-invoked.marker')), { code: 'ENOENT' });
      assert.match(bad.output, /harness\/forbidden-imports/);
      assert.match(bad.output, /node:fs/);
    });
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
