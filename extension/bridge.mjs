const METHODS = new Set([
  'bookmarks.getTree', 'bookmarks.get', 'bookmarks.search', 'bookmarks.getRecent',
  'bookmarks.findDuplicates', 'bookmarks.create', 'bookmarks.move', 'bookmarks.update',
  'bookmarks.remove', 'bookmarks.removeTree', 'bookmarks.batch'
]);
const WRITE_METHODS = new Set(['bookmarks.create', 'bookmarks.move', 'bookmarks.update', 'bookmarks.remove', 'bookmarks.removeTree']);
const DELETE_METHODS = new Set(['bookmarks.remove', 'bookmarks.removeTree']);

export class BridgeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const object = (value, name = 'params') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BridgeError('INVALID_REQUEST', `${name} must be an object.`);
  return value;
};
const string = (value, name) => {
  if (typeof value !== 'string' || !value) throw new BridgeError('INVALID_REQUEST', `${name} must be a non-empty string.`);
  return value;
};
const optionalIndex = (value) => {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new BridgeError('INVALID_REQUEST', 'index must be a non-negative integer.');
  return value;
};

async function node(bookmarks, id) {
  let nodes;
  try { nodes = await bookmarks.get(string(id, 'id')); } catch { nodes = []; }
  if (!nodes?.length) throw new BridgeError('NOT_FOUND', `Bookmark node ${id} was not found.`);
  return nodes[0];
}

async function checkExpected(bookmarks, id, expected) {
  const current = await node(bookmarks, id);
  if (expected === undefined) return current;
  object(expected, 'expected');
  for (const key of ['title', 'url', 'parentId']) {
    if (Object.hasOwn(expected, key) && current[key] !== expected[key]) {
      throw new BridgeError('STALE_NODE', `Bookmark node ${id} no longer matches expected.${key}.`);
    }
  }
}

function normalizeUrl(raw) {
  const match = /^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(raw);
  if (!match) return raw;
  const [, scheme, authority, rawPath = '', query = '', hash = ''] = match;
  const at = authority.lastIndexOf('@');
  const userInfo = at >= 0 ? authority.slice(0, at + 1) : '';
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
  const portMatch = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(hostPort);
  if (!portMatch) return raw;
  const host = portMatch[1].toLowerCase();
  const port = portMatch[2] && !((scheme.toLowerCase() === 'http' && portMatch[2] === '80') || (scheme.toLowerCase() === 'https' && portMatch[2] === '443')) ? `:${portMatch[2]}` : '';
  const path = rawPath === '/' ? '' : rawPath;
  return `${scheme}://${userInfo}${host}${port}${path}${query}${hash}`;
}

function duplicateGroups(tree, mode) {
  if (!['exact', 'normalized'].includes(mode)) throw new BridgeError('INVALID_REQUEST', 'mode must be exact or normalized.');
  const groups = new Map();
  const visit = (item) => {
    if (typeof item.url === 'string') {
      const key = mode === 'normalized' ? normalizeUrl(item.url) : item.url;
      const group = groups.get(key) ?? [];
      group.push({ id: item.id, title: item.title, url: item.url, parentId: item.parentId, index: item.index });
      groups.set(key, group);
    }
    item.children?.forEach(visit);
  };
  tree.forEach(visit);
  return [...groups.entries()].filter(([, nodes]) => nodes.length > 1).map(([key, nodes]) => ({ key, nodes }));
}

