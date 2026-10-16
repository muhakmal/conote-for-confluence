// Local web app server — node:http only, no framework.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { ROOT, config, ensureDirs, listSpaces, getActiveSpace, setActiveSpace, getSpaceConfig, ensureAllDirs, addOrUpdateSpace, deleteSpaceConfig } from './config.js';
import { testConfluenceCredentials } from './confluence.js';
import { parseDoc, stringifyDoc } from './frontmatter.js';
import { pull, pullTemplates, readIndex } from './sync.js';
import { listDrafts, listTemplates, createDraft, readDraft, writeDraft, deleteDraft, draftFromPage, safeDraftPath, suggestTemplate, restoreSnapshot } from './drafts.js';
import { listHistory, readSnapshot, listTrash, restoreFromTrash } from './history.js';
import { compareWithRemote, adoptRemote } from './remote.js';
import { movePage } from './move.js';
import { importMarkdown } from './importer.js';
import { searchUsers } from './users.js';
import { publishDraft, PublishConflict, PageGone } from './publish.js';
import { renderDiagram } from './diagrams.js';
import { toStandaloneHtml, mimeOf } from './render.js';
import { ensureAttachment, prefetchAttachments } from './attachments.js';
import { slugify } from './classify.js';

const WEB = path.join(ROOT, 'web');
const VENDOR = {
  'marked.js': 'node_modules/marked/lib/marked.esm.js',
  'purify.js': 'node_modules/dompurify/dist/purify.es.mjs',
  'mermaid.js': 'node_modules/mermaid/dist/mermaid.min.js',
  'turndown.js': 'node_modules/turndown/lib/turndown.browser.es.js',
  'turndown-gfm.js': 'node_modules/turndown-plugin-gfm/lib/turndown-plugin-gfm.browser.es.js',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const SETTINGS_FILE = () => path.join(config.cacheDir, 'settings.json');

function loadSettings() {
  try {
    return { autoFetchMinutes: config.autoFetchMinutes, autoFetchOnStart: true, ...JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) };
  } catch {
    return { autoFetchMinutes: config.autoFetchMinutes, autoFetchOnStart: true };
  }
}

