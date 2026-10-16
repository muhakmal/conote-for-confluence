// Local safety net for drafts (drafts/ is git-ignored):
//   .cache/history/<draft key>/<timestamp>-<reason>.md   snapshots before overwrites, publishes and restores
//   .cache/trash/<timestamp>-<file>.md (+ .json sidecar)   deleted drafts, restorable
//   .cache/published/<pageId>.json / .xml                  what was last published (clean/changed state, remote diff)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { parseDoc, stringifyDoc } from './frontmatter.js';

const KEEP = 60; // snapshots per draft
const SAVE_INTERVAL_MS = 10 * 60_000; // autosave snapshots at most every 10 minutes
export const SERVER_KEYS = ['confluence_id', 'confluence_version', 'confluence_url', 'confluence_labels', 'published_at'];

const historyRoot = () => path.join(config.cacheDir, 'history');
const trashRoot = () => path.join(config.cacheDir, 'trash');
const publishedRoot = () => path.join(config.cacheDir, 'published');
const keyOf = (name) => String(name).replace(/\.md$/, '').replace(/[\\/]/g, '__');
const dirOf = (name) => path.join(historyRoot(), keyOf(name));

/** Hash of what the user wrote (server-managed publish fields excluded). */
export function contentHash(text) {
  const { meta, body } = parseDoc(text);
  const own = Object.fromEntries(Object.entries(meta).filter(([k]) => !SERVER_KEYS.includes(k)));
  return crypto.createHash('sha1').update(stringifyDoc(own, body).trim()).digest('hex').slice(0, 16);
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/**
 * Store `text` as a snapshot of draft `name`.
 * reason 'save' is throttled (one per SAVE_INTERVAL_MS); identical consecutive snapshots are skipped.
 */
export function snapshot(name, text, reason = 'save') {
  if (text == null) return null;
  const dir = dirOf(name);
  const list = listHistory(name);
  const last = list[0];
  if (last) {
    if (reason === 'save' && Date.now() - new Date(last.at).getTime() < SAVE_INTERVAL_MS) return null;
    if (fs.readFileSync(path.join(dir, last.id), 'utf8') === text) return null;
  }
  fs.mkdirSync(dir, { recursive: true });
  let id = `${stamp()}-${reason}.md`;
  for (let i = 2; fs.existsSync(path.join(dir, id)); i++) id = `${stamp()}-${reason}-${i}.md`;
  fs.writeFileSync(path.join(dir, id), text);
  fs.writeFileSync(path.join(dir, '_name.txt'), name);
  for (const old of listHistory(name).slice(KEEP)) fs.rmSync(path.join(dir, old.id), { force: true });
  return id;
}

/** @returns {{id:string, at:string, reason:string, size:number, title:string}[]} newest first */
export function listHistory(name) {
  const dir = dirOf(name);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{8}T\d{6}Z-[\w-]+\.md$/.test(f))
    .sort()
    .reverse()
    .map((id) => {
      const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-([a-z]+)/.exec(id);
      const text = fs.readFileSync(path.join(dir, id), 'utf8');
      return { id, at: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`, reason: m[7], size: text.length, title: parseDoc(text).meta.title || '' };
    });
}

export function readSnapshot(name, id) {
  if (!/^\d{8}T\d{6}Z-[\w-]+\.md$/.test(id)) throw new Error('Invalid snapshot id');
  const file = path.join(dirOf(name), id);
  if (!fs.existsSync(file)) throw Object.assign(new Error('Snapshot not found'), { status: 404 });
  return fs.readFileSync(file, 'utf8');
}

// ---------------- trash ----------------

export function moveToTrash(name, abs) {
  fs.mkdirSync(trashRoot(), { recursive: true });
  const id = `${Date.now()}-${path.basename(abs)}`;
  fs.renameSync(abs, path.join(trashRoot(), id));
  fs.writeFileSync(path.join(trashRoot(), `${id}.json`), JSON.stringify({ name, deletedAt: new Date().toISOString() }));
  return id;
}

export function listTrash() {
  if (!fs.existsSync(trashRoot())) return [];
  return fs
    .readdirSync(trashRoot())
    .filter((f) => /^\d+-.+\.md$/.test(f))
    .map((id) => {
      let side = {};
      try {
        side = JSON.parse(fs.readFileSync(path.join(trashRoot(), `${id}.json`), 'utf8'));
      } catch {}
      const text = fs.readFileSync(path.join(trashRoot(), id), 'utf8');
      return { id, name: side.name || id.replace(/^\d+-/, ''), deletedAt: side.deletedAt || new Date(Number(id.split('-')[0])).toISOString(), title: parseDoc(text).meta.title || id };
    })
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** Move a trashed draft back. Returns the draft name it was restored to (never overwrites). */
export function restoreFromTrash(id, safeDraftPath) {
  if (!/^\d+-[^/\\]+\.md$/.test(id)) throw new Error('Invalid trash id');
  const file = path.join(trashRoot(), id);
  if (!fs.existsSync(file)) throw Object.assign(new Error('Not in trash'), { status: 404 });
  const item = listTrash().find((t) => t.id === id);
  const original = item?.name || id.replace(/^\d+-/, '');
  let name = original;
  let abs = safeDraftPath(name);
  for (let i = 2; fs.existsSync(abs); i++) {
    name = original.replace(/\.md$/, `-restored${i > 2 ? `-${i}` : ''}.md`);
    abs = safeDraftPath(name);
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.renameSync(file, abs);
  fs.rmSync(path.join(trashRoot(), `${id}.json`), { force: true });
  return name;
}

// ---------------- last published state ----------------

export function recordPublished(pageId, { text, version, storage }) {
  fs.mkdirSync(publishedRoot(), { recursive: true });
  fs.writeFileSync(path.join(publishedRoot(), `${pageId}.json`), JSON.stringify({ hash: contentHash(text), version, at: new Date().toISOString() }));
  if (storage != null) fs.writeFileSync(path.join(publishedRoot(), `${pageId}.xml`), storage);
}

export function publishedRecord(pageId) {
  if (!pageId || !/^\d+$/.test(String(pageId))) return null;
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(publishedRoot(), `${pageId}.json`), 'utf8'));
    const xml = path.join(publishedRoot(), `${pageId}.xml`);
    return { ...rec, storageFile: fs.existsSync(xml) ? xml : null };
  } catch {
    return null;
  }
}
