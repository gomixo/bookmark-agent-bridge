import assert from 'node:assert/strict';
import test from 'node:test';

test('invalid service URL changes extension status to error', async (t) => {
  let listener;
  const messages = [];
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: 'test' }),
      sendMessage: async (message) => { messages.push(message); },
      onMessage: { addListener: (value) => { listener = value; } }
    },
    storage: { local: { get: async () => ({ serviceUrl: 'not-a-websocket-url', token: 'token', allowWrite: false, allowDelete: false }) } },
    bookmarks: {}
  };
  globalThis.WebSocket = class {
    static OPEN = 1;
    static CONNECTING = 0;
    constructor() { throw new SyntaxError('Invalid URL'); }
  };
  t.after(() => { delete globalThis.chrome; delete globalThis.WebSocket; });

  await import(`../../extension/service-worker.js?test=${Date.now()}`);
  const status = await new Promise((resolve) => listener({ type: 'connect' }, null, resolve));
  assert.equal(status.state, 'error');
  assert.match(status.message, /Invalid URL/);
  assert.equal(messages.at(-1).status.state, 'error');
});
