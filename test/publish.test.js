// Publish flow against a fake Confluence: create, update, conflicts, deleted pages, failed uploads, labels.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup } from './helpers/fake-confluence.js';

const { root, fake, cleanup } = setup();
after(cleanup);

const { publishDraft, PublishConflict } = await import('../src/publish.js');
const { listDrafts, writeDraft, readDraft, deleteDraft, restoreSnapshot, safeDraftPath } = await import('../src/drafts.js');
const { listHistory, listTrash, restoreFromTrash } = await import('../src/history.js');
const { compareWithRemote, adoptRemote } = await import('../src/remote.js');
const { parseDoc, stringifyDoc } = await import('../src/frontmatter.js');

const draftsDir = path.join(root, 'drafts');
const write = (name, meta, body) => {
  fs.mkdirSync(path.dirname(path.join(draftsDir, name)), { recursive: true });
  fs.writeFileSync(path.join(draftsDir, name), stringifyDoc(meta, body));
};
const read = (name) => parseDoc(fs.readFileSync(path.join(draftsDir, name), 'utf8'));
const pagesTitled = (t) => [...fake.pages.values()].filter((p) => p.title === t && p.status === 'current');
const draft = (name) => listDrafts().find((d) => d.name === name);

test('first publish creates the page and links the draft', async () => {
  write('biller/a.md', { title: '[PRD] Alpha', parent_id: '100', doc_status: 'DRAFT', labels: ['prd', 'biller'] }, '## Objective\n\nFirst version.\n');
  const r = await publishDraft('biller/a.md');
  const { meta } = read('biller/a.md');
  assert.equal(pagesTitled('[PRD] Alpha').length, 1);
  assert.equal(meta.confluence_id, r.id);
  assert.equal(meta.confluence_version, 1);
  assert.deepEqual([...fake.labels.get(r.id)].sort(), ['biller', 'prd']);
  assert.match(fake.pages.get(r.id).body, /First version\./);
  assert.equal(draft('biller/a.md').dirty, false, 'clean right after publish');
  assert.equal(listHistory('biller/a.md')[0].reason, 'publish');
});

test('editing makes the draft CHANGED; saving identical content does not', async () => {
  const text = readDraft('biller/a.md');
  writeDraft('biller/a.md', text);
  assert.equal(draft('biller/a.md').dirty, false);
  // touching the file without changing content keeps it clean (content hash, not mtime)
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(draftsDir, 'biller/a.md'), future, future);
  assert.equal(draft('biller/a.md').dirty, false);
  writeDraft('biller/a.md', text.replace('First version.', 'Second version.'));
  assert.equal(draft('biller/a.md').dirty, true);
});

test('update publishes the next version and syncs label removals', async () => {
  const { meta, body } = read('biller/a.md');
  write('biller/a.md', { ...meta, labels: ['prd'] }, body);
  const r = await publishDraft('biller/a.md', { message: 'round 2' });
  assert.equal(r.version, 2);
  assert.match(fake.pages.get(r.id).body, /Second version\./);
  assert.deepEqual([...fake.labels.get(r.id)], ['prd']);
});

test('an editor tab cannot unlink the draft from its page', () => {
  const { meta, body } = read('biller/a.md');
  const stale = { ...meta };
  delete stale.confluence_id;
  stale.confluence_version = 1;
  writeDraft('biller/a.md', stringifyDoc(stale, `${body}\nMore.\n`));
  const now = read('biller/a.md').meta;
  assert.equal(now.confluence_id, meta.confluence_id);
  assert.equal(now.confluence_version, 2);
  assert.match(read('biller/a.md').body, /More\./);
});

