// One-way publish: drafts/*.md → Confluence page (create or update, with conflict guard).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { Confluence } from './confluence.js';
import { parseDoc, stringifyDoc } from './frontmatter.js';
import { toStorage } from './render.js';
import { readIndex } from './sync.js';
import { snapshot, recordPublished } from './history.js';

/** Confluence labels: lowercase, no spaces. Accepts a list or "a, b c". */
export function normalizeLabels(v) {
  const list = Array.isArray(v) ? v : String(v ?? '').split(/[,\n]/);
  return [...new Set(list.map((l) => String(l).trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_.-]/gu, '')).filter(Boolean))];
}

export class PageGone extends Error {
  constructor(pageId, status) {
    super(`The Confluence page ${pageId} is ${status === 'trashed' ? 'in the trash' : 'no longer available'}. Restore it in Confluence, or publish this draft as a new page.`);
    this.code = 'PAGE_GONE';
    this.pageId = pageId;
    this.pageStatus = status;
  }
}

export class PublishConflict extends Error {
  constructor(remote, local) {
    super(`Page was edited in Confluence (remote v${remote.version}, last published v${local}). Pull and merge, or publish with force.`);
    this.code = 'CONFLICT';
    this.remoteVersion = remote.version;
    this.remoteAuthor = remote.authorId;
    this.localVersion = local;
  }
}

function resolveParentId(meta, index) {
  const raw = meta.parent_id ?? meta.parent;
  if (raw && /^\d+$/.test(String(raw))) return String(raw);
  if (raw && index) {
    const hit = Object.values(index.nodes).find((n) => n.title === raw || n.path === raw);
    if (hit) return hit.id;
    throw new Error(`Parent "${raw}" not found in pulled index. Run pull, or set parent_id.`);
  }
  return index?.space?.homeId;
}

/**
 * @param {string} file absolute or relative path of the draft
 * @param {{ force?: boolean, dryRun?: boolean, message?: string, onProgress?: (e:object)=>void }} opts
 */
export async function publishDraft(file, { force = false, dryRun = false, asNew = false, message, onProgress = () => {} } = {}) {
  const abs = path.resolve(config.draftsDir, file);
  const name = abs.startsWith(config.draftsDir + path.sep) ? path.relative(config.draftsDir, abs).split(path.sep).join('/') : null;
  const text = fs.readFileSync(abs, 'utf8');
  const { meta, body } = parseDoc(text);
  if (!meta.title) throw new Error('Draft needs a `title` in frontmatter');
  if (/\{\{\w+\}\}/.test(String(meta.title))) throw new Error('Title still contains template placeholders');

  onProgress({ phase: 'render', message: 'Rendering diagrams & converting…' });
  const warnings = [];
  const { storage, attachments } = await toStorage(meta, body, { baseDir: path.dirname(abs), onWarning: (w) => (warnings.push(w), onProgress({ phase: 'warning', message: w })) });
  if (dryRun) return { dryRun: true, storage, attachments: attachments.map((a) => a.filename) };

  const cf = new Confluence();
  const index = readIndex();
  const space = index?.space || (await cf.getSpace());
  if (asNew) for (const k of ['confluence_id', 'confluence_version', 'confluence_url', 'confluence_labels', 'published_at']) delete meta[k];
  let pageId = meta.confluence_id ? String(meta.confluence_id) : null;
  let result;

  if (pageId) {
    onProgress({ phase: 'check', message: 'Checking remote version…' });
    let remote;
    try {
      remote = await cf.getPage(pageId, 'storage');
    } catch (e) {
      if (e.status === 404) throw new PageGone(pageId, 'deleted');
      throw e;
    }
    if (remote.status && remote.status !== 'current') throw new PageGone(pageId, remote.status);
    const remoteVersion = remote.version?.number;
    if (!force && meta.confluence_version && remoteVersion !== Number(meta.confluence_version)) {
      throw new PublishConflict({ version: remoteVersion, authorId: remote.version?.authorId }, meta.confluence_version);
    }
    // Upload attachments first so the new body can reference them
    await uploadAll(cf, pageId, attachments, onProgress);
    onProgress({ phase: 'update', message: 'Updating page…' });
    result = await cf.updatePage({ id: pageId, title: meta.title, storage, version: remoteVersion + 1, message });
  } else {
    const parentId = resolveParentId(meta, index);
    onProgress({ phase: 'create', message: 'Creating page…' });
    // Create with the body minus images, then upload, then set final body (attachments need a page id)
    const hasAtt = attachments.length > 0;
    result = await cf.createPage({ spaceId: space.id, parentId, title: meta.title, storage: hasAtt ? '<p>Publishing…</p>' : storage });
    pageId = result.id;
    // Link the draft to the new page right away: if an upload fails below, the next publish
    // updates this page instead of creating a duplicate.
    Object.assign(meta, { confluence_id: pageId, confluence_version: result.version?.number, confluence_url: cf.webUrl(pageId) });
    fs.writeFileSync(abs, stringifyDoc(meta, body));
    if (hasAtt) {
      await uploadAll(cf, pageId, attachments, onProgress);
      result = await cf.updatePage({ id: pageId, title: meta.title, storage, version: result.version.number + 1, message });
    }
  }

  const labels = normalizeLabels(meta.labels);
  const previous = normalizeLabels(meta.confluence_labels);
  if (labels.length || previous.length) {
    onProgress({ phase: 'labels', message: 'Syncing labels…' });
    if (labels.length) await cf.request(`/rest/api/content/${pageId}/label`, { method: 'POST', body: labels.map((name) => ({ prefix: 'global', name })) });
    for (const name of previous.filter((l) => !labels.includes(l))) {
      await cf.request(`/rest/api/content/${pageId}/label?name=${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  const url = cf.webUrl(pageId);
  const nextMeta = {
    ...meta,
    confluence_labels: labels.length ? labels : undefined,
    confluence_id: pageId,
    confluence_version: result.version?.number,
    confluence_url: url,
    published_at: new Date().toISOString(),
  };
  const finalText = stringifyDoc(nextMeta, body);
  fs.writeFileSync(abs, finalText);
  recordPublished(pageId, { text: finalText, version: result.version?.number, storage });
  if (name) snapshot(name, finalText, 'publish');
  onProgress({ phase: 'done', message: `Published v${result.version?.number}`, url });
  return { id: pageId, version: result.version?.number, url, attachments: attachments.map((a) => a.filename), labels, warnings };
}

async function uploadAll(cf, pageId, attachments, onProgress) {
  if (!attachments.length) return;
  const existing = new Map((await cf.listAttachments(pageId)).map((a) => [a.title, a.fileSize]));
  let i = 0;
  for (const a of attachments) {
    i++;
    // diagram filenames are content hashed: same name ⇒ same image
    if (existing.has(a.filename) && (a.filename.startsWith('diagram-') || existing.get(a.filename) === a.buffer.length)) continue;
    onProgress({ phase: 'upload', done: i, total: attachments.length, message: a.filename });
    await cf.putAttachment(pageId, a.filename, a.buffer, a.contentType);
  }
}
