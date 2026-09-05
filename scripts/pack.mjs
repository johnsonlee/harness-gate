import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const destination=path.resolve('.harness/artifacts');
await mkdir(destination,{recursive:true});
for(const name of ['core','build','eslint-plugin','cli'])execFileSync('npm',['pack','--workspace',`@harness-engine/${name}`,'--pack-destination',destination],{stdio:'inherit'});
console.log(`Local artifacts: ${destination}`);
