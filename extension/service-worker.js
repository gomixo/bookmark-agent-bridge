import { handleRequest } from './bridge.mjs';

const DEFAULTS = { serviceUrl: 'ws://127.0.0.1:17373', token: '', allowWrite: false, allowDelete: false };
let socket = null;
let status = { state: 'disconnected', message: '' };

const updateStatus = (state, message = '') => {
  status = { state, message };
  chrome.runtime.sendMessage({ type: 'status.changed', status }).catch(() => {});
};

async function settings() { return { ...DEFAULTS, ...await chrome.storage.local.get(DEFAULTS) }; }

async function connect() {
  if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
  const config = await settings();
  if (!config.token) return updateStatus('error', 'Set the session token in Options first.');
  updateStatus('connecting');
  try {
    socket = new WebSocket(config.serviceUrl);
  } catch (error) {
    socket = null;
    updateStatus('error', error?.message || 'Invalid bridge service address.');
    return;
  }
  socket.addEventListener('open', () => socket.send(JSON.stringify({
    type: 'hello', protocolVersion: 1, token: config.token,
    extensionVersion: chrome.runtime.getManifest().version,
    capabilities: { write: config.allowWrite, delete: config.allowWrite && config.allowDelete }
  })));
  socket.addEventListener('message', async ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { return updateStatus('error', 'Bridge sent invalid JSON.'); }
    if (message.type === 'hello.ok') {
      if (message.protocolVersion !== 1) {
        updateStatus('error', 'Unsupported bridge protocol version.');
        socket.close(1002, 'Protocol version mismatch');
        return;
      }
      return updateStatus('connected');
    }
    if (message.type === 'ping') return socket.send(JSON.stringify({ type: 'pong' }));
    if (message.ok === false && !message.id) return updateStatus('error', message.error?.message ?? 'Connection rejected.');
    const response = await handleRequest(message, { bookmarks: chrome.bookmarks, settings: await settings() });
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(response));
  });
  socket.addEventListener('error', () => updateStatus('error', 'Cannot connect to the local bridge.'));
  socket.addEventListener('close', () => { socket = null; if (status.state !== 'error') updateStatus('disconnected'); });
}

function disconnect() {
  socket?.close(1000, 'Disconnected by user');
  socket = null;
  updateStatus('disconnected');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'connect') connect().then(() => sendResponse(status));
  else if (message?.type === 'disconnect') { disconnect(); sendResponse(status); }
  else if (message?.type === 'status') sendResponse(status);
  else return false;
  return true;
});
