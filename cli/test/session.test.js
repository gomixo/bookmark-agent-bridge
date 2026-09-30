import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { clearSession, readSession, writeSession } from '../src/session.js';

async function sessionFile(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bab-session-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'session.json');
}

test('a written session is read back with its connection details', async (t) => {
  const file = await sessionFile(t);
  await writeSession({ url: 'ws://127.0.0.1:17373', token: 'session-token', pid: process.pid }, file);

  const session = await readSession(file);
  assert.equal(session.url, 'ws://127.0.0.1:17373');
  assert.equal(session.token, 'session-token');
  assert.equal(session.pid, process.pid);
  assert.equal(typeof session.startedAt, 'string');
});

test('reading a session that was never written returns null', async (t) => {
  const file = await sessionFile(t);
  assert.equal(await readSession(file), null);
});

test('reading a corrupt session file returns null', async (t) => {
  const file = await sessionFile(t);
  await writeSession({ url: 'ws://127.0.0.1:1', token: 't', pid: process.pid }, file);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, 'not json', 'utf8');
  assert.equal(await readSession(file), null);
});

test('a session missing its url or token is treated as absent', async (t) => {
  const file = await sessionFile(t);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, JSON.stringify({ url: 'ws://127.0.0.1:1' }), 'utf8');
  assert.equal(await readSession(file), null);
});

test('clearing removes the session file and is safe when it is already gone', async (t) => {
  const file = await sessionFile(t);
  await writeSession({ url: 'ws://127.0.0.1:1', token: 't', pid: process.pid }, file);
  await clearSession(file);
  assert.equal(await readSession(file), null);
  await clearSession(file);
});

test('clearing leaves an unrelated session file untouched', async (t) => {
  const file = await sessionFile(t);
  const other = `${file}.other`;
  await writeSession({ url: 'ws://127.0.0.1:2', token: 'other', pid: process.pid }, other);
  await clearSession(file);
  assert.equal((await readSession(other)).token, 'other');
});

async function deadPid() {
  const child = spawn(process.execPath, ['-e', '']);
  const [pid] = await once(child, 'exit').then(() => [child.pid]);
  return pid;
}

test('a session left behind by a dead process is treated as absent', async (t) => {
  const file = await sessionFile(t);
  await writeSession({ url: 'ws://127.0.0.1:17373', token: 'stale', pid: await deadPid() }, file);
  assert.equal(await readSession(file), null);
});

test('a session belonging to a running process is returned', async (t) => {
  const file = await sessionFile(t);
  await writeSession({ url: 'ws://127.0.0.1:17373', token: 'live', pid: process.pid }, file);
  assert.equal((await readSession(file)).token, 'live');
});

test('a session with no recorded pid is treated as absent', async (t) => {
  const file = await sessionFile(t);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, JSON.stringify({ url: 'ws://127.0.0.1:1', token: 'no-pid' }), 'utf8');
  assert.equal(await readSession(file), null);
});
