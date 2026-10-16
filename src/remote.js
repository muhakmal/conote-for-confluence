// Compare a published draft with its live Confluence page, and take the Confluence version back into the draft.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { Confluence } from './confluence.js';
import { parseDoc, stringifyDoc } from './frontmatter.js';
import { storageToMarkdown } from './storage2md.js';
import { safeDraftPath } from './drafts.js';
import { diffLines, hunks, diffStats } from '../web/lib/diff.js';
import { listHistory, readSnapshot, publishedRecord, recordPublished, snapshot } from './history.js';
import { stripLeadingTitle } from './render.js';

const USERS_FILE = () => path.join(config.cacheDir, 'users.json');

async function toMarkdown(cf, storage, pageId) {
  let users = {};
  try {
    users = JSON.parse(fs.readFileSync(USERS_FILE(), 'utf8'));
  } catch {}
  for (const [, id] of storage.matchAll(/ri:account-id="([^"]+)"/g)) if (!users[id]) users[id] = await cf.getUserName(id);
  return storageToMarkdown(storage, { pageId, userName: (id) => users[id] || id });
}

async function fetchRemote(cf, pageId) {
  try {
    const page = await cf.getPage(pageId, 'storage');
    return page;
  } catch (e) {
    if (e.status === 404) throw Object.assign(new Error(`Page ${pageId} no longer exists in Confluence`), { code: 'PAGE_GONE', status: 409 });
    throw e;
  }
}

function lastPublishedBody(name) {
  const snap = listHistory(name).find((s) => s.reason === 'publish');
  return snap ? parseDoc(readSnapshot(name, snap.id)).body : null;
}

const pack = (a, b) => {
  const ops = diffLines(a.trim(), b.trim());
  return { stats: diffStats(ops), hunks: hunks(ops) };
};

/**
 * What changed in Confluence since the last publish, and what changed locally.
 * @param {string} name draft name relative to drafts/
 */
export async function compareWithRemote(name, { client } = {}) {
  const text = fs.readFileSync(safeDraftPath(name), 'utf8');
  const { meta, body } = parseDoc(text);
  if (!meta.confluence_id) throw Object.assign(new Error('This draft has not been published yet'), { status: 400 });
  const cf = client || new Confluence();
  const pageId = String(meta.confluence_id);
  const remote = await fetchRemote(cf, pageId);
  const remoteMd = (await toMarkdown(cf, remote.body?.storage?.value || '', pageId)).markdown;
  const rec = publishedRecord(pageId);
  const baseMd = rec?.storageFile ? (await toMarkdown(cf, fs.readFileSync(rec.storageFile, 'utf8'), pageId)).markdown : null;
  const publishedBody = lastPublishedBody(name);
  const author = remote.version?.authorId ? await cf.getUserName(remote.version.authorId) : null;
  return {
    pageId,
    title: remote.title,
    remoteVersion: remote.version?.number,
    localVersion: meta.confluence_version,
    remoteAuthor: author,
    remoteUpdated: remote.version?.createdAt,
    // exact when we know what was published last; otherwise compare draft vs page directly
    approximate: !baseMd,
    remote: baseMd ? pack(baseMd, remoteMd) : pack(stripLeadingTitle(body, meta.title), remoteMd),
    local: publishedBody != null ? pack(stripLeadingTitle(publishedBody, meta.title), stripLeadingTitle(body, meta.title)) : null,
  };
}

/**
 * Replace the draft body with the current Confluence page (the local text is kept in history first).
 * Afterwards the draft is in sync with remote, so the next publish won't conflict.
 */
export async function adoptRemote(name, { client } = {}) {
  const abs = safeDraftPath(name);
  const text = fs.readFileSync(abs, 'utf8');
  const { meta } = parseDoc(text);
  if (!meta.confluence_id) throw Object.assign(new Error('This draft has not been published yet'), { status: 400 });
  const cf = client || new Confluence();
  const pageId = String(meta.confluence_id);
  const remote = await fetchRemote(cf, pageId);
  const storage = remote.body?.storage?.value || '';
  const { markdown, meta: props } = await toMarkdown(cf, storage, pageId);
  snapshot(name, text, 'remote');
  const next = { ...meta, ...props, title: remote.title, confluence_version: remote.version?.number };
  const out = stringifyDoc(next, markdown);
  fs.writeFileSync(abs, out);
  recordPublished(pageId, { text: out, version: remote.version?.number, storage });
  return { version: remote.version?.number };
}
