// Single-process build, resilient to an early-closing stdout consumer.
//
// When `npm run build` is piped to something that closes the pipe early
// (e.g. `| head -3`, `| grep -q`, a killed pager), writes to stdout fail with
// EPIPE. A shell `&&` chain (clean && tsc && copy) would abort mid-way on that
// signal and leave dist/ half-built — empty, or compiled but missing the copied
// reference assets. Running every step in one Node process that swallows EPIPE,
// and capturing tsc's output instead of letting it write to the closeable pipe,
// guarantees clean → compile → copy all run to completion regardless of the pipe.

import { rmSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// A closed downstream pipe makes our own writes fail with EPIPE; swallow it so
// logging can never crash the build. Diagnostics go to stderr (a `| head` closes
// stdout, not stderr), with the write itself guarded too.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
const log = (msg) => { try { process.stderr.write(`build: ${msg}\n`); } catch { /* pipe closed */ } };

// 1. Clean — remove any stale artifacts (renamed/deleted files cpSync won't prune).
log('cleaning dist/');
rmSync('dist', { recursive: true, force: true });

// 2. Compile. Capture tsc's stdio rather than inheriting the (closeable) pipe, so
//    a closed downstream stdout can't terminate tsc itself; forward what it printed.
log('compiling (tsc)');
const tsc = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc'], { encoding: 'utf8' });
if (tsc.error) { log(`failed to launch tsc: ${tsc.error.message}`); process.exit(1); }
const tscOutput = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`.trimEnd();
if (tscOutput) log(tscOutput);
if (tsc.status !== 0) { log(`tsc exited with code ${tsc.status}`); process.exit(tsc.status || 1); }

// 3. Copy reference assets (markdown specs read at runtime) into the build output.
log('copying reference assets');
cpSync('src/reference', 'dist/reference', { recursive: true });

log('done');
