import { randomUUID } from 'node:crypto';

export const PROTOCOL_VERSION = 1;
export const DEFAULT_URL = 'ws://127.0.0.1:17373';
export const DEFAULT_TIMEOUT_MS = 10_000;

export function request(method, params = {}, token) {
  if (typeof method !== 'string' || !method) throw new Error('method must be a non-empty string');
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('params must be a JSON object');
  if (typeof token !== 'string' || !token) throw new Error('A session token is required. Use --token or BOOKMARK_AGENT_TOKEN.');
  return { id: randomUUID(), method, params, token };
}

export function parseJson(value, label = 'JSON') {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} is invalid: ${error.message}`);
  }
}

export function errorResponse(id, code, message) {
  return { id: id ?? null, ok: false, error: { code, message } };
}
