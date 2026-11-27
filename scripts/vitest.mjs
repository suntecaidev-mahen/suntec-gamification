#!/usr/bin/env node
// Runs Vitest with a canonical working directory. On Windows a lower-case drive letter
// ("d:\project" — common in VS Code terminals) makes Vite load `vitest` twice and every
// suite fails with "Cannot read properties of undefined (reading 'config')".
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const upper = (p) => p.replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`);
const cwd = upper(process.cwd());
const require = createRequire(join(cwd, 'package.json'));
const bin = upper(join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'));
const r = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { cwd, stdio: 'inherit' });
process.exit(r.status ?? 1);
