const DEFAULTS = { serviceUrl: 'ws://127.0.0.1:17373', token: '', allowWrite: false, allowDelete: false };
const labels = { disconnected: '未连接', connecting: '连接中', connected: '已连接', error: '错误' };

// Accepts the JSON line printed by `bookmark-agent serve`, so the user only
// has to copy one thing out of the terminal.
function parseSession(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed?.url === 'string' && typeof parsed?.token === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

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

export function bindOptionsPage() {
  document.querySelector('#paste').addEventListener('input', (event) => {
    const session = parseSession(event.target.value);
    const message = document.querySelector('#message');
    if (!session) {
      message.textContent = event.target.value.trim() ? '无法识别，请粘贴 serve 打印的那一行。' : '';
      return;
    }
    document.querySelector('#serviceUrl').value = session.url;
    document.querySelector('#token').value = session.token;
    message.textContent = '已导入地址和令牌，点“连接 Agent”即可。';
  });

  document.querySelector('#save').addEventListener('click', save);
  document.querySelector('#connect').addEventListener('click', async () => {
    await save();
    render(await chrome.runtime.sendMessage({ type: 'connect' }));
  });
  document.querySelector('#disconnect').addEventListener('click', async () => render(await chrome.runtime.sendMessage({ type: 'disconnect' })));
  chrome.runtime.onMessage.addListener((message) => { if (message.type === 'status.changed') render(message.status); });
  chrome.runtime.sendMessage({ type: 'status' }).then(render);
  load();
}

if (typeof document !== 'undefined') bindOptionsPage();
