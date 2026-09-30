import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const defaultPath = () => {
  if (process.env.BOOKMARK_AGENT_SESSION) return process.env.BOOKMARK_AGENT_SESSION;
  const base = process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share');
  return join(base, 'bookmark-agent-bridge', 'session.json');
};

export const sessionPath = () => defaultPath();

// A crashed or force-killed `serve` cannot clean up after itself on every
// platform, so a session is only trusted while its process is still running.
function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export async function readSession(path = defaultPath()) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const session = JSON.parse(raw);
    if (typeof session?.url !== 'string' || typeof session?.token !== 'string') return null;
    return isRunning(session.pid) ? session : null;
  } catch {
    return null;
  }
}

export async function writeSession(session, path = defaultPath()) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ ...session, startedAt: new Date().toISOString() }), { encoding: 'utf8', mode: 0o600 });
}

export async function clearSession(path = defaultPath()) {
  await rm(path, { force: true });
}
