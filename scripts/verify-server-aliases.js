#!/usr/bin/env node
// Guards against a silent tsc-alias no-op: server/tsconfig.json maps "@/*" to
// "server/*", but Node has no such package, so any unrewritten "@/..." import
// that survives into dist-server crashes at require-time with
// "Cannot find package '@/shared'" — invisible until the process is started.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST_SERVER = join(import.meta.dirname, '..', 'dist-server');
const ALIAS_PATTERN = /(?:from|require\()\s*['"]@\//;

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

console.log('✓ No unresolved "@/" aliases in dist-server');
