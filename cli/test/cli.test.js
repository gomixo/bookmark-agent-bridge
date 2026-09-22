import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { WebSocket } from 'ws';
import { startServer } from '../src/server.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

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

test('serve exits when its port is already occupied', async (t) => {
  const occupied = await startServer({ port: 0 });
  t.after(() => occupied.close());
  const child = spawn(process.execPath, [cli, 'serve', '--url', occupied.url], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = once(child, 'exit');
  const errorLine = firstLine(child.stderr);
  const [code] = await exit;
  assert.equal(code, 1);
  assert.match(await errorLine, /EADDRINUSE/);
});
