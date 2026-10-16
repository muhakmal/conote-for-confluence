// One-way pull: Confluence space → workspace/ (Markdown tree + _index.json).
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs } from './config.js';
import { Confluence } from './confluence.js';
import { storageToMarkdown } from './storage2md.js';
import { stringifyDoc } from './frontmatter.js';
import { slugify, docTypeOf, lifecycleOf, domainOf } from './classify.js';

const INDEX_FILE = () => path.join(config.workspaceDir, '_index.json');
const STORAGE_CACHE = () => path.join(config.cacheDir, 'storage');
const USERS_FILE = () => path.join(config.cacheDir, 'users.json');

export function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE(), 'utf8'));
  } catch {
    return null;
  }
}

export function writeIndex(index) {
  fs.writeFileSync(INDEX_FILE(), JSON.stringify(index));
}

async function pool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function readJson(file, def) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return def;
  }
}

/**
 * @param {{ full?: boolean, reconvert?: boolean, onProgress?: (e:object)=>void }} opts
 */
export async function pull({ full = false, reconvert = false, onProgress = () => {} } = {}) {
  ensureDirs();
  fs.mkdirSync(STORAGE_CACHE(), { recursive: true });
  const cf = new Confluence();
  const started = Date.now();
  const prev = full ? null : readIndex();

  onProgress({ phase: 'list', message: `Listing pages in space ${config.spaceKey}…` });
  const space = await cf.getSpace();
  const pages = await cf.listPages(space.id);

  // Build node map (pages + folders referenced as parents)
  const nodes = {};
  for (const p of pages) {
    nodes[p.id] = {
      id: p.id,
      type: 'page',
      title: p.title,
      parentId: p.parentId || null,
      position: p.position ?? 0,
      version: p.version?.number,
      updatedAt: p.version?.createdAt,
      createdAt: p.createdAt,
    };
  }
  // Folders aren't listed with pages: fetch every folder referenced as a parent, walking up
  // through folders nested in folders.
  let missing = [...new Set(pages.filter((p) => p.parentType === 'folder' && !nodes[p.parentId]).map((p) => p.parentId))];
  for (let depth = 0; missing.length && depth < 20; depth++) {
    const next = [];
    for (const fid of missing) {
      try {
        const f = await cf.getFolder(fid);
        nodes[fid] = { id: fid, type: 'folder', title: f.title, parentId: f.parentId || null, position: f.position ?? 0 };
        if (f.parentType === 'folder' && f.parentId && !nodes[f.parentId]) next.push(f.parentId);
      } catch {
        nodes[fid] = { id: fid, type: 'folder', title: `Folder ${fid}`, parentId: null, position: 0 };
      }
    }
    missing = [...new Set(next)];
  }
  const homeId = space.homepageId;
  for (const n of Object.values(nodes)) {
    if (n.parentId && !nodes[n.parentId]) n.parentId = n.id === homeId ? null : homeId;
    if (!n.parentId && n.id !== homeId && nodes[homeId]) n.parentId = homeId;
    n.children = [];
  }
  for (const n of Object.values(nodes)) if (n.parentId) nodes[n.parentId].children.push(n.id);
  for (const n of Object.values(nodes)) n.children.sort((a, b) => (nodes[a].position - nodes[b].position) || nodes[a].title.localeCompare(nodes[b].title));

  // Paths + classification
  const assign = (id, dir, ancestors) => {
    const n = nodes[id];
    const hasKids = n.children.length > 0;
    const slug = id === homeId ? '' : n._slug;
    const myDir = slug ? path.join(dir, slug) : dir;
    n.path = hasKids || id === homeId ? path.join(myDir, 'README.md') : path.join(dir, `${slug}.md`);
    n.docType = id === homeId ? 'home' : n.type === 'folder' ? 'folder' : docTypeOf(n.title, ancestors);
    n.lifecycle = lifecycleOf(ancestors, n.title);
    n.domain = domainOf(ancestors);
    const used = new Set();
    for (const cid of n.children) {
      const c = nodes[cid];
      let s = slugify(c.title.replace(/^\[PRD\]\s*|^PRD\s*[-–]\s*/i, 'prd-'));
      if (used.has(s)) s = `${s}-${c.id}`;
      used.add(s);
      c._slug = s;
    }
    for (const cid of n.children) assign(cid, myDir, [...ancestors, n]);
  };
  const roots = Object.values(nodes).filter((n) => !n.parentId).map((n) => n.id);
  for (const r of roots) {
    if (r !== homeId) nodes[r]._slug = slugify(nodes[r].title);
    assign(r, '', []);
  }
  for (const n of Object.values(nodes)) delete n._slug;

  // Decide what to (re)fetch
  const toFetch = Object.values(nodes).filter((n) => {
    if (n.type !== 'page') return false;
    const old = prev?.nodes?.[n.id];
    const cached = fs.existsSync(path.join(STORAGE_CACHE(), `${n.id}.xml`));
    return !old || old.version !== n.version || !cached;
  });
  const toConvert = reconvert || !prev ? Object.values(nodes).filter((n) => n.type === 'page') : [
    ...toFetch,
    ...Object.values(nodes).filter((n) => n.type === 'page' && prev.nodes[n.id] && prev.nodes[n.id].path !== n.path),
  ];

  let done = 0;
  onProgress({ phase: 'fetch', done, total: toFetch.length, message: `${toFetch.length} of ${pages.length} pages changed` });
  await pool(toFetch, 8, async (n) => {
    const page = await cf.getPage(n.id);
    fs.writeFileSync(path.join(STORAGE_CACHE(), `${n.id}.xml`), page.body?.storage?.value || '');
    n.authorId = page.version?.authorId;
    done++;
    onProgress({ phase: 'fetch', done, total: toFetch.length, message: n.title });
  });

  // Labels: one CQL search for every labelled page in the space (labels don't bump page versions)
  const labelsById = new Map();
  try {
    onProgress({ phase: 'labels', message: 'Reading labels…' });
    let next = `/rest/api/content/search?cql=${encodeURIComponent(`space="${config.spaceKey}" and type=page and label is not null`)}&expand=metadata.labels&limit=100`;
    while (next) {
      const j = await cf.request(next);
      for (const r of j.results || []) labelsById.set(r.id, (r.metadata?.labels?.results || []).map((l) => l.name));
      next = j._links?.next ? j._links.next : null;
    }
  } catch {}
  for (const n of Object.values(nodes)) {
    const l = labelsById.get(n.id);
    if (l?.length) n.labels = l;
    if (JSON.stringify(prev?.nodes?.[n.id]?.labels || []) !== JSON.stringify(n.labels || []) && n.type === 'page') toConvert.push(n);
  }

  // Resolve user mentions once, persisted across pulls
  const users = readJson(USERS_FILE(), {});
  const convertSet = new Map(toConvert.map((n) => [n.id, n]));
  const unknown = new Set();
  for (const n of convertSet.values()) {
    const xml = fs.readFileSync(path.join(STORAGE_CACHE(), `${n.id}.xml`), 'utf8');
    for (const m of xml.matchAll(/ri:account-id="([^"]+)"/g)) if (!users[m[1]]) unknown.add(m[1]);
  }
  if (unknown.size) {
    onProgress({ phase: 'users', message: `Resolving ${unknown.size} people…` });
    await pool([...unknown], 6, async (id) => {
      users[id] = await cf.getUserName(id);
    });
    fs.writeFileSync(USERS_FILE(), JSON.stringify(users, null, 1));
  }

  // Convert + write
  const byTitle = new Map(Object.values(nodes).map((n) => [n.title, n]));
  const workspace = config.workspaceDir;
  done = 0;
  for (const n of convertSet.values()) {
    const xml = fs.readFileSync(path.join(STORAGE_CACHE(), `${n.id}.xml`), 'utf8');
    const fileDir = path.dirname(n.path);
    const rel = (target) => path.relative(fileDir, target).split(path.sep).join('/') || '.';
    const { markdown, meta } = storageToMarkdown(xml, {
      pageId: n.id,
      userName: (id) => users[id] || id,
      pageLink: (title) => (byTitle.get(title) ? rel(byTitle.get(title).path) : null),
      attachmentUrl: (pid, file) => `${rel(`_attachments/${pid}`)}/${encodeURIComponent(file)}`,
    });
    const parent = n.parentId ? nodes[n.parentId] : null;
    const front = {
      title: n.title,
      confluence_id: n.id,
      url: cf.webUrl(n.id),
      version: n.version,
      updated: n.updatedAt,
      doc_type: n.docType,
      domain: n.domain,
      lifecycle: n.lifecycle,
      parent: parent?.title,
      labels: n.labels,
      ...meta,
      source: 'confluence (read-only mirror)',
    };
    n.props = meta;
    const out = path.join(workspace, n.path);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, stringifyDoc(front, `# ${n.title}\n\n${markdown}`));
    done++;
    if (done % 25 === 0 || done === convertSet.size) onProgress({ phase: 'convert', done, total: convertSet.size, message: n.title });
  }
  // Keep props for pages that weren't reconverted
  for (const n of Object.values(nodes)) if (!n.props && prev?.nodes?.[n.id]?.props) n.props = prev.nodes[n.id].props;

  // Folder placeholders
  for (const n of Object.values(nodes).filter((x) => x.type === 'folder')) {
    const out = path.join(workspace, n.path);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, stringifyDoc({ title: n.title, confluence_id: n.id, doc_type: 'folder' }, `# ${n.title}\n`));
  }

  // Remove files for deleted or moved pages
  let removed = 0;
  if (prev?.nodes) {
    for (const old of Object.values(prev.nodes)) {
      const now = nodes[old.id];
      if (!now || now.path !== old.path) {
        const f = path.join(workspace, old.path);
        if (fs.existsSync(f) && !Object.values(nodes).some((x) => x.path === old.path)) {
          fs.rmSync(f);
          removed++;
          pruneEmptyDirs(path.dirname(f), workspace);
        }
      }
    }
  }

  const index = {
    space: { id: space.id, key: space.key, name: space.name, homeId },
    baseUrl: config.baseUrl,
    pulledAt: new Date().toISOString(),
    rootIds: roots,
    nodes,
  };
  writeIndex(index);
  writeOverview(index);

  const summary = {
    pages: pages.length,
    fetched: toFetch.length,
    converted: convertSet.size,
    removed,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
  onProgress({ phase: 'done', ...summary, message: `Pulled ${summary.fetched} changed pages in ${summary.seconds}s` });
  return summary;
}

