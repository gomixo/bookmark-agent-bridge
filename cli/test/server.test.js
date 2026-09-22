import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocket } from 'ws';
import { startServer } from '../src/server.js';

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function sendRequest(socket, bridge, id, method = 'bookmarks.getTree', params = {}, token = bridge.token) {
  socket.send(JSON.stringify({ id, method, params, token }));
}

function next(socket) {
  return new Promise((resolve) => socket.once('message', (data) => resolve(JSON.parse(data))));
}

async function hello(bridge, token = bridge.token) {
  const socket = await connect(bridge.url);
  socket.send(JSON.stringify({ type: 'hello', protocolVersion: 1, token, extensionVersion: 'test', capabilities: { write: true, delete: false } }));
  return { socket, response: await next(socket) };
}

test('binds only to loopback and completes handshake', async (t) => {
  const bridge = await startServer({ port: 0 });
  t.after(() => bridge.close());
  assert.equal(bridge.host, '127.0.0.1');
  const { response } = await hello(bridge);
  assert.deepEqual(response, { type: 'hello.ok', protocolVersion: 1, capabilities: { write: true, delete: false } });
  await assert.rejects(() => startServer({ host: '0.0.0.0', port: 0 }), /only bind/);
});

test('rejects bad tokens and a second extension', async (t) => {
  const bridge = await startServer({ port: 0 });
  t.after(() => bridge.close());
  const bad = await hello(bridge, 'bad');
  assert.equal(bad.response.error.code, 'UNAUTHORIZED');
  const first = await hello(bridge);
  assert.equal(first.response.type, 'hello.ok');
  const second = await hello(bridge);
  assert.equal(second.response.error.code, 'CLIENT_ALREADY_CONNECTED');
});

test('rejects unsupported protocol versions', async (t) => {
  const bridge = await startServer({ port: 0 });
  t.after(() => bridge.close());
  const socket = await connect(bridge.url);
  socket.send(JSON.stringify({ type: 'hello', protocolVersion: 2, token: bridge.token, extensionVersion: 'test' }));
  assert.equal((await next(socket)).error.code, 'INVALID_REQUEST');
});

test('correlates request IDs and reports disconnects', async (t) => {
  const bridge = await startServer({ port: 0, timeoutMs: 200 });
  t.after(() => bridge.close());
  const { socket: extension } = await hello(bridge);

  const client = await connect(bridge.url);
  const forwarded = next(extension);
  sendRequest(client, bridge, 'req-7');
  assert.equal((await forwarded).id, 'req-7');
  extension.send(JSON.stringify({ id: 'req-7', ok: true, result: ['tree'] }));
  assert.deepEqual(await next(client), { id: 'req-7', ok: true, result: ['tree'] });

  const client2 = await connect(bridge.url);
  sendRequest(client2, bridge, 'req-8');
  await next(extension);
  extension.close();
  assert.equal((await next(client2)).error.code, 'EXTENSION_DISCONNECTED');
});

test('reports timeout and missing extension', async (t) => {
  const bridge = await startServer({ port: 0, timeoutMs: 30 });
  t.after(() => bridge.close());
  const missing = await connect(bridge.url);
  sendRequest(missing, bridge, 'missing');
  assert.equal((await next(missing)).error.code, 'EXTENSION_NOT_CONNECTED');

  const { socket: extension } = await hello(bridge);
  const client = await connect(bridge.url);
  sendRequest(client, bridge, 'slow');
  await next(extension);
  assert.equal((await next(client)).error.code, 'TIMEOUT');
});

test('authenticates request clients and rejects browser origins', async (t) => {
  const bridge = await startServer({ port: 0 });
  t.after(() => bridge.close());
  await hello(bridge);

  const missing = await connect(bridge.url);
  missing.send(JSON.stringify({ id: 'missing-token', method: 'bookmarks.getTree', params: {} }));
  assert.equal((await next(missing)).error.code, 'UNAUTHORIZED');

  const bad = await connect(bridge.url);
  sendRequest(bad, bridge, 'bad-token', 'bookmarks.getTree', {}, 'bad');
  assert.equal((await next(bad)).error.code, 'UNAUTHORIZED');

  const browserResponse = await new Promise((resolve, reject) => {
    const socket = new WebSocket(bridge.url, { headers: { Origin: 'https://evil.example' } });
    socket.once('message', (data) => resolve(JSON.parse(data)));
    socket.once('error', reject);
  });
  assert.equal(browserResponse.error.code, 'UNAUTHORIZED');

  const nullOriginResponse = await new Promise((resolve, reject) => {
    const socket = new WebSocket(bridge.url, { headers: { Origin: 'null' } });
    socket.once('message', (data) => resolve(JSON.parse(data)));
    socket.once('error', reject);
  });
  assert.equal(nullOriginResponse.error.code, 'UNAUTHORIZED');
});

test('rejects duplicate pending request IDs without overwriting the first', async (t) => {
  const bridge = await startServer({ port: 0, timeoutMs: 200 });
  t.after(() => bridge.close());
  const { socket: extension } = await hello(bridge);
  const first = await connect(bridge.url);
  const second = await connect(bridge.url);
  sendRequest(first, bridge, 'same');
  await next(extension);
  sendRequest(second, bridge, 'same');
  assert.equal((await next(second)).error.code, 'INVALID_REQUEST');
  extension.send(JSON.stringify({ id: 'same', ok: true, result: 'first' }));
  assert.equal((await next(first)).result, 'first');
});
