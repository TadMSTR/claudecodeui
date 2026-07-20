import assert from 'node:assert/strict';
import test from 'node:test';

import { validateManifest } from '../plugin-loader.js';

const base = { name: 'task-queue', displayName: 'Task Queue', entry: 'index.js' };

test('validateManifest accepts a minimal valid manifest', () => {
  assert.deepEqual(validateManifest(base), { valid: true });
});

test('validateManifest requires name, displayName, entry', () => {
  assert.equal(validateManifest({ ...base, name: undefined }).valid, false);
  assert.equal(validateManifest({ ...base, displayName: undefined }).valid, false);
  assert.equal(validateManifest({ ...base, entry: undefined }).valid, false);
});

test('validateManifest rejects entry path traversal', () => {
  assert.equal(validateManifest({ ...base, entry: '../evil.js' }).valid, false);
  assert.equal(validateManifest({ ...base, entry: '/abs/evil.js' }).valid, false);
});

test('validateManifest accepts a permissions array of strings', () => {
  const manifest = { ...base, permissions: ['env:TASK_QUEUE_API', 'env:TASK_QUEUE_API_SECRET'] };
  assert.deepEqual(validateManifest(manifest), { valid: true });
});

test('validateManifest accepts an omitted permissions field', () => {
  assert.deepEqual(validateManifest(base), { valid: true });
});

test('validateManifest rejects a non-array or non-string permissions field', () => {
  assert.equal(validateManifest({ ...base, permissions: 'env:FOO' }).valid, false);
  assert.equal(validateManifest({ ...base, permissions: [42] }).valid, false);
  assert.equal(validateManifest({ ...base, permissions: [{ env: 'FOO' }] }).valid, false);
});
