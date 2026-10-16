import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { parseDoc, stringifyDoc } from './frontmatter.js';
import { slugify } from './classify.js';
import { readIndex } from './sync.js';
import { stripLeadingTitle } from './render.js';
import { SERVER_KEYS, snapshot, contentHash, moveToTrash, publishedRecord, recordPublished, readSnapshot } from './history.js';

export const draftName = (abs) => path.relative(config.draftsDir, abs).split(path.sep).join('/');

export function safeDraftPath(name) {
  const clean = String(name).replace(/\\/g, '/');
  const bad = () => Object.assign(new Error('Invalid draft name'), { status: 400 });
  if (!clean.endsWith('.md') || clean.split('/').some((p) => p === '..' || p.startsWith('.'))) throw bad();
  const abs = path.resolve(config.draftsDir, clean);
  if (!abs.startsWith(config.draftsDir + path.sep)) throw bad();
  return abs;
}

export function listDrafts() {
  if (!fs.existsSync(config.draftsDir)) return [];
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.md')) {
        const st = fs.statSync(abs);
        const text = fs.readFileSync(abs, 'utf8');
        const { meta } = parseDoc(text);
        out.push({
          name: path.relative(config.draftsDir, abs).split(path.sep).join('/'),
          title: meta.title || e.name,
          doc_status: meta.doc_status,
          confluence_id: meta.confluence_id,
          confluence_url: meta.confluence_url,
          published_at: meta.published_at,
          modified: st.mtime.toISOString(),
          dirty: isDirty(meta, text, st),
        });
      }
    }
  };
  walk(config.draftsDir);
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}

/** Changed since the last publish? Compares content hashes; falls back to file time for older drafts. */
function isDirty(meta, text, st) {
  if (!meta.confluence_id) return true;
  const rec = publishedRecord(meta.confluence_id);
  if (rec && Number(rec.version) === Number(meta.confluence_version)) return rec.hash !== contentHash(text);
  return meta.published_at ? st.mtime.getTime() - new Date(meta.published_at).getTime() > 3000 : true;
}

export function listTemplates() {
  const out = [];
  for (const [dir, source] of [[config.templatesDir, 'local'], [path.join(config.workspaceDir, '_templates'), 'confluence']]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const { meta } = parseDoc(fs.readFileSync(path.join(dir, f), 'utf8'));
      out.push({ id: `${source}:${f}`, name: meta.template || f.replace(/\.md$/, ''), description: meta.description || '', source });
    }
  }
  return out;
}

function templateFile(id) {
  const [source, f] = String(id).split(':');
  if (!f || f.includes('/') || f.includes('..')) throw new Error('Invalid template');
  return path.join(source === 'confluence' ? path.join(config.workspaceDir, '_templates') : config.templatesDir, f);
}

/**
 * Create a new draft from a template (or blank).
 * @param {{ title: string, template?: string, parentId?: string, owner?: string, tribe?: string }} opts
 */
