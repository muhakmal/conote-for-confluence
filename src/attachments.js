// Lazy attachment mirror: workspace/_attachments/<pageId>/<file>, downloaded on first use.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { Confluence } from './confluence.js';

let cf;
const inflight = new Map();

export function attachmentPath(pageId, filename) {
  if (!/^\d+$/.test(pageId) || filename.includes('/') || filename.includes('\\') || filename.startsWith('.')) {
    throw Object.assign(new Error('Invalid attachment reference'), { status: 400 });
  }
  return path.join(config.workspaceDir, '_attachments', pageId, filename);
}

export async function ensureAttachment(pageId, filename) {
  const file = attachmentPath(pageId, filename);
  if (fs.existsSync(file)) return file;
  if (inflight.has(file)) return inflight.get(file);
  const job = (async () => {
    cf ||= new Confluence();
    const { buffer } = await cf.downloadAttachment(pageId, filename);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
    return file;
  })().finally(() => inflight.delete(file));
  inflight.set(file, job);
  return job;
}

/** Download every workspace attachment referenced by a Markdown body (best effort). */
export async function prefetchAttachments(body) {
  const refs = [...body.matchAll(/_attachments\/(\d+)\/([^)\s"'>]+)/g)];
  await Promise.all(
    refs.map(([, id, file]) => ensureAttachment(id, decodeURIComponent(file)).catch(() => null)),
  );
}
