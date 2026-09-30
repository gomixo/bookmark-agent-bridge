import assert from 'node:assert/strict';
import test from 'node:test';
import { bindOptionsPage } from '../../extension/options.js';

async function openOptions(t) {
  const originalSetTimeout = globalThis.setTimeout;
  const ids = ['serviceUrl', 'token', 'allowWrite', 'allowDelete', 'state', 'message', 'save', 'connect', 'disconnect', 'saved', 'paste'];
  const elements = Object.fromEntries(ids.map((id) => [id, {
    value: '', checked: false, textContent: '', disabled: false,
    addEventListener(type, listener) { if (type === 'input') this.pasteListener = listener; else this.listener = listener; }
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

  bindOptionsPage();
  await new Promise((resolve) => setImmediate(resolve));

  return { elements, messages, getSaved: () => saved, status: (status) => statusListener({ type: 'status.changed', status }) };
}

test('options page saves before connecting and renders connection state', async (t) => {
  const { elements, messages, getSaved, status } = await openOptions(t);
  assert.equal(elements.state.textContent, '未连接');
  assert.equal(elements.disconnect.disabled, true);

  elements.token.value = 'new-token';
  elements.allowWrite.checked = true;
  messages.length = 0;
  await elements.connect.listener();
  assert.deepEqual(messages.slice(0, 2), ['save', 'connect']);
  assert.equal(getSaved().token, 'new-token');
  assert.equal(getSaved().allowWrite, true);
  assert.equal(elements.state.textContent, '已连接');
  assert.equal(elements.connect.disabled, true);

  status({ state: 'error', message: 'Rejected' });
  assert.equal(elements.state.textContent, '错误');
  assert.equal(elements.message.textContent, 'Rejected');

  await elements.disconnect.listener();
  assert.equal(messages.at(-1), 'disconnect');
  assert.equal(elements.state.textContent, '未连接');
});

test('pasting the line printed by serve fills in the address and token', async (t) => {
  const { elements } = await openOptions(t);

  elements.paste.value = JSON.stringify({ url: 'ws://127.0.0.1:51999', token: 'pasted-token', protocolVersion: 1 });
  elements.paste.pasteListener({ target: elements.paste });
  assert.equal(elements.serviceUrl.value, 'ws://127.0.0.1:51999');
  assert.equal(elements.token.value, 'pasted-token');
  assert.match(elements.message.textContent, /已导入/);
});

test('pasting something that is not a session says so and changes nothing', async (t) => {
  const { elements } = await openOptions(t);

  elements.paste.value = 'hello world';
  elements.paste.pasteListener({ target: elements.paste });
  assert.equal(elements.serviceUrl.value, 'ws://127.0.0.1:17373');
  assert.equal(elements.token.value, 'old');
  assert.match(elements.message.textContent, /无法识别/);
});
