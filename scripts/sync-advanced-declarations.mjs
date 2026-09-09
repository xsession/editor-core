#!/usr/bin/env node
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src');
const output = join(root, 'editor-core');

for (const name of readdirSync(source)) {
  if (!name.endsWith('.d.ts')) continue;
  const implementation = join(source, `${name.slice(0, -5)}.ts`);
  if (existsSync(implementation)) continue;
  copyFileSync(join(source, name), join(output, name));
}

console.log('Synchronized advanced editor-core declarations.');
