// Web server + pull + move against a fake Confluence.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { setup } from './helpers/fake-confluence.js';

const { root, fake, cleanup } = setup();
fs.writeFileSync(path.join(root, 'cache', 'settings.json'), JSON.stringify({ autoFetchMinutes: 0, autoFetchOnStart: false }));

// Space: Home > Product Development > Biller > [PRD] Backlog - Biller > [PRD] One, [PRD] Two
//                                             > [PRD] Development - Biller
//        Home > Folder A > Folder B > Nested page
fake.addPage({ id: '200', title: 'Product Development', parentId: '100' });
fake.addPage({ id: '210', title: 'Biller', parentId: '200' });
fake.addPage({ id: '211', title: '[PRD] Backlog - Biller', parentId: '210', position: 0 });
fake.addPage({ id: '212', title: '[PRD] Development - Biller', parentId: '210', position: 1 });
fake.addPage({ id: '301', title: '[PRD] One', parentId: '211', position: 0, body: '<h2>Objective</h2><p>One body</p>' });
fake.addPage({ id: '302', title: '[PRD] Two', parentId: '211', position: 1 });
fake.folders.set('900', { id: '900', title: 'Folder A', parentId: '100', parentType: 'page' });
fake.folders.set('901', { id: '901', title: 'Folder B', parentId: '900', parentType: 'folder' });
fake.addPage({ id: '400', title: 'Nested page', parentId: '901', parentType: 'folder' });

const { pull, readIndex } = await import('../src/sync.js');
const { startServer } = await import('../src/server.js');

let server;
let port;
before(async () => {
  await pull({});
  ({ server } = await startServer({ port: 0 }));
  port = server.address().port;
});
after(async () => {
  await waitIdle();
  server?.close();
  server?.closeAllConnections?.();
  cleanup();
});

/** Raw request so tests control Host/Origin headers exactly. */
function call(method, p, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: `127.0.0.1:${port}`, ...(data ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
async function waitIdle() {
  for (let i = 0; i < 100; i++) {
    const r = await call('GET', '/api/status').catch(() => null);
    if (!r || !r.json?.busy) return;
    await new Promise((res) => setTimeout(res, 50));
  }
}

test('pull keeps folders nested in folders', () => {
  const index = readIndex();
  assert.equal(index.nodes['400'].parentId, '901');
  assert.equal(index.nodes['901'].parentId, '900');
  assert.equal(index.nodes['900'].parentId, '100');
  assert.equal(index.nodes['400'].path.split(path.sep).join('/'), 'folder-a/folder-b/nested-page.md');
  assert.equal(index.nodes['301'].lifecycle, 'backlog');
});

test('security guards', async () => {
  assert.equal((await call('GET', '/api/drafts/..%2F..%2Fsecret.md')).status, 400);
  assert.equal((await call('GET', '/%E0%A4%A')).status, 400);
  assert.equal((await call('GET', '/api/status', { headers: { host: 'evil.example:80' } })).status, 403);
  assert.equal((await call('POST', '/api/drafts', { body: { title: 'x' }, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('POST', '/api/drafts', { body: { title: 'x' }, headers: { origin: 'null' } })).status, 403);
  assert.equal((await call('POST', '/api/drafts', { body: '{broken' })).status, 400);
  assert.equal((await call('GET', '/api/drafts/nope.md')).status, 404);
  assert.equal((await call('GET', '/att/abc/..%2F..%2Fx')).status, 400);
});

test('drafts API: create, save (publish fields protected), history, delete, restore', async () => {
  const created = await call('POST', '/api/drafts', { body: { title: 'Server Draft', template: 'blank', parentId: '211' } });
  assert.equal(created.status, 201);
  const name = created.json.name;
  const url = `/api/drafts/${name.split('/').map(encodeURIComponent).join('/')}`;
  let d = (await call('GET', url)).json;
  assert.equal(d.meta.parent_id, '211');
  // a client trying to set publish bookkeeping is ignored
  const put = await call('PUT', url, { body: { meta: { ...d.meta, confluence_id: '999' }, body: 'Hello\n' } });
  assert.equal(put.status, 200);
  d = (await call('GET', url)).json;
  assert.equal(d.meta.confluence_id, undefined);
  assert.equal(d.body.trim(), 'Hello');
  const hist = (await call('GET', `/api/history?draft=${encodeURIComponent(name)}`)).json.history;
  assert.equal(hist.length, 1);
  const snap = (await call('GET', `/api/history?draft=${encodeURIComponent(name)}&id=${hist[0].id}`)).json;
  assert.match(snap.text, /title: Server Draft/);
  const del = (await call('DELETE', url)).json;
  assert.ok(del.trashId);
  assert.equal((await call('GET', url)).status, 404);
  // a stale editor tab saving after the delete must not bring the draft back
  assert.equal((await call('PUT', url, { body: { meta: d.meta, body: 'late autosave\n' } })).status, 404);
  assert.equal((await call('GET', url)).status, 404);
  const trash = (await call('GET', '/api/trash')).json.trash;
  assert.equal(trash[0].name, name);
  const back = (await call('POST', '/api/trash/restore', { body: { id: trash[0].id } })).json;
  assert.equal(back.name, name);
  assert.equal((await call('GET', url)).status, 200);
});

test('move: rejects cycles and folders, moves a page and updates the tree', async () => {
  let r = await call('POST', '/api/move', { body: { id: '211', position: 'append', targetId: '301' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /own child/);
  r = await call('POST', '/api/move', { body: { id: '302', position: 'append', targetId: '901' } });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/move', { body: { id: '302', position: 'append', targetId: '212' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.parentId, '212');
  assert.deepEqual(r.json.undo, { position: 'after', targetId: '301' });
  assert.equal(fake.pages.get('302').parentId, '212');
  const tree = (await call('GET', '/api/tree')).json;
  assert.deepEqual(tree.nodes['212'].c, ['302']);
  assert.deepEqual(tree.nodes['211'].c, ['301']);
  // undo puts it back in the same place
  await waitIdle();
  r = await call('POST', '/api/move', { body: { id: '302', ...r.json.undo } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual((await call('GET', '/api/tree')).json.nodes['211'].c, ['301', '302']);
  await waitIdle();
  // background pull refreshed workspace paths and lifecycle
  assert.equal(readIndex().nodes['302'].lifecycle, 'backlog');
});

test('page → draft → compare with Confluence', async () => {
  const name = (await call('POST', '/api/page/301/draft')).json.name;
  let cmp = (await call('GET', `/api/remote-diff?draft=${encodeURIComponent(name)}`)).json;
  assert.equal(cmp.remoteVersion, cmp.localVersion);
  assert.equal(cmp.remote.hunks.length, 0, 'nothing changed remotely');
  assert.equal((await call('GET', '/api/drafts')).json.find((d) => d.name === name).dirty, false);
  fake.editRemotely('301', '<h2>Objective</h2><p>One body, edited</p>');
  cmp = (await call('GET', `/api/remote-diff?draft=${encodeURIComponent(name)}`)).json;
  assert.equal(cmp.remoteVersion, 2);
  assert.ok(cmp.remote.hunks[0].lines.some((l) => l.op === '+' && /edited/.test(l.line)));
});
