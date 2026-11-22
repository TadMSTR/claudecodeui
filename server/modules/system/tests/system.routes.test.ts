import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createSystemRouter } from '../system.routes.js';
import { createSystemUpdateService } from '../system.service.js';

type SystemUpdateDependencies = Parameters<typeof createSystemUpdateService>[0];

async function postUpdate(overrides: Partial<SystemUpdateDependencies>): Promise<{ status: number; body: Record<string, unknown> }> {
  const service = createSystemUpdateService({
    appRoot: '/app/cloudcli',
    homeDirectory: '/home/cloudcli',
    installMode: 'npm',
    isPlatform: false,
    uiUpdateAllowed: true,
    environment: {},
    runShellCommand: async () => ({ exitCode: 0, output: 'updated', errorOutput: '' }),
    logInfo: () => undefined,
    logError: () => undefined,
    ...overrides,
  });
  const server = express().use('/api/system', createSystemRouter(service)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/system/update`, { method: 'POST' });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    server.close();
    await once(server, 'close');
  }
}

// Fork patch ui-updaters-off: a refusal is the caller's to fix, so it is a 403, not a 500.
test('the system update route answers 403 when updates from the UI are off', async () => {
  let ran = false;
  const { status, body } = await postUpdate({
    uiUpdateAllowed: false,
    runShellCommand: async () => {
      ran = true;
      return { exitCode: 0, output: '', errorOutput: '' };
    },
  });
  assert.equal(status, 403);
  assert.equal(body.disabled, true);
  assert.equal(ran, false);
});

test('the system update route keeps 200 for a success and 500 for a failed command', async () => {
  assert.equal((await postUpdate({})).status, 200);
  assert.equal((await postUpdate({
    runShellCommand: async () => ({ exitCode: 1, output: '', errorOutput: 'npm failed' }),
  })).status, 500);
});
