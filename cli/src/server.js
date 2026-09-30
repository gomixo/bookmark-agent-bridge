import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { DEFAULT_TIMEOUT_MS, PROTOCOL_VERSION, errorResponse } from './protocol.js';

const closeWith = (socket, payload, code = 1008) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  socket.close(code, payload.error?.code ?? 'Rejected');
};

export async function startServer({ host = '127.0.0.1', port = 17373, token = randomBytes(24).toString('base64url'), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (host !== '127.0.0.1') throw new Error('The bridge may only bind to 127.0.0.1.');

  // The same port also answers plain HTTP GET /session so the extension can
  // discover this bridge with one click instead of a pasted line. As with the
  // WebSocket handshake, browser page origins get nothing and no CORS headers
  // are sent; the token already sits in a local session file any local
  // process can read, so this endpoint weakens nothing.
  const listen = async (requestedPort) => {
    const httpServer = createServer((request, response) => {
      if (request.method !== 'GET' || request.url !== '/session') {
        response.writeHead(404);
        response.end();
        return;
      }
      const origin = request.headers.origin;
      if (origin && !origin.startsWith('chrome-extension://')) {
        response.writeHead(403);
        response.end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ url: `ws://${host}:${httpServer.address().port}`, token, protocolVersion: PROTOCOL_VERSION }));
    });
    const server = new WebSocketServer({ server: httpServer, maxPayload: 1024 * 1024 });
    try {
      await new Promise((resolve, reject) => {
        // ws forwards the HTTP server's errors, so one listener covers both.
        server.once('error', reject);
        httpServer.once('listening', resolve);
        httpServer.listen(requestedPort, host);
      });
    } catch (error) {
      server.close();
      throw error;
    }
    return { server, httpServer };
  };

  // A leftover bridge from an earlier task should not block a new one, so an
  // occupied port falls back to an ephemeral one instead of failing outright.
  let server;
  let httpServer;
  let fellBackToEphemeralPort = false;
  try {
    ({ server, httpServer } = await listen(port));
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    ({ server, httpServer } = await listen(0));
    fellBackToEphemeralPort = true;
  }

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
        socket.send(JSON.stringify({ type: 'hello.ok', protocolVersion: PROTOCOL_VERSION }));
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

  const keepAlive = setInterval(() => {
    if (extension?.readyState === WebSocket.OPEN) extension.send(JSON.stringify({ type: 'ping' }));
  }, 20_000);

  const address = server.address();
  return {
    host,
    port: address.port,
    token,
    fellBackToEphemeralPort,
    url: `ws://${host}:${address.port}`,
    close: async () => {
      clearInterval(keepAlive);
      failPending('SERVER_SHUTDOWN', 'The bridge server is shutting down.');
      if (extension?.readyState === WebSocket.OPEN) extension.close(1001, 'Server shutdown');
      for (const client of server.clients) client.terminate();
      await new Promise((resolve) => server.close(resolve));
      httpServer.closeAllConnections();
      await new Promise((resolve) => httpServer.close(resolve));
    }
  };
}
