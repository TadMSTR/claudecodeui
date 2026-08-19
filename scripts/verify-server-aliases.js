#!/usr/bin/env node
// Guards against a silent tsc-alias no-op: server/tsconfig.json maps "@/*" to
// "server/*", but Node has no such package, so any unrewritten "@/..." import
// that survives into the build crashes at require-time with
// "Cannot find package '@/shared'" — invisible until the process is started.
//
// Takes the directory to check as an optional argument, defaulting to
// dist-server. build:server passes dist-server.next so the check runs against
// the *staged* build, before postbuild:server promotes it into place — a build
// that fails this check must never go live.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TARGET = process.argv[2] ?? 'dist-server';
const DIST_SERVER = resolve(import.meta.dirname, '..', TARGET);
const ALIAS_PATTERN = /(?:from|require\()\s*['"]@\//;

// A check that silently passes over a missing directory is worse than no check:
// it would report a clean build for a build that was never produced.
if (!existsSync(DIST_SERVER)) {
  console.error(`\n❌ verify-server-aliases: "${TARGET}" does not exist (looked in ${DIST_SERVER}).`);
  console.error('Nothing was checked — this is a build failure, not a pass.\n');
  process.exit(1);
}

function walk(dir, hits) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, hits);
    } else if (entry.endsWith('.js')) {
      const content = readFileSync(path, 'utf8');
      if (ALIAS_PATTERN.test(content)) hits.push(path);
    }
  }
}

const hits = [];
walk(DIST_SERVER, hits);

if (hits.length > 0) {
  console.error(`\n❌ Unresolved "@/" path aliases survived the build in ${hits.length} file(s):`);
  for (const file of hits) console.error(`   ${file}`);
  console.error('\ntsc-alias ran but did not rewrite these — do not deploy this build.\n');
  process.exit(1);
}

console.log(`✓ No unresolved "@/" aliases in ${TARGET}`);