export function startServer({ port = 4777, host = '127.0.0.1' } = {}) {
  ensureAllDirs();
  const lan = !['127.0.0.1', 'localhost', '::1'].includes(host);
  const accessKey = lan ? crypto.randomBytes(12).toString('base64url') : null;
  let settings = loadSettings();
  const clients = new Set();
  let job = null; // single-flight pull/publish
  let lastPull = null;
  let timer = null;
  const pageCache = new Map(); // id → text for search

  const broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  };

  async function runPull(trigger, opts = {}) {
    if (job) return { busy: true, job: job.kind };
    job = { kind: 'pull', trigger };
    broadcast('pull', { phase: 'start', trigger });
    try {
      const summary = await pull({ ...opts, onProgress: (e) => broadcast('pull', e) });
      if (opts.templates || !fs.existsSync(path.join(config.workspaceDir, '_templates'))) await pullTemplates().catch(() => {});
      lastPull = { at: new Date().toISOString(), trigger, ...summary };
      pageCache.clear();
      broadcast('pulled', lastPull);
      return lastPull;
    } catch (e) {
      broadcast('pull', { phase: 'error', message: e.message });
      throw e;
    } finally {
      job = null;
    }
  }

  function schedule() {
    clearInterval(timer);
    if (settings.autoFetchMinutes > 0) {
      timer = setInterval(() => runPull('auto').catch(() => {}), settings.autoFetchMinutes * 60_000);
      timer.unref();
    }
  }

  const send = (res, status, body, headers = {}) => {
    const isBuf = Buffer.isBuffer(body);
    const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(payload);
  };

  const readBody = (req, limit = 60 * 1024 * 1024) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          reject(Object.assign(new Error('Payload too large'), { status: 413 }));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  const readJson = async (req) => {
    const b = await readBody(req);
    try {
      return b.length ? JSON.parse(b.toString('utf8')) : {};
    } catch {
      throw Object.assign(new Error('Invalid JSON body'), { status: 400 });
    }
  };

  const serveFile = (req, res, file, cache = 'no-cache') => {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'Not found');
      const etag = `"${st.size}-${st.mtimeMs}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || mimeOf(file), 'Content-Length': st.size, ETag: etag, 'Cache-Control': cache });
      fs.createReadStream(file).pipe(res);
    });
  };

  const sameOrigin = (origin, host) => {
    try {
      return new URL(origin).host === host;
    } catch {
      return false; // "null" (sandboxed iframes, file://) and garbage
    }
  };

  // one Confluence write or pull at a time
  async function exclusive(kind, fn) {
    if (job) throw Object.assign(new Error(`Busy: ${job.kind} in progress`), { status: 409 });
    job = { kind };
    try {
      return await fn();
    } finally {
      job = null;
    }
  }

  const tree = () => {
    const index = readIndex();
    if (!index) return null;
    const nodes = {};
    for (const n of Object.values(index.nodes)) {
      nodes[n.id] = { id: n.id, t: n.title, p: n.parentId, c: n.children, d: n.docType, l: n.lifecycle, m: n.domain, u: n.updatedAt, s: n.props?.doc_status ? [].concat(n.props.doc_status)[0] : undefined, f: n.path.split(path.sep).join('/'), g: n.labels };
    }
    return { space: index.space, pulledAt: index.pulledAt, rootIds: index.rootIds, nodes };
  };

  const pageText = (id) => {
    if (pageCache.has(id)) return pageCache.get(id);
    const node = readIndex()?.nodes?.[id];
    if (!node) return null;
    const text = fs.readFileSync(path.join(config.workspaceDir, node.path), 'utf8');
    pageCache.set(id, text);
    return text;
  };

  const exportDoc = async (kind, { draft, page }) => {
    let text;
    let baseDir;
    if (draft) {
      text = readDraft(draft);
      baseDir = path.dirname(safeDraftPath(draft));
    } else {
      const node = readIndex()?.nodes?.[page];
      if (!node) throw Object.assign(new Error('Page not found'), { status: 404 });
      text = pageText(page);
      baseDir = path.join(config.workspaceDir, path.dirname(node.path));
    }
    const { meta, body } = parseDoc(text);
    await prefetchAttachments(body);
    const base = slugify(meta.title || 'document', 80);
    if (kind === 'docx') {
      const { toDocx } = await import('./docx.js'); // heavy: load on first Word export only
      return { buffer: await toDocx(meta, body, { baseDir }), filename: `${base}.docx`, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    }
    const html = await toStandaloneHtml(meta, body, { baseDir });
    return { buffer: Buffer.from(html), filename: `${base}.html`, type: 'text/html; charset=utf-8' };
  };

  const server = http.createServer(async (req, res) => {
    let url;
    let p;
    try {
      url = new URL(req.url, 'http://local');
      p = decodeURIComponent(url.pathname);
    } catch {
      return send(res, 400, 'Bad request');
    }
    try {
      // LAN access guard
      if (accessKey) {
        const cookieKey = /(?:^|;\s*)cn_key=([^;]+)/.exec(req.headers.cookie || '')?.[1];
        if (url.searchParams.get('key') === accessKey) {
          res.setHeader('Set-Cookie', `cn_key=${accessKey}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
        } else if (cookieKey !== accessKey) {
          return send(res, 401, 'Access key required. Open the URL printed in the terminal.');
        }
      }
      // DNS-rebinding guard: loopback mode only answers to loopback host names
      if (!lan && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '')) {
        return send(res, 403, 'Forbidden host');
      }
      // Cross-site request guard for state-changing calls
      if (req.method !== 'GET' && req.headers.origin && !sameOrigin(req.headers.origin, req.headers.host)) {
        return send(res, 403, { error: 'Cross-origin request blocked' });
      }

      if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveFile(req, res, path.join(WEB, 'index.html'));
      if (req.method === 'GET' && p.startsWith('/vendor/')) {
        const f = VENDOR[p.slice(8)];
        return f ? serveFile(req, res, path.join(ROOT, f), 'public, max-age=86400') : send(res, 404, 'Not found');
      }
      if (req.method === 'GET' && p.startsWith('/att/')) {
        const [, , pageId, ...rest] = p.split('/');
        const file = await ensureAttachment(pageId, rest.join('/'));
        return serveFile(req, res, file, 'private, max-age=86400');
      }
      if (req.method === 'GET' && p.startsWith('/draft-file/')) {
        const rel = p.slice('/draft-file/'.length);
        const abs = path.resolve(config.draftsDir, rel);
        if (!abs.startsWith(config.draftsDir + path.sep)) return send(res, 403, 'Forbidden');
        return serveFile(req, res, abs);
      }

      if (p.startsWith('/api/')) return await api(req, res, url, p.slice(5));

      if (req.method === 'GET') {
        const abs = path.resolve(WEB, '.' + p);
        if (!abs.startsWith(WEB + path.sep)) return send(res, 403, 'Forbidden');
        if (fs.existsSync(abs)) return serveFile(req, res, abs);
        return serveFile(req, res, path.join(WEB, 'index.html')); // SPA fallback
      }
      send(res, 404, { error: 'Not found' });
    } catch (e) {
      const status = e instanceof PublishConflict || e instanceof PageGone ? 409 : e.code === 'INVALID_STORAGE' ? 422 : e.status && e.status < 600 ? e.status : 500;
      if (!res.headersSent) send(res, status, { error: e.message, code: e.code, remoteVersion: e.remoteVersion, localVersion: e.localVersion });
      else res.end();
    }
  });

  async function api(req, res, url, route) {
    const m = req.method;
    const q = url.searchParams;
    const reqSpace = q.get('space') || req.headers['x-space'];
    if (reqSpace && reqSpace !== getActiveSpace()) {
      try {
        setActiveSpace(reqSpace, { persist: false });
        pageCache.clear();
      } catch {}
    }

    if (m === 'GET' && route === 'status') {
      const activeId = getActiveSpace();
      const curConf = getSpaceConfig(activeId);
      const index = readIndex();
      return send(res, 200, {
        activeSpace: activeId,
        spaces: listSpaces(),
        space: index?.space || { key: config.spaceKey, name: curConf.name },
        baseUrl: config.baseUrl,
        email: config.email,
        pulledAt: index?.pulledAt,
        pages: index ? Object.keys(index.nodes).length : 0,
        busy: job?.kind || null,
        lastPull,
        settings,
        lan,
      });
    }
    if (m === 'POST' && route === 'test-connection') {
      const body = await readJson(req);
      try {
        const result = await testConfluenceCredentials(body);
        return send(res, 200, result);
      } catch (err) {
        return send(res, 400, { ok: false, error: err.message });
      }
    }
    if (m === 'GET' && route === 'spaces') {
      return send(res, 200, {
        active: getActiveSpace(),
        spaces: listSpaces(),
      });
    }
    if (m === 'POST' && route === 'spaces') {
      const body = await readJson(req);
      try {
        const created = addOrUpdateSpace(body);
        pageCache.clear();
        settings = loadSettings();
        schedule();
        broadcast('space-changed', { active: getActiveSpace(), space: created });
        return send(res, 200, {
          ok: true,
          space: created,
          active: getActiveSpace(),
          spaces: listSpaces(),
        });
      } catch (err) {
        return send(res, 400, { error: err.message });
      }
    }
    if (m === 'DELETE' && route.startsWith('spaces/')) {
      const id = route.slice('spaces/'.length);
      try {
        const result = deleteSpaceConfig(id);
        pageCache.clear();
        settings = loadSettings();
        schedule();
        broadcast('space-changed', { active: result.active, space: getSpaceConfig(result.active) });
        return send(res, 200, {
          ok: true,
          ...result,
        });
      } catch (err) {
        return send(res, 400, { error: err.message });
      }
    }
    if (m === 'POST' && (route === 'spaces/active' || route === 'spaces/switch')) {
      const body = await readJson(req);
      const target = body.space || body.id;
      try {
        const switched = setActiveSpace(target);
        ensureDirs(switched);
        pageCache.clear();
        settings = loadSettings();
        schedule();
        broadcast('space-changed', { active: switched, space: getSpaceConfig(switched) });
        const index = readIndex();
        return send(res, 200, {
          ok: true,
          active: switched,
          space: index?.space || { key: config.spaceKey, name: getSpaceConfig(switched).name },
          pages: index ? Object.keys(index.nodes).length : 0,
          pulledAt: index?.pulledAt,
        });
      } catch (err) {
        return send(res, 400, { error: err.message });
      }
    }
    if (m === 'GET' && route === 'events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`event: hello\ndata: {}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }
    if (m === 'GET' && route === 'tree') return send(res, 200, tree() || { empty: true });
    if (m === 'POST' && route === 'pull') {
      const body = await readJson(req);
      const r = runPull('manual', { full: !!body.full, reconvert: !!body.reconvert, templates: true });
      r.catch(() => {});
      return send(res, 202, { started: true });
    }
    if (route === 'settings') {
      if (m === 'PUT') {
        const body = await readJson(req);
        settings = {
          autoFetchMinutes: Math.max(0, Math.min(24 * 60, Number(body.autoFetchMinutes) || 0)),
          autoFetchOnStart: !!body.autoFetchOnStart,
        };
        fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
        schedule();
      }
      return send(res, 200, settings);
    }

    let mm;
    if (m === 'GET' && (mm = route.match(/^page\/(\d+)$/))) {
      const text = pageText(mm[1]);
      if (text == null) return send(res, 404, { error: 'Page not found — pull first' });
      const { meta, body } = parseDoc(text);
      return send(res, 200, { id: mm[1], meta, body });
    }
    if (m === 'POST' && (mm = route.match(/^page\/(\d+)\/draft$/))) return send(res, 201, { name: draftFromPage(mm[1]) });

    if (m === 'GET' && route === 'search') {
      const term = (q.get('q') || '').trim().toLowerCase();
      if (term.length < 2) return send(res, 200, { results: [] });
      const index = readIndex();
      const results = [];
      for (const n of Object.values(index?.nodes || {})) {
        const titleHit = n.title.toLowerCase().includes(term);
        let snippet = null;
        if (!titleHit) {
          const text = pageText(n.id) || '';
          const i = text.toLowerCase().indexOf(term);
          if (i < 0) continue;
          snippet = text.slice(Math.max(0, i - 60), i + term.length + 80).replace(/\s+/g, ' ');
        }
        results.push({ id: n.id, title: n.title, docType: n.docType, lifecycle: n.lifecycle, domain: n.domain, titleHit, snippet });
        if (results.length >= 60) break;
      }
      results.sort((a, b) => b.titleHit - a.titleHit);
      return send(res, 200, { results });
    }

    if (m === 'GET' && route === 'users') return send(res, 200, await searchUsers(q.get('q') || ''));
    if (m === 'GET' && route === 'templates') {
      const parent = q.get('parent');
      return send(res, 200, { templates: listTemplates(), suggested: suggestTemplate(parent || readIndex()?.space?.homeId) });
    }
    if (m === 'POST' && route === 'import') {
      const { files = [], parentId, keepNumbers } = await readJson(req);
      const assets = new Map();
      const docs = [];
      for (const f of files) {
        const buf = Buffer.from(String(f.data || ''), 'base64');
        if (/\.(md|markdown|mdx|txt|html?)$/i.test(f.name)) docs.push({ name: f.name, text: buf.toString('utf8') });
        else assets.set(f.name.split('/').pop(), buf), assets.set(f.name, buf);
      }
      if (!docs.length) return send(res, 400, { error: 'No Markdown or HTML file in the upload' });
      const results = docs.map((d) => importMarkdown({ filename: d.name, text: d.text, parentId, assets, stripNumbers: !keepNumbers }));
      return send(res, 201, { results });
    }
    if (m === 'GET' && route === 'drafts') return send(res, 200, listDrafts());
    if (m === 'POST' && route === 'drafts') return send(res, 201, { name: createDraft(await readJson(req)) });
    if ((mm = route.match(/^drafts\/(.+\.md)$/))) {
      const name = mm[1];
      if (m === 'GET') {
        const text = readDraft(name);
        return send(res, 200, { name, text, ...parseDoc(text) });
      }
      if (m === 'PUT') {
        const raw = (await readBody(req)).toString('utf8');
        if (/json/.test(req.headers['content-type'] || '')) {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            return send(res, 400, { error: 'Invalid JSON body' });
          }
          const { meta, body } = parsed;
          writeDraft(name, stringifyDoc(meta || {}, body || ''));
        } else writeDraft(name, raw);
        return send(res, 200, { saved: true, at: new Date().toISOString() });
      }
      if (m === 'DELETE') {
        const trashId = deleteDraft(name);
        return send(res, 200, { deleted: true, trashId });
      }
    }
    if (m === 'GET' && route === 'history') {
      const draft = q.get('draft') || '';
      safeDraftPath(draft);
      const id = q.get('id');
      if (id) return send(res, 200, { id, text: readSnapshot(draft, id) });
      return send(res, 200, { history: listHistory(draft) });
    }
    if (m === 'POST' && route === 'history/restore') {
      const { draft, id } = await readJson(req);
      restoreSnapshot(String(draft || ''), String(id || ''));
      return send(res, 200, { restored: true });
    }
    if (m === 'GET' && route === 'trash') return send(res, 200, { trash: listTrash() });
    if (m === 'POST' && route === 'trash/restore') {
      const { id } = await readJson(req);
      return send(res, 200, { name: restoreFromTrash(String(id || ''), safeDraftPath) });
    }
    if (m === 'GET' && route === 'remote-diff') return send(res, 200, await compareWithRemote(q.get('draft') || ''));
    if (m === 'POST' && route === 'adopt-remote') {
      const { draft } = await readJson(req);
      return send(res, 200, await exclusive('pull', () => adoptRemote(String(draft || ''))));
    }
    if (m === 'POST' && route === 'move') {
      const { id, position, targetId } = await readJson(req);
      const result = await exclusive('move', () => movePage(String(id), String(position), String(targetId)));
      broadcast('moved', result);
      // refresh workspace paths in the background; the tree is already updated
      runPull('move').catch(() => {});
      return send(res, 200, result);
    }
    if (m === 'POST' && route === 'assets') {
      const original = String(q.get('name') || 'image.png');
      const ext = (path.extname(original) || '.png').toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf'].includes(ext)) return send(res, 400, { error: 'Unsupported file type' });
      const dir = path.join(config.draftsDir, 'assets');
      fs.mkdirSync(dir, { recursive: true });
      const name = `${slugify(path.basename(original, ext), 40)}-${Date.now().toString(36)}${ext}`;
      fs.writeFileSync(path.join(dir, name), await readBody(req));
      return send(res, 201, { path: `assets/${name}` });
    }
    if (m === 'POST' && (mm = route.match(/^publish\/(.+\.md)$/))) {
      const body = await readJson(req);
      const result = await exclusive('publish', async () => {
        await prefetchAttachments(parseDoc(readDraft(mm[1])).body);
        return publishDraft(mm[1], { force: !!body.force, asNew: !!body.asNew, message: body.message, onProgress: (e) => broadcast('publish', { name: mm[1], ...e }) });
      });
      return send(res, 200, result);
    }
    if (m === 'POST' && route === 'render/plantuml') {
      const { code } = await readJson(req);
      const d = await renderDiagram('plantuml', String(code || ''));
      return send(res, 200, d.svg, { 'Content-Type': 'image/svg+xml' });
    }
    if (m === 'GET' && (mm = route.match(/^export\/(docx|html)$/))) {
      const out = await exportDoc(mm[1], { draft: q.get('draft'), page: q.get('page') });
      const disposition = q.get('inline') === '1' && mm[1] === 'html' ? 'inline' : 'attachment';
      return send(res, 200, out.buffer, { 'Content-Type': out.type, 'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(out.filename)}` });
    }
    send(res, 404, { error: `Unknown API route ${m} /api/${route}` });
  }

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      schedule();
      if (settings.autoFetchOnStart && readIndex()) runPull('startup').catch(() => {});
      const urls = [];
      if (lan) {
        for (const ifs of Object.values(os.networkInterfaces())) {
          for (const i of ifs || []) if (i.family === 'IPv4' && !i.internal) urls.push(`http://${i.address}:${port}/?key=${accessKey}`);
        }
      }
      urls.unshift(`http://${lan ? 'localhost' : host}:${port}/${accessKey ? `?key=${accessKey}` : ''}`);
      resolve({ server, urls, runPull });
    });
  });
}