async function execute(method, params, context) {
  const { bookmarks, settings } = context;
  if (!METHODS.has(method)) throw new BridgeError('INVALID_REQUEST', `Unknown method: ${method}`);
  object(params);
  if (WRITE_METHODS.has(method) && !settings.allowWrite) throw new BridgeError('WRITE_DISABLED', 'Write operations are disabled in the extension.');
  if (DELETE_METHODS.has(method) && !settings.allowDelete) throw new BridgeError('DELETE_DISABLED', 'Delete operations are disabled in the extension.');

  switch (method) {
    case 'bookmarks.getTree': return bookmarks.getTree();
    case 'bookmarks.get': return [await node(bookmarks, params.id)];
    case 'bookmarks.search': {
      const query = {};
      for (const key of ['query', 'title', 'url']) if (params[key] !== undefined) query[key] = string(params[key], key);
      return bookmarks.search(query);
    }
    case 'bookmarks.getRecent': {
      if (!Number.isInteger(params.limit) || params.limit < 1) throw new BridgeError('INVALID_REQUEST', 'limit must be a positive integer.');
      return bookmarks.getRecent(params.limit);
    }
    case 'bookmarks.findDuplicates': return duplicateGroups(await bookmarks.getTree(), params.mode);
    case 'bookmarks.create': {
      string(params.parentId, 'parentId');
      if (typeof params.title !== 'string') throw new BridgeError('INVALID_REQUEST', 'title must be a string.');
      optionalIndex(params.index);
      return bookmarks.create({ parentId: params.parentId, title: params.title, ...(params.url !== undefined && { url: string(params.url, 'url') }), ...(params.index !== undefined && { index: params.index }) });
    }
    case 'bookmarks.move': {
      string(params.id, 'id');
      optionalIndex(params.index);
      if (params.parentId === undefined && params.index === undefined) throw new BridgeError('INVALID_REQUEST', 'move requires parentId or index.');
      await checkExpected(bookmarks, params.id, params.expected);
      return bookmarks.move(params.id, { ...(params.parentId !== undefined && { parentId: string(params.parentId, 'parentId') }), ...(params.index !== undefined && { index: params.index }) });
    }
    case 'bookmarks.update': {
      string(params.id, 'id');
      if (params.title === undefined && params.url === undefined) throw new BridgeError('INVALID_REQUEST', 'update requires title or url.');
      if (params.title !== undefined && typeof params.title !== 'string') throw new BridgeError('INVALID_REQUEST', 'title must be a string.');
      if (params.url !== undefined) string(params.url, 'url');
      await checkExpected(bookmarks, params.id, params.expected);
      return bookmarks.update(params.id, { ...(params.title !== undefined && { title: params.title }), ...(params.url !== undefined && { url: params.url }) });
    }
    case 'bookmarks.remove':
      string(params.id, 'id');
      await checkExpected(bookmarks, params.id, params.expected);
      await bookmarks.remove(params.id); return null;
    case 'bookmarks.removeTree':
      string(params.id, 'id');
      await checkExpected(bookmarks, params.id, params.expected);
      await bookmarks.removeTree(params.id); return null;
    case 'bookmarks.batch': return executeBatch(params, context);
  }
}

async function executeBatch(params, context) {
  if (!Array.isArray(params.operations)) throw new BridgeError('INVALID_REQUEST', 'operations must be an array.');
  const stopOnError = params.stopOnError !== false;
  const results = [];
  for (let index = 0; index < params.operations.length; index++) {
    const operation = object(params.operations[index], `operations[${index}]`);
    try {
      const op = string(operation.op, `operations[${index}].op`);
      const method = op.startsWith('bookmarks.') ? op : `bookmarks.${op}`;
      if (method === 'bookmarks.batch') throw new BridgeError('INVALID_REQUEST', 'Nested batches are not supported.');
      results.push({ index, status: 'completed', ok: true, result: await execute(method, operation.args ?? {}, context) });
    } catch (error) {
      results.push({ index, status: 'failed', ok: false, error: serializeError(error) });
      if (stopOnError) {
        for (let skipped = index + 1; skipped < params.operations.length; skipped++) results.push({ index: skipped, status: 'notExecuted', ok: false });
        break;
      }
    }
  }
  return results;
}

export const serializeError = (error) => ({
  code: error instanceof BridgeError ? error.code : 'CHROME_API_ERROR',
  message: error?.message || 'Chrome bookmarks API failed.'
});

export async function handleRequest(request, context) {
  if (!request || typeof request.id !== 'string' || typeof request.method !== 'string') throw new BridgeError('INVALID_REQUEST', 'Request requires string id and method.');
  try {
    return { id: request.id, ok: true, result: await execute(request.method, request.params ?? {}, context) };
  } catch (error) {
    return { id: request.id, ok: false, error: serializeError(error) };
  }
}
