import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { DEFAULT_TIMEOUT_MS, PROTOCOL_VERSION, errorResponse } from './protocol.js';

const closeWith = (socket, payload, code = 1008) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  socket.close(code, payload.error?.code ?? 'Rejected');
};

export async function startServer({ host = '127.0.0.1', port = 17373, token = randomBytes(24).toString('base64url'), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (host !== '127.0.0.1') throw new Error('The bridge may only bind to 127.0.0.1.');

  const server = new WebSocketServer({ host, port, maxPayload: 1024 * 1024 });
  let extension = null;
  const pending = new Map();

  const failPending = (code, message) => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      if (entry.client.readyState === WebSocket.OPEN) entry.client.send(JSON.stringify(errorResponse(id, code, message)));
      entry.client.close();
    }
    pending.clear();
  };

  server.on('connection', (socket, request) => {
    if (request.headers.origin && !request.headers.origin.startsWith('chrome-extension://')) {
      closeWith(socket, errorResponse(null, 'UNAUTHORIZED', 'Browser page origins are not allowed.'));
      return;
    }
    const firstMessageTimer = setTimeout(() => closeWith(socket, errorResponse(null, 'INVALID_REQUEST', 'No initial message received.')), timeoutMs);

    socket.once('message', (raw) => {
      clearTimeout(firstMessageTimer);
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        closeWith(socket, errorResponse(null, 'INVALID_REQUEST', 'Messages must be valid JSON.'));
        return;
      }

      if (message.type === 'hello') {
        if (message.token !== token) return closeWith(socket, errorResponse(null, 'UNAUTHORIZED', 'Invalid session token.'));
        if (message.protocolVersion !== PROTOCOL_VERSION) return closeWith(socket, errorResponse(null, 'INVALID_REQUEST', `Protocol version ${PROTOCOL_VERSION} is required.`));
        if (extension?.readyState === WebSocket.OPEN) return closeWith(socket, errorResponse(null, 'CLIENT_ALREADY_CONNECTED', 'An extension is already connected.'));

        extension = socket;
        socket.send(JSON.stringify({
          type: 'hello.ok',
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            write: message.capabilities?.write === true,
            delete: message.capabilities?.delete === true
          }
        }));
        socket.on('message', (data) => {
          let response;
          try { response = JSON.parse(data.toString()); } catch { return; }
          if (response.type === 'pong') return;
          const entry = pending.get(response.id);
          if (!entry) return;
          clearTimeout(entry.timer);
          pending.delete(response.id);
          if (entry.client.readyState === WebSocket.OPEN) entry.client.send(JSON.stringify(response));
          entry.client.close();
        });
        socket.on('close', () => {
          if (extension === socket) {
            extension = null;
            failPending('EXTENSION_DISCONNECTED', 'The extension disconnected before responding.');
          }
        });
        return;
      }

      const { id, method, params, token: requestToken } = message;
      if (typeof id !== 'string' || typeof method !== 'string' || !params || typeof params !== 'object' || Array.isArray(params)) {
        return closeWith(socket, errorResponse(id, 'INVALID_REQUEST', 'Request requires string id and method plus object params.'));
      }
      if (requestToken !== token) return closeWith(socket, errorResponse(id, 'UNAUTHORIZED', 'Invalid session token.'));
      if (!extension || extension.readyState !== WebSocket.OPEN) {
        return closeWith(socket, errorResponse(id, 'EXTENSION_NOT_CONNECTED', 'No extension is connected.'));
      }
      if (pending.has(id)) return closeWith(socket, errorResponse(id, 'INVALID_REQUEST', 'A request with this ID is already pending.'));

      const timer = setTimeout(() => {
        pending.delete(id);
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(errorResponse(id, 'TIMEOUT', 'The extension did not respond in time.')));
        socket.close();
      }, timeoutMs);
      pending.set(id, { client: socket, timer });
      socket.on('close', () => {
        const entry = pending.get(id);
        if (entry?.client === socket) {
          clearTimeout(entry.timer);
          pending.delete(id);
        }
      });
      extension.send(JSON.stringify({ id, method, params }));
    });
  });

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const keepAlive = setInterval(() => {
    if (extension?.readyState === WebSocket.OPEN) extension.send(JSON.stringify({ type: 'ping' }));
  }, 20_000);

  const address = server.address();
  return {
    host,
    port: address.port,
    token,
    url: `ws://${host}:${address.port}`,
    close: async () => {
      clearInterval(keepAlive);
      failPending('SERVER_SHUTDOWN', 'The bridge server is shutting down.');
      if (extension?.readyState === WebSocket.OPEN) extension.close(1001, 'Server shutdown');
      for (const client of server.clients) client.terminate();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}
