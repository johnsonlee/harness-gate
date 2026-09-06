import { RuleTester } from 'eslint';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import plugin from '../src/index.js';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } });
test('forbidden imports inspect syntax rather than comments and strings', () => {
  const options = [{ patterns: ['internal', 'internal/**'] }];
  tester.run('forbidden-imports', plugin.rules['forbidden-imports'], {
    valid: [
      { code: '// import x from "internal";\nconst x = "require(\'internal\')";', options },
      { code: 'import x from "internal-other";', options },
      { code: 'import x from "internal";' },
      { code: 'import(variable);', options },
      { code: 'function local(require) { require("internal"); }', options },
    ],
    invalid: [
      'import x from "internal";',
      'export { x } from "internal/deep/module";',
      'export * from "internal";',
      'const x = require("internal");',
      'import("internal");',
      'import(`internal`);',
    ].map(code => ({ code, options, errors: [{ messageId: 'forbidden' }] })),
  });
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-eslint-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
fs.mkdirSync(path.join(root, 'apps/server'), { recursive: true });
fs.mkdirSync(path.join(root, 'apps/web'), { recursive: true });
fs.writeFileSync(path.join(root, 'apps/server/index.ts'), 'export const x = 1;');
const filename = path.join(root, 'apps/web/index.ts');
const options = [{ rootDir: root, modules: [{ name: 'web', root: 'apps/web' }, { name: 'server', root: 'apps/server' }], allow: { web: [] }, aliases: { '@server/*': ['apps/server/*'], '@server': ['apps/server/index.ts'], '@fallback/*': ['missing/*', 'apps/server/*'] } }];
test('dependency boundaries cover relative imports, source extensions and explicit TS aliases', () => {
  tester.run('dependency-boundaries', plugin.rules['dependency-boundaries'], {
    valid: [
      { filename, options, code: 'import x from "./local";' },
      { filename, options, code: 'import x from "react";' },
      { filename, options, code: 'const x = "@server/index"; // import "@server"' },
      { filename, options: [{ ...options[0], allow: { web: ['server'] } }], code: 'import x from "@server";' },
      { filename: path.join(root, 'unmanaged.js'), options, code: 'import x from "@server";' },
    ],
    invalid: [
      'import { x } from "../server/index.js";',
      'export * from "../server";',
      'import { x } from "@server/index";',
      'export { x } from "@server";',
      'const x = require("@server/index");',
      'import("@fallback/index");',
    ].map(code => ({ filename, options, code, errors: [{ messageId: 'boundary' }] })),
  });
});
test('recommended config imposes no invented architecture policy', () => {
  assert.deepEqual(plugin.configs.recommended.rules, {});
  assert.equal(plugin.configs.recommended.plugins.harness, plugin);
});
