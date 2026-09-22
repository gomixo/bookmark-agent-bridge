#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { DEFAULT_TIMEOUT_MS, DEFAULT_URL, parseJson, request } from './protocol.js';
import { startServer } from './server.js';

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

async function call(message, { url = DEFAULT_URL, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`Timed out connecting to ${url}`));
    }, timeoutMs);
    socket.once('open', () => socket.send(JSON.stringify(message)));
    socket.once('message', (data) => {
      clearTimeout(timer);
      socket.close();
      resolve(data.toString());
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Cannot reach bookmark bridge at ${url}: ${error.message}`));
    });
  });
}

async function main(args = process.argv.slice(2)) {
  const [command, subject] = args;
  const url = option(args, '--url', process.env.BOOKMARK_AGENT_URL ?? DEFAULT_URL);
  const token = option(args, '--token', process.env.BOOKMARK_AGENT_TOKEN);
  const timeoutMs = Number(option(args, '--timeout', process.env.BOOKMARK_AGENT_TIMEOUT ?? DEFAULT_TIMEOUT_MS));

  if (command === 'serve') {
    const parsed = new URL(url);
    const bridge = await startServer({ host: parsed.hostname, port: Number(parsed.port || 17373), timeoutMs });
    console.log(JSON.stringify({ url: bridge.url, token: bridge.token, protocolVersion: 1 }));
    const stop = async () => { await bridge.close(); process.exit(0); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return;
  }

  if (command === 'call' && subject) {
    const params = parseJson(option(args, '--params', '{}'), '--params');
    console.log(await call(request(subject, params, token), { url, timeoutMs }));
    return;
  }

  if (command === 'batch' && subject) {
    const input = parseJson(await readFile(subject, 'utf8'), subject);
    const params = Array.isArray(input) ? { operations: input } : input;
    console.log(await call(request('bookmarks.batch', params, token), { url, timeoutMs }));
    return;
  }

  throw new Error('Usage: bookmark-agent serve|call <method> [--params <json>]|batch <file.json> [--url <ws-url>] [--token <token>]');
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: { code: 'CLI_ERROR', message: error.message } }));
  process.exitCode = 1;
});
