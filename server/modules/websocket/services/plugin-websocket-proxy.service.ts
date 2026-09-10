import { WebSocket } from 'ws';

/**
 * Proxies an authenticated client websocket to a plugin websocket endpoint.
 */
export function handlePluginWsProxy(
  clientWs: WebSocket,
  pathname: string,
  getPluginPort: (pluginName: string) => number | null
): void {
  const pluginName = pathname.replace('/plugin-ws/', '');
  if (!pluginName || /[^a-zA-Z0-9_-]/.test(pluginName)) {
    clientWs.close(4400, 'Invalid plugin name');
    return;
  }

  const port = getPluginPort(pluginName);
  if (!port) {
    clientWs.close(4404, 'Plugin not running');
    return;
  }

  // Send an explicit Origin on the upstream leg. The `ws` client sends NONE by
  // default, and a plugin that gates its upgrade on Origin therefore sees an
  // anonymous handshake from the one client it is supposed to trust. The task-queue
  // plugin's v0.4.0 hardening rejected exactly that shape and 403'd every connect for
  // three weeks (2239 failures) before anyone traced it to this line.
  //
  // This names the proxy's own loopback leg, not how the operator browses: the
  // browser's Origin reaches CloudCLI, never the plugin, because the proxy opens a
  // separate socket to 127.0.0.1:<ephemeral>. CLOUDCLI_ORIGIN overrides it so the
  // host and its plugins can be configured to agree on one value.
  const upstream = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    origin: process.env.CLOUDCLI_ORIGIN || 'http://127.0.0.1:3001',
  });

  upstream.on('open', () => {
    console.log(`[Plugins] WS proxy connected to "${pluginName}" on port ${port}`);
  });

  upstream.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });

  clientWs.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    }
  });

  upstream.on('close', () => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close();
    }
  });

  clientWs.on('close', () => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.close();
    }
  });

  upstream.on('error', (error) => {
    console.error(`[Plugins] WS proxy error for "${pluginName}":`, error.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(4502, 'Upstream error');
    }
  });

  clientWs.on('error', () => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.close();
    }
  });
}
