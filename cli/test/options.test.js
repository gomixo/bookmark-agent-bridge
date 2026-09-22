import assert from 'node:assert/strict';
import test from 'node:test';

test('options page saves before connecting and renders connection state', async (t) => {
  const originalSetTimeout = globalThis.setTimeout;
  const elements = Object.fromEntries(['serviceUrl', 'token', 'allowWrite', 'allowDelete', 'state', 'message', 'save', 'connect', 'disconnect', 'saved'].map((id) => [id, {
    value: '', checked: false, textContent: '', disabled: false,
    addEventListener(_type, listener) { this.listener = listener; }
  }]));
  const messages = [];
  let statusListener;
  let saved;
  globalThis.document = { querySelector: (selector) => elements[selector.slice(1)] };
  globalThis.setTimeout = (callback) => { callback(); return 0; };
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ serviceUrl: 'ws://127.0.0.1:17373', token: 'old', allowWrite: false, allowDelete: false }),
        set: async (value) => { saved = value; messages.push('save'); }
      }
    },
    runtime: {
      onMessage: { addListener: (listener) => { statusListener = listener; } },
      sendMessage: async ({ type }) => {
        messages.push(type);
        if (type === 'connect') return { state: 'connected', message: '' };
        if (type === 'disconnect') return { state: 'disconnected', message: '' };
        return { state: 'disconnected', message: '' };
      }
    }
  };
  t.after(() => { delete globalThis.document; delete globalThis.chrome; globalThis.setTimeout = originalSetTimeout; });

  await import(`../../extension/options.js?test=${Date.now()}`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.state.textContent, '未连接');
  assert.equal(elements.disconnect.disabled, true);

  elements.token.value = 'new-token';
  elements.allowWrite.checked = true;
  messages.length = 0;
  await elements.connect.listener();
  assert.deepEqual(messages.slice(0, 2), ['save', 'connect']);
  assert.equal(saved.token, 'new-token');
  assert.equal(saved.allowWrite, true);
  assert.equal(elements.state.textContent, '已连接');
  assert.equal(elements.connect.disabled, true);

  statusListener({ type: 'status.changed', status: { state: 'error', message: 'Rejected' } });
  assert.equal(elements.state.textContent, '错误');
  assert.equal(elements.message.textContent, 'Rejected');

  await elements.disconnect.listener();
  assert.equal(messages.at(-1), 'disconnect');
  assert.equal(elements.state.textContent, '未连接');
});
