import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../../extension/bridge.mjs';

function fakeBookmarks() {
  let sequence = 20;
  const nodes = new Map([
    ['0', { id: '0', title: '', children: [] }],
    ['1', { id: '1', parentId: '0', index: 0, title: 'Bookmarks bar', children: [] }],
    ['2', { id: '2', parentId: '0', index: 1, title: 'Other bookmarks', children: [] }],
    ['3', { id: '3', parentId: '1', index: 0, title: 'Example', url: 'https://Example.com:443/', dateAdded: 3 }],
    ['4', { id: '4', parentId: '1', index: 1, title: 'Example 2', url: 'https://example.com', dateAdded: 4 }],
    ['5', { id: '5', parentId: '1', index: 2, title: 'Query', url: 'https://example.com/?a=1', dateAdded: 5 }],
    ['6', { id: '6', parentId: '1', index: 3, title: 'WWW', url: 'https://www.example.com', dateAdded: 6 }],
    ['7', { id: '7', parentId: '1', index: 4, title: 'Chrome A', url: 'chrome://bookmarks', dateAdded: 7 }],
    ['8', { id: '8', parentId: '1', index: 5, title: 'Chrome B', url: 'chrome://bookmarks', dateAdded: 8 }],
    ['9', { id: '9', parentId: '1', index: 6, title: 'Dot A', url: 'https://example.com/a/../b', dateAdded: 9 }],
    ['10', { id: '10', parentId: '1', index: 7, title: 'Dot B', url: 'https://example.com/b', dateAdded: 10 }],
    ['11', { id: '11', parentId: '1', index: 8, title: 'Upper Scheme', url: 'HTTPS://example.net', dateAdded: 11 }],
    ['12', { id: '12', parentId: '1', index: 9, title: 'Lower Scheme', url: 'https://example.net', dateAdded: 12 }]
  ]);
  nodes.get('0').children = [nodes.get('1'), nodes.get('2')];
  nodes.get('1').children = [nodes.get('3'), nodes.get('4'), nodes.get('5'), nodes.get('6'), nodes.get('7'), nodes.get('8'), nodes.get('9'), nodes.get('10'), nodes.get('11'), nodes.get('12')];

  const clone = (value) => structuredClone(value);
  const api = {
    async getTree() { return [clone(nodes.get('0'))]; },
    async get(id) { return nodes.has(id) ? [clone(nodes.get(id))] : []; },
    async search(query) { return [...nodes.values()].filter((n) => n.url && Object.entries(query).every(([key, value]) => key === 'query' ? `${n.title} ${n.url}`.includes(value) : n[key] === value)).map(clone); },
    async getRecent(limit) { return [...nodes.values()].filter((n) => n.url).sort((a, b) => b.dateAdded - a.dateAdded).slice(0, limit).map(clone); },
    async create(input) {
      const parent = nodes.get(input.parentId);
      if (!parent?.children) throw new Error('Parent not found');
      const created = { id: String(sequence++), parentId: input.parentId, index: input.index ?? parent.children.length, title: input.title, ...(input.url ? { url: input.url } : { children: [] }) };
      parent.children.splice(created.index, 0, created); nodes.set(created.id, created); return clone(created);
    },
    async move(id, destination) {
      const item = nodes.get(id); if (!item) throw new Error('Not found');
      const old = nodes.get(item.parentId).children; old.splice(old.indexOf(item), 1);
      const parentId = destination.parentId ?? item.parentId; const target = nodes.get(parentId).children;
      item.parentId = parentId; item.index = destination.index ?? target.length; target.splice(item.index, 0, item); return clone(item);
    },
    async update(id, changes) { const item = nodes.get(id); if (!item) throw new Error('Not found'); Object.assign(item, changes); return clone(item); },
    async remove(id) { const item = nodes.get(id); if (!item) throw new Error('Not found'); if (item.children?.length) throw new Error('Folder not empty'); nodes.get(item.parentId).children.splice(nodes.get(item.parentId).children.indexOf(item), 1); nodes.delete(id); },
    async removeTree(id) { const item = nodes.get(id); if (!item) throw new Error('Not found'); nodes.get(item.parentId).children.splice(nodes.get(item.parentId).children.indexOf(item), 1); nodes.delete(id); }
  };
  return api;
}

const run = (bookmarks, method, params = {}, settings = { allowWrite: true, allowDelete: true }) => handleRequest({ id: 'test', method, params }, { bookmarks, settings });

test('queries tree, ID, search and recent bookmarks', async () => {
  const bookmarks = fakeBookmarks();
  assert.equal((await run(bookmarks, 'bookmarks.getTree')).result[0].id, '0');
  assert.equal((await run(bookmarks, 'bookmarks.get', { id: '3' })).result[0].title, 'Example');
  assert.equal((await run(bookmarks, 'bookmarks.search', { title: 'Query' })).result.length, 1);
  assert.equal((await run(bookmarks, 'bookmarks.getRecent', { limit: 2 })).result.length, 2);
});

