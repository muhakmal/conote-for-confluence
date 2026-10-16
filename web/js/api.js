async function request(method, url, body, { raw = false, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    if (typeof body === 'string' || body instanceof Blob) init.body = body;
    else {
      init.body = JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
  }
  const res = await fetch(url, init);
  if (raw) return res;
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error(data?.error || data || `HTTP ${res.status}`);
    Object.assign(err, { status: res.status }, typeof data === 'object' ? data : {});
    throw err;
  }
  return data;
}

const enc = (name) => name.split('/').map(encodeURIComponent).join('/');

export const api = {
  status: () => request('GET', '/api/status'),
  spaces: () => request('GET', '/api/spaces'),
  switchSpace: (space) => request('POST', '/api/spaces/active', { space }),
  saveSpace: (data) => request('POST', '/api/spaces', data),
  deleteSpace: (id) => request('DELETE', `/api/spaces/${encodeURIComponent(id)}`),
  testConnection: (creds) => request('POST', '/api/test-connection', creds),
  users: (q) => request('GET', `/api/users?q=${encodeURIComponent(q || '')}`),
  tree: () => request('GET', '/api/tree'),
  page: (id) => request('GET', `/api/page/${id}`),
  pageToDraft: (id) => request('POST', `/api/page/${id}/draft`),
  search: (q) => request('GET', `/api/search?q=${encodeURIComponent(q)}`),
  pull: (opts = {}) => request('POST', '/api/pull', opts),
  settings: () => request('GET', '/api/settings'),
  saveSettings: (s) => request('PUT', '/api/settings', s),
  templates: (parent) => request('GET', `/api/templates${parent ? `?parent=${parent}` : ''}`),
  importFiles: (files, parentId) => request('POST', '/api/import', { files, parentId }),
  drafts: () => request('GET', '/api/drafts'),
  draft: (name) => request('GET', `/api/drafts/${enc(name)}`),
  saveDraft: (name, meta, body) => request('PUT', `/api/drafts/${enc(name)}`, { meta, body }),
  deleteDraft: (name) => request('DELETE', `/api/drafts/${enc(name)}`),
  createDraft: (opts) => request('POST', '/api/drafts', opts),
  publish: (name, opts = {}) => request('POST', `/api/publish/${enc(name)}`, opts),
  uploadAsset: (file) => request('POST', `/api/assets?name=${encodeURIComponent(file.name || 'image.png')}`, file),
  plantuml: async (code) => {
    const res = await request('POST', '/api/render/plantuml', { code }, { raw: true });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'PlantUML failed');
    return res.text();
  },
  history: (draft) => request('GET', `/api/history?draft=${encodeURIComponent(draft)}`),
  snapshot: (draft, id) => request('GET', `/api/history?draft=${encodeURIComponent(draft)}&id=${encodeURIComponent(id)}`),
  restoreSnapshot: (draft, id) => request('POST', '/api/history/restore', { draft, id }),
  trash: () => request('GET', '/api/trash'),
  restoreTrash: (id) => request('POST', '/api/trash/restore', { id }),
  remoteDiff: (draft) => request('GET', `/api/remote-diff?draft=${encodeURIComponent(draft)}`),
  adoptRemote: (draft) => request('POST', '/api/adopt-remote', { draft }),
  move: (id, position, targetId) => request('POST', '/api/move', { id, position, targetId }),
  exportUrl: (kind, { draft, page }) => `/api/export/${kind}?${draft ? `draft=${encodeURIComponent(draft)}` : `page=${page}`}`,
};

export function subscribe(handlers) {
  let es;
  let retry = 1000;
  const connect = () => {
    es = new EventSource('/api/events');
    es.addEventListener('hello', () => (retry = 1000));
    for (const [event, fn] of Object.entries(handlers)) es.addEventListener(event, (e) => fn(JSON.parse(e.data)));
    es.onerror = () => {
      es.close();
      setTimeout(connect, (retry = Math.min(retry * 2, 30000)));
    };
  };
  connect();
  return () => es?.close();
}
