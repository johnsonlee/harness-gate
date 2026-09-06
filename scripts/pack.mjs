import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const destination=path.resolve('.harness/artifacts');
await mkdir(destination,{recursive:true});
for(const name of ['harness-gate-core','harness-gate','eslint-plugin-harness-gate','harness-gate-cli'])execFileSync('npm',['pack','--workspace',name,'--pack-destination',destination],{stdio:'inherit'});
console.log(`Local artifacts: ${destination}`);
