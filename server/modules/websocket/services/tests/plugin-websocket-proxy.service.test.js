import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import { WebSocketServer, WebSocket } from 'ws';

import { handlePluginWsProxy } from '../plugin-websocket-proxy.service.js';

// A stand-in for the authenticated browser leg. handlePluginWsProxy only uses
// on/close/send/readyState, so an EventEmitter with those is enough — and using a real
// WebSocket here would need a second server for no added coverage.
class FakeClientWs extends EventEmitter {
  constructor() {
    super();
    this.readyState = WebSocket.OPEN;
    this.closes = [];
    this.sent = [];
  }
  close(code, reason) { this.closes.push([code, reason]); this.readyState = WebSocket.CLOSED; }
  send(data, opts) { this.sent.push([data, opts]); }
}

/**
 * Boot a real upstream WS server, run the proxy against it, and resolve with the
 * Origin header the upstream actually received.
 *
 * Deliberately end-to-end through the real `new WebSocket(...)` call site. Asserting on
 * an extracted options object instead would pass even if the options were never handed
 * to the constructor — which is precisely the class of bug this is here to catch.
 */
function originSeenByUpstream() {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }, () => {
      const { port } = wss.address();
      const client = new FakeClientWs();
      const done = (fn, arg) => {
        clearTimeout(timer);
        // terminate() before close(): close() stops accepting but leaves established
        // sockets open, and the proxy holds one on each side. Without this the test
        // process has live handles and node --test never exits.
        for (const c of wss.clients) c.terminate();
        client.readyState = 3 /* CLOSED */;
        client.emit('close');
        wss.close(() => fn(arg));
      };
      const timer = setTimeout(() => done(reject, new Error('upstream never connected')), 5000);
      wss.on('connection', (_ws, req) => done(resolve, req.headers.origin));
      handlePluginWsProxy(client, '/plugin-ws/task-queue', () => port);
    });
    wss.on('error', reject);
  });
}

test('the upstream leg sends an Origin header — the `ws` client sends none by default', async () => {
  // The regression: the task-queue plugin gates its /ws upgrade on Origin. With no
  // Origin on this leg it 403'd every connect for three weeks. If this goes red, the
  // plugin's WebSocket is dead again.
  const prev = process.env.CLOUDCLI_ORIGIN;
  delete process.env.CLOUDCLI_ORIGIN;
  try {
    const origin = await originSeenByUpstream();
    assert.equal(origin, 'http://127.0.0.1:3001');
  } finally {
    if (prev === undefined) delete process.env.CLOUDCLI_ORIGIN; else process.env.CLOUDCLI_ORIGIN = prev;
  }
});

test('CLOUDCLI_ORIGIN overrides the default so host and plugin can be configured to agree', async () => {
  const prev = process.env.CLOUDCLI_ORIGIN;
  process.env.CLOUDCLI_ORIGIN = 'http://forge.example:3001';
  try {
    assert.equal(await originSeenByUpstream(), 'http://forge.example:3001');
  } finally {
    if (prev === undefined) delete process.env.CLOUDCLI_ORIGIN; else process.env.CLOUDCLI_ORIGIN = prev;
  }
});

test('an empty CLOUDCLI_ORIGIN falls back to the default rather than sending nothing', async () => {
  // `||` not `??` on purpose: an empty string here would reintroduce the anonymous
  // handshake this patch exists to remove.
  const prev = process.env.CLOUDCLI_ORIGIN;
  process.env.CLOUDCLI_ORIGIN = '';
  try {
    assert.equal(await originSeenByUpstream(), 'http://127.0.0.1:3001');
  } finally {
    if (prev === undefined) delete process.env.CLOUDCLI_ORIGIN; else process.env.CLOUDCLI_ORIGIN = prev;
  }
});

test('an invalid plugin name is refused before any upstream socket is opened', () => {
  const client = new FakeClientWs();
  handlePluginWsProxy(client, '/plugin-ws/../etc', () => 1234);
  assert.deepEqual(client.closes, [[4400, 'Invalid plugin name']]);
});

test('a plugin with no port closes the client rather than dialling', () => {
  const client = new FakeClientWs();
  handlePluginWsProxy(client, '/plugin-ws/task-queue', () => null);
  assert.deepEqual(client.closes, [[4404, 'Plugin not running']]);
});
