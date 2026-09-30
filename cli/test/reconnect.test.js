import assert from 'node:assert/strict';
import test from 'node:test';

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function loadWorker(t, { token = 'session-token', paused = false } = {}) {
  const sockets = [];
  const alarms = { created: [], listener: null };
  const stored = { serviceUrl: token ? 'ws://127.0.0.1:17373' : '', token, allowWrite: false, allowDelete: false, paused };
  const written = [];
  let messageListener;
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: 'test' }),
      sendMessage: async () => {},
      onMessage: { addListener: (listener) => { messageListener = listener; } }
    },
    storage: {
      local: {
        get: async () => ({ ...stored }),
        set: async (value) => { Object.assign(stored, value); written.push(value); }
      }
    },
    alarms: {
      create: (name, options) => alarms.created.push({ name, options }),
      onAlarm: { addListener: (listener) => { alarms.listener = listener; } }
    },
    bookmarks: {}
  };
  globalThis.WebSocket = class {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSED = 3;
    readyState = 0;
    constructor(url) { this.url = url; this.sent = []; this.handlers = {}; sockets.push(this); }
    addEventListener(type, listener) { (this.handlers[type] ??= []).push(listener); }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.drop(1000); }
    fire(type, event = {}) { (this.handlers[type] ?? []).forEach((listener) => listener(event)); }
    settle() { this.readyState = 1; this.fire('open'); }
    // 1006 is what Chrome reports when a connection fails or dies without a
    // close frame; 1001 is a deliberate "going away" from the bridge.
    drop(code = 1006) { if (this.readyState === 3) return; this.readyState = 3; this.fire('close', { code }); }
  };
  t.after(() => { delete globalThis.chrome; delete globalThis.WebSocket; });

  await import(`../../extension/service-worker.js?run=${Date.now()}-${Math.random()}`);
  await tick();

  return {
    sockets,
    alarms,
    written,
    // Completes the handshake for every socket that has been dialled but not
    // yet opened, the way Chrome would once the connection is established.
    async settle() {
      await tick();
      for (const socket of sockets) if (socket.readyState === 0) socket.settle();
      await tick();
    },
    async send(type) {
      const status = await new Promise((resolve) => messageListener({ type }, null, resolve));
      await this.settle();
      return status;
    }
  };
}

test('the service worker connects on load when a session token is stored', async (t) => {
  const worker = await loadWorker(t);
  await worker.settle();
  assert.equal(worker.sockets.length, 1);
  assert.equal(worker.sockets[0].url, 'ws://127.0.0.1:17373');
  assert.equal(worker.sockets[0].sent[0].type, 'hello');
  assert.equal(worker.sockets[0].sent[0].token, 'session-token');
});

test('the reconnect alarm is registered so the worker is woken up again', async (t) => {
  const worker = await loadWorker(t);
  assert.deepEqual(worker.alarms.created.map((alarm) => alarm.name), ['reconnect']);
  assert.ok(worker.alarms.created[0].options.periodInMinutes >= 0.5);
});

test('a connection the browser dropped is re-established on the next alarm', async (t) => {
  const worker = await loadWorker(t);
  await worker.settle();
  worker.sockets[0].drop();

  await worker.alarms.listener({ name: 'reconnect' });
  await worker.settle();
  assert.equal(worker.sockets.length, 2);
  assert.equal(worker.sockets[1].sent[0].type, 'hello');
});

test('a manual disconnect stops the worker from reconnecting on its own', async (t) => {
  const worker = await loadWorker(t);
  await worker.settle();
  await worker.send('disconnect');

  await worker.alarms.listener({ name: 'reconnect' });
  await worker.settle();
  assert.equal(worker.sockets.length, 1);
});

test('connecting again after a manual disconnect resumes automatic reconnection', async (t) => {
  const worker = await loadWorker(t);
  await worker.settle();
  await worker.send('disconnect');
  await worker.send('connect');
  await worker.settle();
  assert.equal(worker.sockets.length, 2);

  worker.sockets[1].drop();
  await worker.alarms.listener({ name: 'reconnect' });
  await worker.settle();
  assert.equal(worker.sockets.length, 3);
});

test('nothing is dialled when no session token has been configured', async (t) => {
  const worker = await loadWorker(t, { token: '' });
  await worker.settle();
  assert.equal(worker.sockets.length, 0);
  await worker.alarms.listener({ name: 'reconnect' });
  assert.equal(worker.sockets.length, 0);
});

test('a manual disconnect is remembered so a restarted worker stays quiet', async (t) => {
  const worker = await loadWorker(t);
  await worker.settle();
  await worker.send('disconnect');
  assert.deepEqual(worker.written, [{ paused: true }]);
});

test('a worker that was paused before it restarted does not dial on load', async (t) => {
  const worker = await loadWorker(t, { paused: true });
  await worker.settle();
  assert.equal(worker.sockets.length, 0);
  await worker.alarms.listener({ name: 'reconnect' });
  assert.equal(worker.sockets.length, 0);
});

test('connecting clears the remembered pause', async (t) => {
  const worker = await loadWorker(t, { paused: true });
  await worker.settle();
  await worker.send('connect');
  await worker.settle();
  assert.equal(worker.sockets.length, 1);
  assert.equal(worker.written.at(-1).paused, false);
});

test('a bridge that shuts down for good is not called back', async (t) => {
  const worker = await loadWorker(t);
  await worker.settle();
  worker.sockets[0].fire('message', { data: JSON.stringify({ type: 'hello.ok', protocolVersion: 1 }) });
  await tick();

  worker.sockets[0].drop(1001);
  await tick();
  assert.equal(worker.written.at(-1).paused, true);

  await worker.alarms.listener({ name: 'reconnect' });
  await worker.settle();
  assert.equal(worker.sockets.length, 1);
});

test('a bridge that rejects the stored session is not dialled again', async (t) => {
  const worker = await loadWorker(t);
  await worker.settle();

  // A new serve prints a new token; the extension still holds the old one, so
  // the bridge refuses the handshake with 1008 after the socket has opened.
  worker.sockets[0].drop(1008);
  await tick();
  assert.equal(worker.written.at(-1).paused, true);

  await worker.alarms.listener({ name: 'reconnect' });
  await worker.settle();
  assert.equal(worker.sockets.length, 1);
});

test('a bridge speaking the wrong protocol version is not dialled again', async (t) => {
  const worker = await loadWorker(t);
  await worker.settle();

  worker.sockets[0].drop(1002);
  await tick();
  assert.equal(worker.written.at(-1).paused, true);

  await worker.alarms.listener({ name: 'reconnect' });
  await worker.settle();
  assert.equal(worker.sockets.length, 1);
});

test('repeated failures to reach the bridge stop the retries', async (t) => {
  const worker = await loadWorker(t);
  for (let attempt = 0; attempt < 5; attempt++) {
    await worker.alarms.listener({ name: 'reconnect' });
    await tick();
    worker.sockets.at(-1).drop(1006);
    await tick();
  }

  assert.equal(worker.written.at(-1).paused, true);
  const before = worker.sockets.length;
  await worker.alarms.listener({ name: 'reconnect' });
  await worker.settle();
  assert.equal(worker.sockets.length, before);
});

test('a successful handshake clears the failure count', async (t) => {
  const worker = await loadWorker(t);
  await worker.settle();
  worker.sockets[0].fire('message', { data: JSON.stringify({ type: 'hello.ok', protocolVersion: 1 }) });
  await tick();
  assert.deepEqual(worker.written, [{ failures: 0 }]);
});
