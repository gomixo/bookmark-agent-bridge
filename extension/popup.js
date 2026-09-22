const labels = { disconnected: '未连接', connecting: '连接中', connected: '已连接', error: '错误' };
function render(status) {
  document.querySelector('#state').textContent = labels[status?.state] ?? status?.state ?? '未连接';
  document.querySelector('#message').textContent = status?.message ?? '';
}
chrome.runtime.sendMessage({ type: 'status' }).then(render);
chrome.runtime.onMessage.addListener((message) => { if (message.type === 'status.changed') render(message.status); });
document.querySelector('#connect').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'connect' }).then(render));
document.querySelector('#disconnect').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'disconnect' }).then(render));
document.querySelector('#options').addEventListener('click', () => chrome.runtime.openOptionsPage());