test('conflict: compare shows what changed remotely, taking the remote version resolves it', async () => {
  const id = read('biller/a.md').meta.confluence_id;
  fake.editRemotely(id, fake.pages.get(id).body.replace('Second version.', 'Edited in Confluence by Rina.'));
  await assert.rejects(publishDraft('biller/a.md'), PublishConflict);

  const cmp = await compareWithRemote('biller/a.md');
  assert.equal(cmp.remoteVersion, 3);
  assert.equal(cmp.localVersion, 2);
  assert.equal(cmp.remoteAuthor, 'Rina Editor');
  assert.equal(cmp.approximate, false);
  const remoteLines = cmp.remote.hunks.flatMap((h) => h.lines);
  assert.ok(remoteLines.some((l) => l.op === '+' && /Edited in Confluence/.test(l.line)));
  assert.ok(remoteLines.some((l) => l.op === '-' && /Second version/.test(l.line)));
  assert.ok(cmp.local.hunks.flatMap((h) => h.lines).some((l) => l.op === '+' && l.line === 'More.'));

  await adoptRemote('biller/a.md');
  const after = read('biller/a.md');
  assert.equal(after.meta.confluence_version, 3);
  assert.match(after.body, /Edited in Confluence by Rina\./);
  assert.equal(draft('biller/a.md').dirty, false);
  assert.ok(listHistory('biller/a.md').some((h) => h.reason === 'remote'), 'local text kept in history');
  const r = await publishDraft('biller/a.md');
  assert.equal(r.version, 4);
});

test('force overwrites a conflicting page', async () => {
  const id = read('biller/a.md').meta.confluence_id;
  fake.editRemotely(id, '<p>someone else</p>');
  await assert.rejects(publishDraft('biller/a.md'), PublishConflict);
  const r = await publishDraft('biller/a.md', { force: true });
  assert.equal(r.version, 6);
  assert.match(fake.pages.get(id).body, /Edited in Confluence by Rina/);
});

test('deleted page: PAGE_GONE, then publish as new', async () => {
  write('b.md', { title: 'Beta' }, 'Beta body\n');
  const first = await publishDraft('b.md');
  fake.pages.get(first.id).status = 'deleted';
  await assert.rejects(publishDraft('b.md'), (e) => e.code === 'PAGE_GONE');
  fake.pages.get(first.id).title = 'Beta (old)';
  const second = await publishDraft('b.md', { asNew: true });
  assert.notEqual(second.id, first.id);
  assert.equal(read('b.md').meta.confluence_id, second.id);
});

test('failed image upload on first publish does not create a duplicate page later', async () => {
  fs.mkdirSync(path.join(draftsDir, 'assets'), { recursive: true });
  fs.copyFileSync(new URL('./fixtures/pixel.png', import.meta.url), path.join(draftsDir, 'assets', 'shot.png'));
  write('c.md', { title: 'Gamma' }, 'Look:\n\n![shot](assets/shot.png)\n');
  fake.failUploads = true;
  await assert.rejects(publishDraft('c.md'));
  const linked = read('c.md').meta.confluence_id;
  assert.ok(linked, 'draft already points at the page that was created');
  fake.failUploads = false;
  const r = await publishDraft('c.md');
  assert.equal(r.id, linked);
  assert.equal(pagesTitled('Gamma').length, 1);
  assert.equal(fake.attachments.get(linked)[0].title, 'shot.png');
  assert.match(fake.pages.get(linked).body, /ri:filename="shot.png"/);
});

test('history: throttled autosaves, restore keeps the current text', () => {
  write('d.md', { title: 'Delta' }, 'v1\n');
  writeDraft('d.md', stringifyDoc({ title: 'Delta' }, 'v2\n'));
  writeDraft('d.md', stringifyDoc({ title: 'Delta' }, 'v3\n')); // within 10 minutes: no new snapshot
  let h = listHistory('d.md');
  assert.equal(h.length, 1);
  assert.match(fs.readFileSync(path.join(root, 'cache', 'history', 'd', h[0].id), 'utf8'), /v1/);
  restoreSnapshot('d.md', h[0].id);
  assert.match(read('d.md').body, /v1/);
  h = listHistory('d.md');
  assert.ok(h.some((x) => x.reason === 'restore'));
  assert.throws(() => restoreSnapshot('d.md', '../../etc/passwd'), /Invalid snapshot id/);
});

test('trash: delete and restore without overwriting', () => {
  const id = deleteDraft('d.md');
  assert.equal(fs.existsSync(path.join(draftsDir, 'd.md')), false);
  assert.equal(listTrash()[0].name, 'd.md');
  write('d.md', { title: 'New Delta' }, 'other\n');
  const name = restoreFromTrash(id, safeDraftPath);
  assert.equal(name, 'd-restored.md');
  assert.match(read('d-restored.md').body, /v1/);
  assert.equal(listTrash().length, 0);
});