function pruneEmptyDirs(dir, stopAt) {
  while (dir.startsWith(stopAt) && dir !== stopAt && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
    dir = path.dirname(dir);
  }
}

/** workspace/_OVERVIEW.md — a human map of the space, regenerated each pull. */
function writeOverview(index) {
  const nodes = Object.values(index.nodes);
  const count = (pred) => nodes.filter(pred).length;
  const types = {};
  for (const n of nodes) types[n.docType] = (types[n.docType] || 0) + 1;
  const prds = nodes.filter((n) => n.docType === 'prd' && n.lifecycle !== 'archived');
  const byDomain = {};
  for (const p of prds) {
    const k = p.domain || 'Other';
    byDomain[k] ||= { backlog: 0, development: 0, released: 0, other: 0 };
    byDomain[k][p.lifecycle || 'other']++;
  }
  const recent = [...prds].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 15);
  const lines = [
    `# ${index.space.name} (${index.space.key}) — workspace overview`,
    '',
    `Pulled ${index.pulledAt}. Read-only mirror; write new PRDs in \`drafts/\`.`,
    '',
    '| Doc type | Count |',
    '| --- | --- |',
    ...Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    `## Active PRDs by domain (${prds.length}, excluding archive: ${count((n) => n.lifecycle === 'archived')} archived pages)`,
    '',
    '| Domain | Backlog | Development | Released | Unsorted |',
    '| --- | --- | --- | --- | --- |',
    ...Object.entries(byDomain).map(([d, c]) => `| ${d} | ${c.backlog} | ${c.development} | ${c.released} | ${c.other} |`),
    '',
    '## Recently updated PRDs',
    '',
    ...recent.map((p) => `- [${p.title}](${p.path.split(path.sep).join('/')}) — ${String(p.updatedAt).slice(0, 10)}${p.props?.doc_status ? ` · ${[].concat(p.props.doc_status).join(', ')}` : ''}`),
    '',
  ];
  fs.writeFileSync(path.join(config.workspaceDir, '_OVERVIEW.md'), lines.join('\n'));
}

export async function pullTemplates({ onProgress = () => {} } = {}) {
  ensureDirs();
  const cf = new Confluence();
  const dir = path.join(config.workspaceDir, '_templates');
  fs.mkdirSync(dir, { recursive: true });
  const templates = await cf.getTemplates();
  const users = readJson(USERS_FILE(), {});
  for (const t of templates) {
    const { markdown, meta } = storageToMarkdown(t.storage, { userName: (id) => users[id] || id });
    fs.writeFileSync(
      path.join(dir, `${slugify(t.name)}.md`),
      stringifyDoc({ template: t.name, confluence_template_id: t.id, description: t.description, fields: meta }, markdown),
    );
    onProgress({ phase: 'template', message: t.name });
  }
  return templates.map((t) => t.name);
}
