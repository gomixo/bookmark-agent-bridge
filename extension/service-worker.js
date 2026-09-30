import { handleRequest } from './bridge.mjs';

const DEFAULTS = { serviceUrl: 'ws://127.0.0.1:17373', token: '', allowWrite: false, allowDelete: false };
const RECONNECT_ALARM = 'reconnect';
const MAX_CONNECT_FAILURES = 5;
let socket = null;
let status = { state: 'disconnected', message: '' };

const updateStatus = (state, message = '') => {
  status = { state, message };
  chrome.runtime.sendMessage({ type: 'status.changed', status }).catch(() => {});
};

async function settings() { return { ...DEFAULTS, ...await chrome.storage.local.get(DEFAULTS) }; }

async function isPaused() { return (await chrome.storage.local.get('paused')).paused === true; }

async function pause(message) {
  await chrome.storage.local.set({ paused: true });
  updateStatus('disconnected', message);
}

// Chrome keeps waking this worker, so without a stop condition a finished task
// would leave it dialling a dead port forever. A deliberate shutdown ends the
// session at once. A rejection ends it too: the bridge closes with 1008 when
// it refuses the handshake, and this worker uses 1002 when the bridge speaks
// the wrong protocol version — redialling cannot fix either. Anything else is
// retried a few times and then given up on.
async function noteClosed(code, opened) {
  if (code === 1001) return pause('The bridge has stopped. Connect again to start a new session.');
  if (code === 1008) return pause('The bridge rejected this session. Paste the new session line from serve, then connect again.');
  if (code === 1002) return pause('The bridge speaks an incompatible protocol version. Update the CLI and the extension, then connect again.');
  if (opened) return;
  const { failures = 0 } = await chrome.storage.local.get('failures');
  const attempts = failures + 1;
  if (attempts >= MAX_CONNECT_FAILURES) return pause(`Could not reach the bridge after ${attempts} attempts. Connect again to retry.`);
  await chrome.storage.local.set({ failures: attempts });
}

async function connect({ force = false } = {}) {
  if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
  const paused = await isPaused();
  if (paused && !force) return updateStatus('disconnected');
  if (paused || force) await chrome.storage.local.set({ paused: false, failures: 0 });
  const config = await settings();
  if (!config.token) return updateStatus('disconnected', 'Set the session token in Options to connect.');
  updateStatus('connecting');
  let opened = false;
  try {
    socket = new WebSocket(config.serviceUrl);
  } catch (error) {
    socket = null;
    updateStatus('error', error?.message || 'Invalid bridge service address.');
    return;
  }
  socket.addEventListener('open', () => {
    opened = true;
    socket.send(JSON.stringify({
      type: 'hello', protocolVersion: 1, token: config.token,
      extensionVersion: chrome.runtime.getManifest().version
    }));
  });
  socket.addEventListener('message', async ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { return updateStatus('error', 'Bridge sent invalid JSON.'); }
    if (message.type === 'hello.ok') {
      if (message.protocolVersion !== 1) {
        updateStatus('error', 'Unsupported bridge protocol version.');
        socket.close(1002, 'Protocol version mismatch');
        return;
      }
      await chrome.storage.local.set({ failures: 0 });
      return updateStatus('connected');
    }
    if (message.type === 'ping') return socket.send(JSON.stringify({ type: 'pong' }));
    if (message.ok === false && !message.id) return updateStatus('error', message.error?.message ?? 'Connection rejected.');
    const response = await handleRequest(message, { bookmarks: chrome.bookmarks, settings: await settings() });
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(response));
  });
  socket.addEventListener('error', () => updateStatus('error', 'Cannot connect to the local bridge.'));
  socket.addEventListener('close', (event) => {
    socket = null;
    if (status.state !== 'error') updateStatus('disconnected');
    noteClosed(event?.code, opened);
  });
}

function disconnect() {
  socket?.close(1000, 'Disconnected by user');
  socket = null;
  chrome.storage.local.set({ paused: true }).catch(() => {});
  updateStatus('disconnected');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'connect') connect({ force: true }).then(() => sendResponse(status));
  else if (message?.type === 'disconnect') { disconnect(); sendResponse(status); }
  else if (message?.type === 'status') sendResponse(status);
  else return false;
  return true;
});

// Chrome suspends this worker when it is idle, which drops the socket. The
// alarm wakes the worker again so a task does not have to be babysat. A
// pause the user set by hand outlives the suspension.
chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) return connect();
});

connect();
