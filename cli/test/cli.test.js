import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { WebSocket } from 'ws';
import { readSession, writeSession } from '../src/session.js';
import { startServer } from '../src/server.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

// Every CLI test runs against a throwaway session path so the suite never
// reads or writes the session file of a real bookmark task.
const sessionDir = await mkdtemp(join(tmpdir(), 'bab-cli-'));
process.env.BOOKMARK_AGENT_SESSION = join(sessionDir, 'session.json');
after(() => rm(sessionDir, { recursive: true, force: true }));

async function sessionEnv(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bab-cli-'));
  const file = join(dir, 'session.json');
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { BOOKMARK_AGENT_SESSION: file };
}

function fakeExtension(bridge) {
  const socket = new WebSocket(bridge.url);
  const ready = once(socket, 'open').then(() => {
    socket.send(JSON.stringify({ type: 'hello', protocolVersion: 1, token: bridge.token, extensionVersion: 'test' }));
  });
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === 'ping') return socket.send(JSON.stringify({ type: 'pong' }));
    if (message.id) socket.send(JSON.stringify({ id: message.id, ok: true, result: ['from-extension'] }));
  });
  return ready;
}

function firstLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline >= 0) resolve(buffer.slice(0, newline));
    });
    stream.on('error', reject);
  });
}

function collect(stream) {
  return new Promise((resolve) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => { buffer += chunk; });
    stream.on('end', () => resolve(buffer.trim()));
  });
}

async function runCli(args, env = {}) {
  const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  const stdout = collect(child.stdout);
  const stderr = collect(child.stderr);
  const [code] = await once(child, 'exit');
  return { code, stdout: await stdout, stderr: await stderr };
}

// Starts a long-running command and resolves with the line it prints, or with
// the exit code if it dies before printing anything.
function spawnCli(args, env = {}) {
  const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  const firstStdoutLine = firstLine(child.stdout);
  const exit = once(child, 'exit');
  const started = Promise.race([
    firstStdoutLine.then((line) => JSON.parse(line)),
    exit.then(([code]) => ({ exited: code }))
  ]);
  return { child, started, exit, stderr: firstLine(child.stderr) };
}

test('call gives a clear error when the service is not running', async () => {
  const child = spawn(process.execPath, [cli, 'call', 'bookmarks.getTree', '--url', 'ws://127.0.0.1:1', '--token', 'test', '--timeout', '100'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = once(child, 'exit');
  const errorLine = firstLine(child.stderr);
  const [code] = await exit;
  assert.equal(code, 1);
  assert.match((await errorLine), /Cannot reach bookmark bridge/);
});

test('call requires the session token', async () => {
  const child = spawn(process.execPath, [cli, 'call', 'bookmarks.getTree'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = once(child, 'exit');
  const errorLine = firstLine(child.stderr);
  const [code] = await exit;
  assert.equal(code, 1);
  assert.match(await errorLine, /session token is required/i);
});

test('serve exits on SIGINT and releases its port', async () => {
  const child = spawn(process.execPath, [cli, 'serve', '--url', 'ws://127.0.0.1:0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = once(child, 'exit');
  const info = JSON.parse(await firstLine(child.stdout));
  assert.match(info.url, /^ws:\/\/127\.0\.0\.1:\d+$/);
  child.kill('SIGINT');
  const [code, signal] = await exit;
  assert.ok(code === 0 || signal === 'SIGINT');

  await new Promise((resolve) => {
    const socket = new WebSocket(info.url);
    socket.once('error', () => resolve());
  });
});

test('serve moves to another port and says so when the default is occupied', async (t) => {
  const occupied = await startServer({ port: 0 });
  t.after(() => occupied.close());
  const serve = spawnCli(['serve', '--url', occupied.url]);
  t.after(() => serve.child.kill('SIGKILL'));

  const info = await serve.started;
  assert.ok(info.url, `serve exited early: ${JSON.stringify(info)}`);
  assert.notEqual(info.url, occupied.url);
  assert.match(await serve.stderr, /in use; listening on/);

  const session = await readSession(process.env.BOOKMARK_AGENT_SESSION);
  assert.equal(session.url, info.url);
  assert.equal(session.token, info.token);
});

test('serve records the session so later calls need no token argument', async (t) => {
  const env = await sessionEnv(t);
  const child = spawn(process.execPath, [cli, 'serve', '--url', 'ws://127.0.0.1:0'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  t.after(() => child.kill('SIGKILL'));
  const info = JSON.parse(await firstLine(child.stdout));

  const session = await readSession(env.BOOKMARK_AGENT_SESSION);
  assert.equal(session.url, info.url);
  assert.equal(session.token, info.token);
  assert.equal(session.pid, child.pid);
});

test('a session left behind by a stopped service is not reused', async (t) => {
  const env = await sessionEnv(t);
  const child = spawn(process.execPath, [cli, 'serve', '--url', 'ws://127.0.0.1:0'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  await firstLine(child.stdout);
  assert.ok(await readSession(env.BOOKMARK_AGENT_SESSION));

  // A graceful Ctrl+C deletes the file, but Windows does not deliver a signal
  // to a process killed this way, so the file can survive. What must hold on
  // every platform is that a session whose process is gone is never trusted.
  child.kill('SIGINT');
  await once(child, 'exit');
  assert.equal(await readSession(env.BOOKMARK_AGENT_SESSION), null);
});

test('call falls back to the recorded session for its url and token', async (t) => {
  const env = await sessionEnv(t);
  const bridge = await startServer({ port: 0 });
  t.after(() => bridge.close());
  await fakeExtension(bridge);
  await writeSession({ url: bridge.url, token: bridge.token, pid: process.pid }, env.BOOKMARK_AGENT_SESSION);

  const { code, stdout, stderr } = await runCli(['call', 'bookmarks.getTree', '--timeout', '2000'], env);
  assert.equal(stderr, '');
  assert.equal(code, 0);
  const message = JSON.parse(stdout);
  assert.equal(message.ok, true);
  assert.deepEqual(message.result, ['from-extension']);
});

test('an explicit token still wins over the recorded session', async (t) => {
  const env = await sessionEnv(t);
  await writeSession({ url: 'ws://127.0.0.1:1', token: 'stale', pid: process.pid }, env.BOOKMARK_AGENT_SESSION);

  const { code, stderr } = await runCli(['call', 'bookmarks.getTree', '--token', 'explicit', '--timeout', '100'], env);
  assert.equal(code, 1);
  assert.match(stderr, /Cannot reach bookmark bridge at ws:\/\/127\.0\.0\.1:1/);
});

test('call explains how to get a token when no session is running', async (t) => {
  const env = await sessionEnv(t);
  const { code, stderr } = await runCli(['call', 'bookmarks.getTree'], env);
  assert.equal(code, 1);
  assert.match(stderr, /bookmark-agent serve/);
});
