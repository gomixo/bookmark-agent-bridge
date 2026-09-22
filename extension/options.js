const DEFAULTS = { serviceUrl: 'ws://127.0.0.1:17373', token: '', allowWrite: false, allowDelete: false };
const labels = { disconnected: '未连接', connecting: '连接中', connected: '已连接', error: '错误' };

function render(status) {
  const state = status?.state ?? 'disconnected';
  document.querySelector('#state').textContent = labels[state] ?? state;
  document.querySelector('#message').textContent = status?.message ?? '';
  document.querySelector('#connect').disabled = state === 'connecting' || state === 'connected';
  document.querySelector('#disconnect').disabled = state === 'disconnected' || state === 'error';
}

async function load() {
  const values = await chrome.storage.local.get(DEFAULTS);
  for (const key of ['serviceUrl', 'token']) document.querySelector(`#${key}`).value = values[key];
  for (const key of ['allowWrite', 'allowDelete']) document.querySelector(`#${key}`).checked = values[key];
}

async function save() {
  await chrome.storage.local.set({
    serviceUrl: document.querySelector('#serviceUrl').value.trim(),
    token: document.querySelector('#token').value.trim(),
    allowWrite: document.querySelector('#allowWrite').checked,
    allowDelete: document.querySelector('#allowDelete').checked
  });
  document.querySelector('#saved').textContent = '已保存';
  setTimeout(() => { document.querySelector('#saved').textContent = ''; }, 1500);
}

document.querySelector('#save').addEventListener('click', save);
document.querySelector('#connect').addEventListener('click', async () => {
  await save();
  render(await chrome.runtime.sendMessage({ type: 'connect' }));
});
document.querySelector('#disconnect').addEventListener('click', async () => render(await chrome.runtime.sendMessage({ type: 'disconnect' })));
chrome.runtime.onMessage.addListener((message) => { if (message.type === 'status.changed') render(message.status); });
chrome.runtime.sendMessage({ type: 'status' }).then(render);
load();