test('creates, moves, updates and removes bookmarks and folders', async () => {
  const bookmarks = fakeBookmarks();
  const folder = (await run(bookmarks, 'bookmarks.create', { parentId: '2', title: 'Folder' })).result;
  const bookmark = (await run(bookmarks, 'bookmarks.create', { parentId: folder.id, title: 'Site', url: 'https://site.test' })).result;
  assert.equal((await run(bookmarks, 'bookmarks.move', { id: bookmark.id, parentId: '1', index: 0, expected: { parentId: folder.id } })).result.parentId, '1');
  assert.equal((await run(bookmarks, 'bookmarks.update', { id: bookmark.id, title: 'Renamed', url: 'https://new.test', expected: { title: 'Site' } })).result.title, 'Renamed');
  assert.equal((await run(bookmarks, 'bookmarks.remove', { id: bookmark.id, expected: { url: 'https://new.test' } })).ok, true);
  assert.equal((await run(bookmarks, 'bookmarks.remove', { id: folder.id })).ok, true);
  const tree = (await run(bookmarks, 'bookmarks.create', { parentId: '2', title: 'Tree' })).result;
  await run(bookmarks, 'bookmarks.create', { parentId: tree.id, title: 'Child', url: 'https://child.test' });
  assert.equal((await run(bookmarks, 'bookmarks.remove', { id: tree.id })).error.code, 'CHROME_API_ERROR');
  assert.equal((await run(bookmarks, 'bookmarks.removeTree', { id: tree.id })).ok, true);
});

test('enforces capability switches and expected values', async () => {
  const bookmarks = fakeBookmarks();
  assert.equal((await run(bookmarks, 'bookmarks.create', { parentId: '1', title: 'No' }, { allowWrite: false, allowDelete: false })).error.code, 'WRITE_DISABLED');
  assert.equal((await run(bookmarks, 'bookmarks.remove', { id: '3' }, { allowWrite: true, allowDelete: false })).error.code, 'DELETE_DISABLED');
  assert.equal((await run(bookmarks, 'bookmarks.move', { id: '3', parentId: '2', expected: { title: 'Changed' } })).error.code, 'STALE_NODE');
  assert.equal((await run(bookmarks, 'bookmarks.update', { id: '3', title: 'No', expected: { url: 'https://wrong.test' } })).error.code, 'STALE_NODE');
  assert.equal((await run(bookmarks, 'bookmarks.remove', { id: '3', expected: { parentId: '2' } })).error.code, 'STALE_NODE');
});

test('batch stops or continues and reports unexecuted operations', async () => {
  const stop = await run(fakeBookmarks(), 'bookmarks.batch', { operations: [
    { op: 'update', args: { id: '3', title: 'Done' } },
    { op: 'update', args: { id: 'missing', title: 'Fail' } },
    { op: 'update', args: { id: '4', title: 'Skipped' } }
  ] });
  assert.deepEqual(stop.result.map((item) => item.status), ['completed', 'failed', 'notExecuted']);

  const keepGoing = await run(fakeBookmarks(), 'bookmarks.batch', { stopOnError: false, operations: [
    { op: 'update', args: { id: 'missing', title: 'Fail' } },
    { op: 'update', args: { id: '4', title: 'Done' } }
  ] });
  assert.deepEqual(keepGoing.result.map((item) => item.status), ['failed', 'completed']);
});

test('finds exact and conservatively normalized duplicates', async () => {
  const bookmarks = fakeBookmarks();
  const exact = (await run(bookmarks, 'bookmarks.findDuplicates', { mode: 'exact' })).result;
  assert.deepEqual(exact[0].nodes.map((node) => node.id), ['7', '8']);
  const normalized = (await run(bookmarks, 'bookmarks.findDuplicates', { mode: 'normalized' })).result;
  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized.find((group) => group.key.startsWith('https:')).nodes.map((node) => node.id), ['3', '4']);
  assert.ok(!normalized.flatMap((group) => group.nodes).some((node) => ['5', '6', '9', '10', '11', '12'].includes(node.id)));
});

test('rejects invalid parameters before calling Chrome', async () => {
  const bookmarks = fakeBookmarks();
  assert.equal((await run(bookmarks, 'bookmarks.getRecent', { limit: 0 })).error.code, 'INVALID_REQUEST');
  assert.equal((await run(bookmarks, 'bookmarks.move', { id: '3' })).error.code, 'INVALID_REQUEST');
  assert.equal((await run(bookmarks, 'bookmarks.update', { id: '3' })).error.code, 'INVALID_REQUEST');
  assert.equal((await run(bookmarks, 'bookmarks.create', { parentId: '1', title: 'Bad', index: -1 })).error.code, 'INVALID_REQUEST');
  assert.equal((await run(bookmarks, 'bookmarks.get', { id: 'missing' })).error.code, 'NOT_FOUND');
  assert.equal((await run(bookmarks, 'bookmarks.batch', { operations: [{ op: 7, args: {} }] })).result[0].error.code, 'INVALID_REQUEST');
});
