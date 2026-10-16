// In-memory Confluence Cloud for tests. `setup()` points the app at temp dirs and a fake site,
// and replaces global fetch for that site only (localhost calls still go to the real network stack).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BASE = 'https://fake-site.atlassian.net/wiki';

export function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-test-'));
  Object.assign(process.env, {
    CONFLUENCE_BASE_URL: BASE,
    CONFLUENCE_EMAIL: 'tester@example.com',
    CONFLUENCE_SPACE_KEY: 'PK',
    CONFLUENCE_API_TOKEN: 'test-token',
    CN_DRAFTS_DIR: path.join(root, 'drafts'),
    CN_WORKSPACE_DIR: path.join(root, 'workspace'),
    CN_CACHE_DIR: path.join(root, 'cache'),
    CN_EXPORTS_DIR: path.join(root, 'exports'),
  });
  for (const d of ['drafts', 'workspace', 'cache']) fs.mkdirSync(path.join(root, d), { recursive: true });
  const fake = new FakeConfluence();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://fake-site.atlassian.net/')) return fake.handle(url, init || {});
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error(`Test tried to reach the network: ${url}`);
    return realFetch(input, init);
  };
  return { root, fake, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export class FakeConfluence {
  constructor() {
    this.space = { id: '1', key: 'PK', name: 'Test Space', homepageId: '100' };
    /** id → { id, title, parentId, parentType, version, body, status, position, authorId } */
    this.pages = new Map();
    this.folders = new Map();
    this.attachments = new Map(); // pageId → [{ title, fileSize }]
    this.labels = new Map(); // pageId → Set
    this.users = { 'acc-akmal': 'Akmal Muhamad', 'acc-rina': 'Rina Editor' };
    this.calls = [];
    this.failUploads = false;
    this.nextId = 1000;
    this.addPage({ id: '100', title: 'Home', parentId: null });
  }

  addPage({ id = String(this.nextId++), title, parentId = '100', parentType = 'page', body = '<p>hello</p>', version = 1, position }) {
    const page = { id, title, parentId, parentType, version, body, status: 'current', position: position ?? this.pages.size, authorId: 'acc-akmal', createdAt: '2026-09-01T00:00:00Z' };
    this.pages.set(id, page);
    return page;
  }

  /** Simulate someone editing the page in Confluence. */
  editRemotely(id, body, authorId = 'acc-rina') {
    const p = this.pages.get(id);
    p.body = body;
    p.version++;
    p.authorId = authorId;
  }

  pageJson(p, withBody) {
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      spaceId: this.space.id,
      parentId: p.parentId,
      parentType: p.parentType,
      position: p.position,
      createdAt: p.createdAt,
      version: { number: p.version, authorId: p.authorId, createdAt: '2026-09-18T00:00:00Z' },
      ...(withBody ? { body: { storage: { value: p.body, representation: 'storage' } } } : {}),
    };
  }

  async handle(url, init) {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/wiki/, '');
    const method = (init.method || 'GET').toUpperCase();
    this.calls.push(`${method} ${p}`);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    let m;

    if (method === 'GET' && p === '/api/v2/spaces') return json(200, { results: u.searchParams.get('keys') === 'PK' ? [this.space] : [] });
    if (method === 'GET' && p === `/api/v2/spaces/${this.space.id}/pages`) {
      return json(200, { results: [...this.pages.values()].filter((x) => x.status === 'current').map((x) => this.pageJson(x, false)), _links: {} });
    }
    if (method === 'GET' && (m = p.match(/^\/api\/v2\/folders\/(\w+)$/))) {
      const f = this.folders.get(m[1]);
      return f ? json(200, f) : json(404, { message: 'no folder' });
    }
    if ((m = p.match(/^\/api\/v2\/pages\/(\w+)\/attachments$/)) && method === 'GET') {
      return json(200, { results: (this.attachments.get(m[1]) || []).map((a) => ({ ...a, downloadLink: `/download/${m[1]}/${a.title}`, mediaType: 'image/png' })), _links: {} });
    }
    if ((m = p.match(/^\/api\/v2\/pages\/(\w+)$/))) {
      const page = this.pages.get(m[1]);
      if (method === 'GET') {
        if (!page || page.status === 'deleted') return json(404, { message: 'not found' });
        return json(200, this.pageJson(page, true));
      }
      if (method === 'PUT') {
        if (!page) return json(404, { message: 'not found' });
        if (body.version.number !== page.version + 1) return json(409, { message: `Version must be ${page.version + 1}` });
        Object.assign(page, { title: body.title, body: body.body.value, version: body.version.number, authorId: 'acc-akmal' });
        return json(200, this.pageJson(page, false));
      }
    }
    if (method === 'POST' && p === '/api/v2/pages') {
      if ([...this.pages.values()].some((x) => x.title === body.title && x.status === 'current')) return json(400, { message: 'A page with this title already exists' });
      const page = this.addPage({ title: body.title, parentId: body.parentId, body: body.body.value });
      return json(200, this.pageJson(page, false));
    }
    if (method === 'PUT' && (m = p.match(/^\/rest\/api\/content\/(\w+)\/child\/attachment$/))) {
      if (this.failUploads) return json(400, { message: 'Upload rejected (test)' });
      const file = body.get('file');
      const list = this.attachments.get(m[1]) || [];
      this.attachments.set(m[1], [...list.filter((a) => a.title !== file.name), { title: file.name, fileSize: file.size }]);
      return json(200, { results: [] });
    }
    if ((m = p.match(/^\/rest\/api\/content\/(\w+)\/label$/))) {
      const set = this.labels.get(m[1]) || new Set();
      this.labels.set(m[1], set);
      if (method === 'POST') for (const l of body) set.add(l.name);
      if (method === 'DELETE') set.delete(u.searchParams.get('name'));
      return json(200, { results: [...set].map((name) => ({ name })) });
    }
    if (method === 'PUT' && (m = p.match(/^\/rest\/api\/content\/(\w+)\/move\/(append|before|after)\/(\w+)$/))) {
      const [, id, position, targetId] = m;
      const page = this.pages.get(id);
      const target = this.pages.get(targetId);
      if (!page || !target) return json(404, { message: 'not found' });
      const parentId = position === 'append' ? targetId : target.parentId;
      const siblings = [...this.pages.values()].filter((x) => x.parentId === parentId && x.id !== id).sort((a, b) => a.position - b.position);
      const at = position === 'append' ? siblings.length : siblings.indexOf(target) + (position === 'after' ? 1 : 0);
      siblings.splice(at, 0, page);
      siblings.forEach((x, i) => (x.position = i));
      page.parentId = parentId;
      return json(200, { pageId: id });
    }
    if (method === 'GET' && p === '/rest/api/user') {
      const id = u.searchParams.get('accountId');
      return this.users[id] ? json(200, { accountId: id, displayName: this.users[id] }) : json(404, { message: 'no user' });
    }
    if (method === 'GET' && p === '/rest/api/search/user') return json(200, { results: [] });
    if (method === 'GET' && p === '/rest/api/content/search') {
      return json(200, { results: [...this.labels].filter(([, s]) => s.size).map(([id, s]) => ({ id, metadata: { labels: { results: [...s].map((name) => ({ name })) } } })), _links: {} });
    }
    if (method === 'GET' && p === '/rest/api/template/page') return json(200, { results: [] });
    return json(404, { message: `fake: no route ${method} ${p}` });
  }
}
