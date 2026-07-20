import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPluginEnv, envPassthroughVars, PLUGIN_ENV_ALLOWLIST } from '../plugin-process-manager.js';

// A host-allowlisted var name to exercise the passthrough path with, and a
// non-allowlisted one to exercise the host-side refusal. Kept in sync with the
// exported allowlist so the tests don't silently rot if it changes.
const ALLOWED_VAR = [...PLUGIN_ENV_ALLOWLIST][0];
const NOT_ALLOWED_VAR = 'CLAUDE_CODE_OAUTH_TOKEN_TEST_FIXTURE';

// ---------------------------------------------------------------------------
// envPassthroughVars — only well-formed `env:<VAR>` entries grant a passthrough
// ---------------------------------------------------------------------------

test('envPassthroughVars extracts var names from well-formed entries', () => {
  assert.deepEqual(
    envPassthroughVars(['env:TASK_QUEUE_API', 'env:TASK_QUEUE_API_SECRET']),
    ['TASK_QUEUE_API', 'TASK_QUEUE_API_SECRET'],
  );
});

test('envPassthroughVars ignores malformed, non-env, and non-string entries', () => {
  assert.deepEqual(
    envPassthroughVars([
      'network',            // unrelated permission kind
      'env:',               // no var name
      'env:1BAD',           // var names cannot start with a digit
      'env:HAS-DASH',       // dashes are not valid identifier chars
      'env:OK_VAR',         // valid
      42,                   // not a string
      null,                 // not a string
    ]),
    ['OK_VAR'],
  );
});

test('envPassthroughVars returns [] for non-array input', () => {
  assert.deepEqual(envPassthroughVars(undefined), []);
  assert.deepEqual(envPassthroughVars(null), []);
  assert.deepEqual(envPassthroughVars('env:FOO'), []);
});

// ---------------------------------------------------------------------------
// buildPluginEnv — baseline is secret-free; passthrough is opt-in + present-only
// ---------------------------------------------------------------------------

test('a plugin with no permissions gets the baseline env only', () => {
  const env = buildPluginEnv('some-plugin');
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'NODE_ENV', 'PATH', 'PLUGIN_NAME'].sort());
  assert.equal(env.PLUGIN_NAME, 'some-plugin');
});

test('a host-allowlisted, declared var is passed through when set in the host env', () => {
  const prev = process.env[ALLOWED_VAR];
  process.env[ALLOWED_VAR] = 'synthetic-not-a-real-secret';
  try {
    const env = buildPluginEnv('task-queue', [`env:${ALLOWED_VAR}`]);
    assert.equal(env[ALLOWED_VAR], 'synthetic-not-a-real-secret');
  } finally {
    if (prev === undefined) delete process.env[ALLOWED_VAR];
    else process.env[ALLOWED_VAR] = prev;
  }
});

test('a declared var NOT on the host allowlist is refused even when set in the host env', () => {
  // The manifest asks for it and it exists in the host env, but the host allowlist
  // does not include it — the second gate must refuse it (F-01 hardening).
  const prev = process.env[NOT_ALLOWED_VAR];
  process.env[NOT_ALLOWED_VAR] = 'synthetic-not-a-real-secret';
  try {
    assert.equal(PLUGIN_ENV_ALLOWLIST.has(NOT_ALLOWED_VAR), false); // guard the premise
    const env = buildPluginEnv('task-queue', [`env:${NOT_ALLOWED_VAR}`]);
    assert.equal(NOT_ALLOWED_VAR in env, false);
  } finally {
    if (prev === undefined) delete process.env[NOT_ALLOWED_VAR];
    else process.env[NOT_ALLOWED_VAR] = prev;
  }
});

test('a var NOT declared is never leaked even when set in the host env', () => {
  const prev = process.env[ALLOWED_VAR];
  process.env[ALLOWED_VAR] = 'synthetic-not-a-real-secret';
  try {
    // ALLOWED_VAR is on the host allowlist and set, but the manifest declares a
    // different var — an undeclared var is never passed through.
    const env = buildPluginEnv('task-queue', ['env:SOMETHING_ELSE']);
    assert.equal(ALLOWED_VAR in env, false);
  } finally {
    if (prev === undefined) delete process.env[ALLOWED_VAR];
    else process.env[ALLOWED_VAR] = prev;
  }
});

test('a declared, allowlisted var that is unset in the host env is not added', () => {
  const prev = process.env[ALLOWED_VAR];
  delete process.env[ALLOWED_VAR];
  try {
    const env = buildPluginEnv('task-queue', [`env:${ALLOWED_VAR}`]);
    assert.equal(ALLOWED_VAR in env, false);
  } finally {
    if (prev !== undefined) process.env[ALLOWED_VAR] = prev;
  }
});

test('a passthrough cannot clobber a fixed baseline var', () => {
  const prev = process.env.PLUGIN_NAME;
  process.env.PLUGIN_NAME = 'attacker-controlled';
  try {
    const env = buildPluginEnv('real-name', ['env:PLUGIN_NAME']);
    assert.equal(env.PLUGIN_NAME, 'real-name');
  } finally {
    if (prev === undefined) delete process.env.PLUGIN_NAME;
    else process.env.PLUGIN_NAME = prev;
  }
});
