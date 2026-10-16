import { config, readToken, assertConfigured } from './config.js';

export class ConfluenceError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class Confluence {
  constructor() {
    assertConfigured();
    this.base = config.baseUrl; // https://x.atlassian.net/wiki
    this.origin = new URL(this.base).origin;
    this.auth = 'Basic ' + Buffer.from(`${config.email}:${readToken()}`).toString('base64');
    this.userCache = new Map();
  }

  url(p) {
    if (p.startsWith('http')) return p;
    if (p.startsWith('/wiki/')) return this.origin + p;
    return this.base + p;
  }

  async request(p, { method = 'GET', body, headers = {}, raw = false, retries = 3 } = {}) {
    const init = { method, headers: { Authorization: this.auth, Accept: 'application/json', ...headers } };
    if (body !== undefined) {
      if (body instanceof FormData) init.body = body;
      else {
        init.body = JSON.stringify(body);
        init.headers['Content-Type'] = 'application/json';
      }
    }
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.url(p), init);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 800 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        let msg = text;
        try {
          const j = JSON.parse(text);
          msg = j.message || j.errors?.map((e) => e.title + (e.detail ? `: ${e.detail}` : '')).join('; ') || text;
        } catch {}
        throw new ConfluenceError(res.status, `Confluence ${method} ${p} → ${res.status}: ${String(msg).slice(0, 300)}`, text);
      }
      if (raw) return res;
      if (res.status === 204) return null;
      return res.json();
    }
  }

  async *paginate(p) {
    let next = p;
    while (next) {
      const j = await this.request(next);
      yield* j.results || [];
      next = j._links?.next || null;
    }
  }

  async getSpace(key = config.spaceKey) {
    const j = await this.request(`/api/v2/spaces?keys=${encodeURIComponent(key)}`);
    const space = j.results?.[0];
    if (!space) throw new Error(`Space ${key} not found or no access`);
    return space;
  }

  async listPages(spaceId) {
    const out = [];
    for await (const p of this.paginate(`/api/v2/spaces/${spaceId}/pages?limit=250&status=current`)) out.push(p);
    return out;
  }

  getFolder(id) {
    return this.request(`/api/v2/folders/${id}`);
  }

  getPage(id, format = 'storage') {
    return this.request(`/api/v2/pages/${id}?body-format=${format}`);
  }

  async getTemplates(spaceKey = config.spaceKey) {
    const list = await this.request(`/rest/api/template/page?spaceKey=${spaceKey}&limit=100`);
    const out = [];
    for (const t of list.results || []) {
      const full = await this.request(`/rest/api/template/${t.templateId}?expand=body.storage`);
      out.push({ id: t.templateId, name: t.name, description: t.description, storage: full.body?.storage?.value || '' });
    }
    return out;
  }

  async getUserName(accountId) {
    if (this.userCache.has(accountId)) return this.userCache.get(accountId);
    let name = accountId;
    try {
      const u = await this.request(`/rest/api/user?accountId=${encodeURIComponent(accountId)}`);
      name = u.publicName || u.displayName || accountId;
    } catch {}
    this.userCache.set(accountId, name);
    return name;
  }

  async listAttachments(pageId) {
    const out = [];
    for await (const a of this.paginate(`/api/v2/pages/${pageId}/attachments?limit=250`)) out.push(a);
    return out;
  }

  async downloadAttachment(pageId, filename) {
    const atts = await this.listAttachments(pageId);
    const att = atts.find((a) => a.title === filename);
    if (!att) throw new ConfluenceError(404, `Attachment ${filename} not found on page ${pageId}`);
    const res = await this.request(att.downloadLink.startsWith('/') ? att.downloadLink : `/${att.downloadLink}`, { raw: true, headers: { Accept: '*/*' } });
    return { buffer: Buffer.from(await res.arrayBuffer()), mediaType: att.mediaType };
  }

  /** Upload or replace an attachment by filename (v1 API; v2 has no upload). */
  async putAttachment(pageId, filename, buffer, contentType = 'image/png') {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: contentType }), filename);
    form.append('minorEdit', 'true');
    return this.request(`/rest/api/content/${pageId}/child/attachment`, {
      method: 'PUT',
      body: form,
      headers: { 'X-Atlassian-Token': 'nocheck' },
    });
  }

  createPage({ spaceId, parentId, title, storage }) {
    return this.request('/api/v2/pages', {
      method: 'POST',
      body: { spaceId, status: 'current', title, parentId, body: { representation: 'storage', value: storage } },
    });
  }

  updatePage({ id, title, storage, version, message }) {
    return this.request(`/api/v2/pages/${id}`, {
      method: 'PUT',
      body: {
        id,
        status: 'current',
        title,
        body: { representation: 'storage', value: storage },
        version: { number: version, message: message || 'Published from Confluence Notebook' },
      },
    });
  }

  /**
   * Move a page in the tree (v1 API; v2 has no move).
   * @param {'append'|'before'|'after'} position append = last child of target, before/after = sibling of target
   */
  movePage(id, position, targetId) {
    if (!['append', 'before', 'after'].includes(position)) throw new Error(`Invalid move position: ${position}`);
    return this.request(`/rest/api/content/${id}/move/${position}/${targetId}`, { method: 'PUT' });
  }

  webUrl(pageId) {
    return `${this.base}/spaces/${config.spaceKey}/pages/${pageId}`;
  }
}

/** Test Confluence Cloud credentials and discover accessible spaces. */
export async function testConfluenceCredentials({ baseUrl, email, token }) {
  if (!baseUrl) throw new Error('Base URL is required (e.g. https://your-team.atlassian.net/wiki)');
  if (!email) throw new Error('Atlassian account email is required');
  if (!token) throw new Error('Atlassian API token is required');

  let cleanBase = baseUrl.trim().replace(/\/+$/, '');
  if (!cleanBase.startsWith('http://') && !cleanBase.startsWith('https://')) {
    cleanBase = 'https://' + cleanBase;
  }
  const u = new URL(cleanBase);
  const pathPrefix = u.pathname === '/' || !u.pathname ? '/wiki' : u.pathname.replace(/\/+$/, '');
  const apiUrl = `${u.origin}${pathPrefix}/rest/api/space?limit=50&status=current`;

  const auth = 'Basic ' + Buffer.from(`${email.trim()}:${token.trim()}`).toString('base64');
  const res = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      Authorization: auth,
      Accept: 'application/json',
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('Authentication failed (HTTP 401/403). Please verify your Atlassian account email and API token.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Confluence returned HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const spaces = (data.results || []).map((s) => ({
    key: s.key,
    name: s.name,
    type: s.type,
  }));

  return {
    ok: true,
    baseUrl: `${u.origin}${pathPrefix}`,
    spaces,
  };
}
