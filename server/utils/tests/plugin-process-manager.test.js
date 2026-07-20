import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPluginEnv, envPassthroughVars } from '../plugin-process-manager.js';

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

test('a declared var is passed through when set in the host env', () => {
  const VAR = 'TASK_QUEUE_API_SECRET_TEST_FIXTURE';
  const prev = process.env[VAR];
  process.env[VAR] = 'synthetic-not-a-real-secret';
  try {
    const env = buildPluginEnv('task-queue', [`env:${VAR}`]);
    assert.equal(env[VAR], 'synthetic-not-a-real-secret');
  } finally {
    if (prev === undefined) delete process.env[VAR];
    else process.env[VAR] = prev;
  }
});

test('a var NOT declared is never leaked even when set in the host env', () => {
  const VAR = 'UNDECLARED_SECRET_TEST_FIXTURE';
  const prev = process.env[VAR];
  process.env[VAR] = 'synthetic-not-a-real-secret';
  try {
    const env = buildPluginEnv('task-queue', ['env:SOMETHING_ELSE']);
    assert.equal(VAR in env, false);
  } finally {
    if (prev === undefined) delete process.env[VAR];
    else process.env[VAR] = prev;
  }
});

test('a declared var that is unset in the host env is not added', () => {
  const VAR = 'DEFINITELY_UNSET_TEST_FIXTURE';
  delete process.env[VAR];
  const env = buildPluginEnv('task-queue', [`env:${VAR}`]);
  assert.equal(VAR in env, false);
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