export function createDraft({ title, template = 'local:prd.md', parentId, owner, tribe }) {
  if (!title?.trim()) throw new Error('Title is required');
  const index = readIndex();
  const parent = parentId ? index?.nodes?.[parentId] : null;
  const vars = {
    title: title.trim(),
    parent_id: parentId || '',
    owner: owner || '',
    tribe: tribe || '',
    date: new Date().toLocaleDateString('sv-SE'),
    base_url: '{{base_url}}',
  };
  let text = '';
  if (template && template !== 'blank') {
    text = fs.readFileSync(templateFile(template), 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
  }
  let { meta, body } = parseDoc(text);
  delete meta.template;
  delete meta.description;
  const fields = meta.fields;
  delete meta.fields;
  delete meta.confluence_template_id;
  if (fields && typeof fields === 'object') {
    // Confluence template: turn option lists into first choice
    for (const [k, v] of Object.entries(fields)) if (!meta[k]) meta[k] = Array.isArray(v) ? (k === 'doc_status' ? v[0] : '') : '';
  }
  if (!meta.title || /\{\{/.test(meta.title)) meta.title = titleWithPrefix(title.trim(), template);
  if (parentId) meta.parent_id = parentId;
  if (parent) meta.parent = parent.title;
  if (owner && (!meta.owner || /\{\{|@ ?mention/i.test(String(meta.owner)))) meta.owner = owner;
  if (tribe && !meta.tribe) meta.tribe = tribe;
  body = body.replace(/^\s*#\s+.*\n+/, (m) => (m.includes('{{') || /^\s*#\s+\[?PRD/i.test(m) ? '' : m));
  if (!body.trim()) body = '\n';
  for (const k of Object.keys(meta)) if (meta[k] === '') delete meta[k];
  meta.doc_status ||= 'DRAFT';

  return writeNewDraft(meta, body, title, parentId);
}

/** Pick a non-colliding path under drafts/<domain>/ for a new document. */
export function newDraftPath(title, parentId) {
  const parent = parentId ? readIndex()?.nodes?.[parentId] : null;
  const domain = parent ? slugify(parent.domain || parent.title, 40) : '';
  const dir = domain ? path.join(config.draftsDir, domain) : config.draftsDir;
  fs.mkdirSync(dir, { recursive: true });
  const base = slugify(String(title).replace(/^\[(PRD|TAD)\]\s*/i, ''), 60);
  let name = `${base}.md`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${base}-${i}.md`;
  return path.join(dir, name);
}

export function writeNewDraft(meta, body, title, parentId) {
  const abs = newDraftPath(title, parentId);
  fs.writeFileSync(abs, stringifyDoc(meta, body));
  return path.relative(config.draftsDir, abs).split(path.sep).join('/');
}

const TEMPLATE_PREFIX = [
  [/tad/i, '[TAD] '],
  [/prd|requirement/i, '[PRD] '],
  [/product-release/i, '[Product Release] '],
];
function titleWithPrefix(title, template) {
  const hit = TEMPLATE_PREFIX.find(([re]) => re.test(template || ''));
  if (!hit) return title;
  const word = hit[1].replace(/[[\]\s]/g, '').toLowerCase();
  if (title.replace(/[[\]\s-]/g, '').toLowerCase().startsWith(word)) return title;
  return hit[1] + title;
}

/** Template that matches where the page will live in the space. */
export function suggestTemplate(parentId) {
  const index = readIndex();
  const chain = [];
  for (let n = index?.nodes?.[parentId]; n; n = index.nodes[n.parentId]) chain.unshift(n.title);
  const where = chain.join(' / ');
  const have = new Set(listTemplates().map((t) => t.id));
  const pick = (...ids) => ids.find((id) => have.has(id)) || 'local:prd.md';
  if (/(^| \/ )TAD\b|\[TAD\]/.test(where)) return pick('confluence:fm-tad-template.md');
  if (/Deployment - Checklist/.test(where)) return pick('confluence:document-deployment.md');
  if (/Release Document/.test(where)) return pick('confluence:product-release-template.md');
  return pick('confluence:product-requirement-template.md', 'local:prd.md');
}

export function readDraft(name) {
  const abs = safeDraftPath(name);
  if (!fs.existsSync(abs)) throw Object.assign(new Error('Draft not found'), { status: 404 });
  return fs.readFileSync(abs, 'utf8');
}

/**
 * Save a draft from an editor. The previous content goes to history (throttled), and the publish
 * bookkeeping fields (confluence_id, confluence_version, …) always come from the file on disk:
 * only publish may change them, so a stale editor tab can never unlink a draft from its page.
 */
export function writeDraft(name, text, { reason = 'save', create = false } = {}) {
  const abs = safeDraftPath(name);
  // an open editor tab must not bring back a draft that was deleted elsewhere
  if (!create && !fs.existsSync(abs)) throw Object.assign(new Error('Draft not found (it was deleted or moved)'), { status: 404 });
  let next = text;
  if (fs.existsSync(abs)) {
    const current = fs.readFileSync(abs, 'utf8');
    if (current === text) return;
    const disk = parseDoc(current).meta;
    const { meta, body } = parseDoc(text);
    for (const k of SERVER_KEYS) {
      if (disk[k] !== undefined) meta[k] = disk[k];
      else delete meta[k];
    }
    next = stringifyDoc(meta, body);
    if (next === current) return;
    snapshot(name, current, reason);
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, next);
}

/** Replace a draft with one of its snapshots (the current content is kept in history first). */
export function restoreSnapshot(name, id) {
  const abs = safeDraftPath(name);
  const text = readSnapshot(name, id);
  if (fs.existsSync(abs)) snapshot(name, fs.readFileSync(abs, 'utf8'), 'restore');
  writeDraft(name, text, { reason: 'restore', create: true });
}

export function deleteDraft(name) {
  const abs = safeDraftPath(name);
  if (!fs.existsSync(abs)) throw Object.assign(new Error('Draft not found'), { status: 404 });
  return moveToTrash(name, abs);
}

/** Copy a pulled page into drafts so it can be edited and republished. */
export function draftFromPage(pageId) {
  const index = readIndex();
  const node = index?.nodes?.[pageId];
  if (!node) throw new Error('Page not found in index');
  const { meta, body } = parseDoc(fs.readFileSync(path.join(config.workspaceDir, node.path), 'utf8'));
  const next = {
    title: meta.title,
    parent_id: node.parentId,
    parent: meta.parent,
    tribe: meta.tribe,
    target_release: meta.target_release,
    epic: meta.epic,
    doc_status: meta.doc_status,
    owner: meta.owner,
    designer: meta.designer,
    tech_lead: meta.tech_lead,
    qa: meta.qa,
    labels: meta.labels,
    confluence_labels: meta.labels,
    confluence_id: node.id,
    confluence_version: node.version,
    confluence_url: meta.url,
    published_at: new Date(Date.now() + 5000).toISOString(),
  };
  // attachment links point into the workspace mirror
  const fixed = stripLeadingTitle(body, meta.title).replace(/(\]\(|src=")(?:\.\.\/)*_attachments\//g, '$1_attachments/');
  const dir = path.join(config.draftsDir, slugify(node.domain || 'pages', 40));
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, `${slugify(node.title, 60)}.md`);
  if (fs.existsSync(abs)) return draftName(abs);
  const text = stringifyDoc(next, fixed);
  fs.writeFileSync(abs, text);
  // the draft starts out identical to the live page: remember that as the published baseline
  const cached = path.join(config.cacheDir, 'storage', `${node.id}.xml`);
  recordPublished(node.id, { text, version: node.version, storage: fs.existsSync(cached) ? fs.readFileSync(cached, 'utf8') : null });
  return draftName(abs);
}
