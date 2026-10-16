import { api, subscribe } from './api.js';
import { icon, hydrateIcons, esc, h, toast, dialog, menu, timeAgo, DOC_TYPE_LABEL, statusPill, debounce } from './ui.js';
import { renderDocument, scrollSpy } from './preview.js';
import { openEditor, breadcrumb, pickParent } from './editor.js';
import { enableTreeDnd, canMove } from './tree-dnd.js';
import { trashCardHtml } from './versions.js';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const view = $('#view');
const crumbs = $('#crumbs');
const topActions = $('#top-actions');

const state = {
  tree: null,
  drafts: [],
  status: null,
  tab: 'space',
  filter: localStorage.getItem('cn-filter') || 'active',
  expanded: new Set(JSON.parse(localStorage.getItem('cn-expanded') || '[]')),
  current: null,
  destroy: null,
  pathIndex: new Map(),
};
const getTree = () => state.tree;

const FILTERS = [
  ['active', 'Active'],
  ['prd', 'PRD'],
  ['tad', 'TAD'],
  ['deployment', 'Deployment'],
  ['all', 'All'],
];

// ---------------- data ----------------
async function loadTree() {
  const t = await api.tree();
  state.tree = t.empty ? null : t;
  state.pathIndex = new Map();
  if (state.tree) for (const n of Object.values(state.tree.nodes)) if (n.f) state.pathIndex.set(n.f, n.id);
  $('#space-name').textContent = state.tree
    ? `${state.tree.space.name} · ${state.tree.space.key}`
    : (state.status?.space?.name ? `${state.status.space.name} · ${state.status.space.key || ''}` : 'Not synced yet');
  if (state.tree && !state.expanded.size && state.tree.space?.homeId) state.expanded.add(state.tree.space.homeId);
  renderTree();
}
async function loadDrafts() {
  state.drafts = await api.drafts();
  $('#draft-count').textContent = state.drafts.length || '';
  renderDraftList();
}

// ---------------- sidebar ----------------
function visible(n) {
  switch (state.filter) {
    case 'active': return n.l !== 'archived';
    case 'all': return true;
    default: return n.d === state.filter || n.d === 'home';
  }
}
function subtreeMatches(tree, id, memo) {
  if (memo.has(id)) return memo.get(id);
  const n = tree.nodes[id];
  const ok = (state.filter === 'active' || state.filter === 'all' ? visible(n) : n.d === state.filter) || (n.c || []).some((c) => subtreeMatches(tree, c, memo));
  memo.set(id, ok && (state.filter !== 'active' || n.l !== 'archived'));
  return memo.get(id);
}

function renderFilters() {
  $('#filters').innerHTML = FILTERS.map(([k, l]) => `<button class="chip" data-filter="${k}" aria-pressed="${state.filter === k}">${l}</button>`).join('');
}

function renderTree() {
  const el = $('#tree');
  const tree = state.tree;
  if (!tree) {
    el.innerHTML = `<div class="empty">${icon('refresh')}<h3>No pages yet</h3><p>Fetch the space to build your local mirror.</p><button class="btn btn-primary" data-action="pull">Fetch space</button></div>`;
    return;
  }
  const memo = new Map();
  const home = tree.nodes[tree.space.homeId];
  const flat = state.filter !== 'active' && state.filter !== 'all';
  const rows = [];
  const walk = (ids, depth) => {
    for (const id of ids) {
      const n = tree.nodes[id];
      if (!n || !subtreeMatches(tree, id, memo)) continue;
      const kids = (n.c || []).filter((c) => subtreeMatches(tree, c, memo));
      const open = state.expanded.has(id) || (flat && kids.length > 0);
      rows.push(rowHtml(n, depth, kids.length > 0, open));
      if (kids.length) {
        rows.push(`<div class="tree-children ${open ? 'open' : ''}" data-for="${id}"><div>`);
        if (open) walk(kids, depth + 1);
        else rows.push(`<template data-lazy="${id}" data-depth="${depth + 1}"></template>`);
        rows.push('</div></div>');
      }
    }
  };
  walk(home ? home.c : tree.rootIds, 0);
  for (const r of tree.rootIds) if (r !== tree.space.homeId) walk([r], 0);
  el.innerHTML = rows.join('');
  markActive();
}

function rowHtml(n, depth, hasKids, open) {
  const movable = n.d !== 'folder' && n.d !== 'home';
  return `<div class="tree-row" role="treeitem" data-id="${n.id}" style="--depth:${depth}" ${hasKids ? `aria-expanded="${open}"` : ''} ${movable ? 'draggable="true"' : ''} title="${esc(n.t)}">
    <span class="twisty" ${hasKids ? 'data-toggle' : ''}>${hasKids ? icon('chevron') : `<span class="dot dot-${n.d}"></span>`}</span>
    <span class="label">${esc(n.t)}</span>${n.s && n.d === 'prd' ? `<span class="meta">${esc(String(n.s).slice(0, 5))}</span>` : ''}
    <button class="row-add" data-add="${n.id}" title="New page under “${esc(n.t)}”" aria-label="New page here">${icon('plus')}</button>
  </div>`;
}

function toggleNode(id, row) {
  const open = !state.expanded.has(id);
  open ? state.expanded.add(id) : state.expanded.delete(id);
  localStorage.setItem('cn-expanded', JSON.stringify([...state.expanded].slice(-200)));
  const box = $(`.tree-children[data-for="${id}"]`);
  row.setAttribute('aria-expanded', String(open));
  if (!box) return;
  const lazy = box.querySelector(`:scope > div > template[data-lazy="${id}"]`);
  if (open && lazy) {
    const tree = state.tree;
    const memo = new Map();
    const depth = Number(lazy.dataset.depth);
    const html = [];
    for (const cid of tree.nodes[id].c) {
      const c = tree.nodes[cid];
      if (!subtreeMatches(tree, cid, memo)) continue;
      const kids = (c.c || []).filter((k) => subtreeMatches(tree, k, memo));
      html.push(rowHtml(c, depth, kids.length > 0, false));
      if (kids.length) html.push(`<div class="tree-children" data-for="${cid}"><div><template data-lazy="${cid}" data-depth="${depth + 1}"></template></div></div>`);
    }
    lazy.outerHTML = html.join('');
    markActive();
  }
  requestAnimationFrame(() => box.classList.toggle('open', open));
}

function revealInTree(id) {
  const tree = state.tree;
  if (!tree?.nodes[id]) return;
  const chain = [];
  let p = tree.nodes[id].p;
  while (p) {
    chain.unshift(p);
    p = tree.nodes[p]?.p;
  }
  let changed = false;
  for (const a of chain) if (!state.expanded.has(a)) (state.expanded.add(a), (changed = true));
  if (changed) renderTree();
  const row = $(`.tree-row[data-id="${id}"]`);
  row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function markActive() {
  document.querySelectorAll('.tree-row.active').forEach((r) => r.classList.remove('active'));
  if (state.current?.type === 'page') $(`.tree-row[data-id="${state.current.id}"]`)?.classList.add('active');
  document.querySelectorAll('.draft-item').forEach((d) => d.classList.toggle('active', state.current?.type === 'draft' && d.dataset.name === state.current.name));
}

function renderDraftList() {
  const el = $('#draft-list');
  if (!state.drafts.length) {
    el.innerHTML = `<div class="empty">${icon('file')}<h3>No drafts</h3><p>Start a PRD from your team template.</p><button class="btn btn-primary" data-action="new-draft">${icon('plus')} New PRD</button></div>`;
    return;
  }
  el.innerHTML =
    `<button class="btn" style="width:100%;margin-bottom:8px" data-action="new-draft">${icon('plus')} New draft</button>` +
    state.drafts
      .map((d) => `<div class="draft-item" data-name="${esc(d.name)}"><div class="t">${esc(d.title)}</div><div class="s">${d.confluence_id ? (d.dirty ? '<span class="pill pill-yellow">CHANGED</span>' : '<span class="pill pill-green">PUBLISHED</span>') : '<span class="pill">LOCAL</span>'}<span>${timeAgo(d.modified)}</span></div></div>`)
      .join('');
  markActive();
}

function setTab(tab) {
  state.tab = tab;
  const seg = $('.segmented');
  seg.dataset.active = tab;
  seg.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('#tree').hidden = tab !== 'space';
  $('#filters').hidden = tab !== 'space';
  $('#draft-list').hidden = tab !== 'drafts';
}

// ---------------- sync status ----------------
function renderSync(extra) {
  const s = $('#sync');
  const text = $('#sync-text');
  if (extra) {
    text.textContent = extra;
    return;
  }
  text.textContent = state.tree ? `Synced ${timeAgo(state.tree.pulledAt)}` : 'Not synced';
  text.title = state.tree ? new Date(state.tree.pulledAt).toLocaleString() : '';
  s.classList.remove('busy', 'indeterminate');
}
setInterval(() => !$('#sync').classList.contains('busy') && renderSync(), 30_000);

async function startPull(opts = {}) {
  try {
    const r = await api.pull(opts);
    if (r.started) {
      $('#sync').classList.add('busy', 'indeterminate');
      renderSync('Starting…');
    }
  } catch (e) {
    toast(esc(e.message), { type: 'error' });
  }
}

subscribe({
  pull(e) {
    const s = $('#sync');
    const bar = $('#sync-progress');
    if (e.phase === 'error') {
      s.classList.remove('busy', 'indeterminate');
      renderSync('Fetch failed');
      toast(`Fetch failed: ${esc(e.message)}`, { type: 'error', timeout: 7000 });
      return;
    }
    s.classList.add('busy');
    if (e.total) {
      s.classList.remove('indeterminate');
      bar.style.width = `${Math.round((e.done / e.total) * 100)}%`;
      renderSync(`${e.phase === 'fetch' ? 'Fetching' : 'Converting'} ${e.done}/${e.total}`);
    } else {
      s.classList.add('indeterminate');
      renderSync(e.message || 'Working…');
    }
  },
  // a page was moved (maybe from another tab): the index is already updated
  moved() {
    loadTree();
  },
  async pulled(e) {
    $('#sync-progress').style.width = '100%';
    await loadTree();
    setTimeout(() => {
      $('#sync-progress').style.width = '0';
      renderSync();
    }, 500);
    if (e.fetched || e.trigger === 'manual') toast(e.fetched ? `${e.fetched} page${e.fetched > 1 ? 's' : ''} updated from Confluence` : 'Space is up to date');
    if (state.current?.type === 'page' && e.fetched) route();
    else if (state.current?.type === 'home') route();
  },
  async 'space-changed'(e) {
    if ($('#space-select')) $('#space-select').value = e.active;
    state.status = await api.status();
    state.expanded.clear();
    await Promise.all([loadTree(), loadDrafts()]);
    renderSync();
    renderFilters();
    toast(`Switched to ${esc(state.status.space?.name || e.active)}`);
  },
});

// ---------------- router ----------------
async function route() {
  const hash = location.hash || '#/';
  const [, kind, ...rest] = hash.slice(1).split('/');
  const arg = decodeURIComponent(rest.join('/'));
  if (state.destroy) {
    const d = state.destroy;
    state.destroy = null;
    await d();
  }
  if (isPresentMode && kind !== 'page' && kind !== 'draft') {
    exitPresentMode();
  }
  app.classList.remove('drawer-open');
  topActions.innerHTML = '';
  view.scrollTop = 0;
  try {
    if (kind === 'page' && arg) await showPage(arg);
    else if (kind === 'draft' && arg) await showDraft(arg);
    else if (kind === 'drafts') showDrafts();
    else showHome();
  } catch (e) {
    view.innerHTML = `<div class="empty page-enter">${icon('info')}<h3>Something went wrong</h3><p>${esc(e.message)}</p></div>`;
  }
  markActive();
  document.querySelectorAll('.tabbar [data-nav]').forEach((t) => t.classList.toggle('active', t.dataset.nav === (state.current?.type === 'draft' || kind === 'drafts' ? 'drafts' : state.current?.type === 'home' ? 'home' : '')));
}
window.addEventListener('hashchange', route);
const navigate = (h2) => (location.hash = h2);

// ---------------- home ----------------
function showHome() {
  state.current = { type: 'home' };
  crumbs.innerHTML = `<span class="current">Home</span>`;
  const tree = state.tree;
  if (!tree) {
    view.innerHTML = `<div class="home page-enter"><div class="empty"><div class="brand-mark" style="width:56px;height:56px;margin:0 auto 12px;border-radius:16px"></div><h3>Welcome to Confluence Notebook</h3><p>Fetch space <strong>${esc(state.status?.space?.key || '')}</strong> to mirror it locally. After that, updates are incremental and take seconds.</p><br><button class="btn btn-primary" data-action="pull">${icon('refresh')} Fetch space</button></div></div>`;
    return;
  }
  const nodes = Object.values(tree.nodes);
  const prds = nodes.filter((n) => n.d === 'prd' && n.l !== 'archived');
  const recent = [...prds].sort((a, b) => String(b.u).localeCompare(String(a.u))).slice(0, 8);
  const domains = {};
  for (const p of prds) {
    const k = p.m || 'Other';
    domains[k] ||= { backlog: 0, development: 0, released: 0, other: 0 };
    domains[k][p.l || 'other']++;
  }
  const domainRows = Object.entries(domains)
    .filter(([k]) => k !== 'Product Development')
    .sort((a, b) => sum(b[1]) - sum(a[1]))
    .map(([k, c]) => {
      const total = sum(c);
      const seg = (v, color) => (v ? `<i style="width:${(v / total) * 100}%;background:${color}"></i>` : '');
      return `<div class="domain-row"><span>${esc(k)}</span><span class="s" style="color:var(--muted)">${total}</span><div class="bar">${seg(c.backlog, '#f59e0b')}${seg(c.development, '#3b82f6')}${seg(c.released, '#22c55e')}${seg(c.other, '#94a3b8')}</div></div>`;
    })
    .join('');
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 19 ? 'Selamat sore' : 'Selamat malam';
  view.innerHTML = `
    <div class="home stagger">
      <div class="hero"><div><h1>${greet} 👋</h1><p>${esc(tree.space.name)} · synced ${timeAgo(tree.pulledAt)}</p></div>
        <div style="display:flex;gap:8px"><button class="btn" data-action="palette">${icon('search')} Search</button><button class="btn btn-primary" data-action="new-draft">${icon('plus')} New PRD</button></div></div>
      <div class="stats">
        <div class="stat"><b>${prds.length}</b><span>Active PRDs</span></div>
        <div class="stat"><b>${prds.filter((p) => p.l === 'backlog').length}</b><span>In backlog</span></div>
        <div class="stat"><b>${nodes.filter((n) => n.d === 'tad').length}</b><span>TADs</span></div>
        <div class="stat"><b>${state.drafts.length}</b><span>Local drafts</span></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-head"><h2>Recently updated PRDs</h2></div>
          ${recent.map((n) => `<a class="list-item" href="#/page/${n.id}"><span class="dot dot-prd"></span><div class="grow"><div class="t">${esc(n.t)}</div><div class="s">${esc(n.m || '')}${n.l ? ` · ${n.l}` : ''} · ${timeAgo(n.u)}</div></div>${statusPill(n.s)}</a>`).join('')}
        </div>
        <div style="display:flex;flex-direction:column;gap:20px">
          <div class="card"><div class="card-head"><h2>Your drafts</h2><a class="btn btn-sm btn-ghost" href="#/drafts">All</a></div>
            ${state.drafts.slice(0, 5).map((d) => `<a class="list-item" href="#/draft/${encodeURIComponent(d.name)}"><div class="grow"><div class="t">${esc(d.title)}</div><div class="s">${timeAgo(d.modified)}</div></div>${d.confluence_id ? (d.dirty ? '<span class="pill pill-yellow">CHANGED</span>' : '<span class="pill pill-green">LIVE</span>') : '<span class="pill">LOCAL</span>'}</a>`).join('') || `<div class="list-item" data-action="new-draft"><div class="grow"><div class="t">Start your first PRD</div><div class="s">Uses the Flash Mobile PRD template</div></div>${icon('plus')}</div>`}
          </div>
          <div class="card"><div class="card-head"><h2>PRDs by domain</h2></div>${domainRows}
            <div class="legend"><span><i style="background:#f59e0b"></i>Backlog</span><span><i style="background:#3b82f6"></i>Development</span><span><i style="background:#22c55e"></i>Released</span></div>
          </div>
        </div>
      </div>
    </div>`;
}
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// ---------------- reader ----------------
async function showPage(id) {
  state.current = { type: 'page', id };
  const tree = state.tree;
  const node = tree?.nodes?.[id];
  crumbs.innerHTML = crumbHtml(id);
  view.innerHTML = `<div class="sk-doc">${['60%', '35%', '100%', '92%', '97%', '40%', '100%', '88%'].map((w, i) => `<div class="skeleton" style="height:${i === 0 ? 30 : 14}px;width:${w}"></div>`).join('')}</div>`;
  revealInTree(id);
  const data = await api.page(id);
  if (state.current?.id !== id) return;
  const meta = data.meta;
  topActions.innerHTML = `
    <button class="btn btn-present" data-act="present" title="Read / Present mode (⌘P)">${icon('present')}<span class="label-hide">Present</span></button>
    <button class="btn" data-act="new-child" title="Create a new page under this one">${icon('plus')}<span class="label-hide">New page</span></button>
    <button class="btn" data-act="to-draft" title="Copy into drafts to edit and republish">${icon('edit')}<span class="label-hide">Edit as draft</span></button>
    ${node && node.d !== 'folder' && node.d !== 'home' ? `<button class="icon-btn" data-act="move" title="Move page to another parent" aria-label="Move page">${icon('tree')}</button>` : ''}
    <button class="icon-btn" data-act="export" aria-label="Export">${icon('download')}</button>
    <a class="icon-btn" href="${esc(meta.url)}" target="_blank" rel="noopener" title="Open in Confluence" aria-label="Open in Confluence">${icon('external')}</a>`;
  const banner = [
    node?.d ? `<span class="pill">${esc(DOC_TYPE_LABEL[node.d] || node.d)}</span>` : '',
    meta.lifecycle ? `<span class="pill pill-blue">${esc(meta.lifecycle.toUpperCase())}</span>` : '',
    `<span>v${esc(meta.version)} · updated ${timeAgo(meta.updated)}</span>`,
    ...[].concat(meta.labels || []).map((l) => `<span class="label-chip">${icon('label')}${esc(l)}</span>`),
  ].join('');
  view.innerHTML = `<div class="reader page-enter"><article class="doc"><div class="doc-banner">${banner}</div><div data-body></div></article><aside class="outline" aria-label="On this page"></aside></div>`;
  const pageDir = node ? dirOfPath(node.f) : '';
  const headings = renderDocument(view.querySelector('[data-body]'), { ...meta, title: undefined }, data.body, {
    onPageLink: (href) => {
      const target = normalizePath(pageDir, href.split('#')[0]);
      const pid = state.pathIndex.get(target);
      return pid ? `#/page/${pid}` : null;
    },
  });
  const outline = view.querySelector('.outline');
  const hs = headings.filter((x) => x.depth >= 2 && x.depth <= 3);
  if (hs.length > 2) {
    outline.innerHTML = `<div class="outline-title">On this page</div>${hs.map((x) => `<a href="#" data-id="${x.id}" class="l${x.depth}">${esc(x.text)}</a>`).join('')}`;
    outline.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-id]');
      if (!a) return;
      e.preventDefault();
      document.getElementById(a.dataset.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const stop = scrollSpy(view, outline);
    state.destroy = async () => stop();
  }
  topActions.querySelector('[data-act="present"]')?.addEventListener('click', () => {
    enterPresentMode({ title: meta.title || node?.t || 'Document', headings });
  });
  topActions.querySelector('[data-act="new-child"]').addEventListener('click', () => newDraftDialog({ parentId: id }));
  topActions.querySelector('[data-act="move"]')?.addEventListener('click', async () => {
    const target = await pickParent(state.tree, node.p, { title: 'Move page under…', subtitle: `Choose the new parent for “${esc(node.t)}”. The page moves in Confluence.` });
    if (!target) return;
    if (!canMove(state.tree, id, 'append', target)) return toast('The page cannot be moved there', { type: 'error' });
    movePageFlow(id, 'append', target);
  });
  topActions.querySelector('[data-act="to-draft"]').addEventListener('click', async () => {
    const r = await api.pageToDraft(id);
    await loadDrafts();
    toast('Copied into drafts. Publishing will update this page.');
    navigate(`#/draft/${encodeURIComponent(r.name)}`);
  });
  topActions.querySelector('[data-act="export"]').addEventListener('click', (e) =>
    menu(e.currentTarget, [
      { icon: 'word', label: 'Save as Word (.docx)', onClick: () => downloadUrl(api.exportUrl('docx', { page: id })) },
      { icon: 'globe', label: 'Save as HTML', onClick: () => downloadUrl(api.exportUrl('html', { page: id })) },
    ]),
  );
}

const dirOfPath = (p = '') => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
function normalizePath(dir, rel) {
  const out = [];
  for (const part of `${dir}/${decodeURIComponent(rel)}`.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}
function downloadUrl(url) {
  const a = h(`<a href="${url}" download hidden></a>`);
  document.body.append(a);
  a.click();
  a.remove();
  toast('Preparing export…', { timeout: 2200 });
}

function crumbHtml(id) {
  const tree = state.tree;
  const chain = [];
  let n = tree?.nodes?.[id];
  while (n) {
    chain.unshift(n);
    n = tree.nodes[n.p];
  }
  const last = chain.pop();
  const shown = chain.slice(1).slice(-2);
  return `${chain.length > 3 ? '<span class="sep">…</span><span class="sep">/</span>' : ''}${shown.map((c) => `<a href="#/page/${c.id}">${esc(c.t)}</a><span class="sep">/</span>`).join('')}<span class="current">${esc(last?.t || '')}</span>`;
}

// ---------------- drafts ----------------
async function showDraft(name) {
  state.current = { type: 'draft', name };
  setTab('drafts');
  state.destroy = await openEditor({ name, view, topActions, crumbs, app, getTree, navigate, onChanged: debounce(loadDrafts, 400), reload: () => route() });
}

function showDrafts() {
  state.current = { type: 'drafts' };
  crumbs.innerHTML = '<span class="current">Drafts</span>';
  topActions.innerHTML = `<button class="btn btn-primary" data-action="new-draft">${icon('plus')}<span class="label-hide">New draft</span></button>`;
  view.innerHTML = `<div class="home stagger"><div class="hero"><div><h1>Drafts</h1><p>Local Markdown files in <code>drafts/</code>. Publishing is one-way to Confluence.</p></div></div>
    <div class="card">${state.drafts.map((d) => `<a class="list-item" href="#/draft/${encodeURIComponent(d.name)}">${icon('file')}<div class="grow"><div class="t">${esc(d.title)}</div><div class="s">${esc(d.name)} · edited ${timeAgo(d.modified)}${d.published_at ? ` · published ${timeAgo(d.published_at)}` : ''}</div></div>${statusPill(d.doc_status)} ${d.confluence_id ? (d.dirty ? '<span class="pill pill-yellow">CHANGED</span>' : '<span class="pill pill-green">LIVE</span>') : '<span class="pill">LOCAL</span>'}</a>`).join('') || `<div class="empty"><h3>No drafts yet</h3><button class="btn btn-primary" data-action="new-draft">${icon('plus')} New PRD</button></div>`}</div><div data-trash-card></div></div>`;
  renderTrash();
}

async function renderTrash() {
  const box = view.querySelector('[data-trash-card]');
  if (!box) return;
  box.innerHTML = await trashCardHtml();
  box.onclick = async (e) => {
    const btn = e.target.closest('[data-restore-trash]');
    if (!btn) return;
    btn.disabled = true;
    try {
      const { name } = await api.restoreTrash(btn.dataset.restoreTrash);
      await loadDrafts();
      toast(`Restored to drafts/${esc(name)}`, { action: { label: 'Open', onClick: () => navigate(`#/draft/${encodeURIComponent(name)}`) } });
      if (state.current?.type === 'drafts') showDrafts();
    } catch (err) {
      btn.disabled = false;
      toast(esc(err.message), { type: 'error' });
    }
  };
}

/**
 * New page dialog: create from a template, or import existing Markdown.
 * @param {{ parentId?: string, tab?: 'template'|'import', files?: File[] }} opts
 */
async function newDraftDialog(opts = {}) {
  const tree = state.tree;
  const quick = tree ? Object.values(tree.nodes).filter((n) => n.d === 'section' && /backlog/i.test(n.t) && n.l !== 'archived') : [];
  let parentId = opts.parentId || quick[0]?.id || tree?.space?.homeId || '';
  let tab = opts.tab || 'template';
  let templates = [];
  let pendingFiles = opts.files || [];
  const result = await dialog({
    title: 'New page',
    subtitle: 'Everything stays local until you publish.',
    className: 'new-dialog',
    render(b, close) {
      b.innerHTML = `
        <div class="dialog-body">
          <div class="segmented seg-inline" data-active="${tab}" role="tablist">
            <button role="tab" data-t="template" aria-selected="${tab === 'template'}">${icon('file')} From template</button>
            <button role="tab" data-t="import" aria-selected="${tab === 'import'}">${icon('download')} Import Markdown</button>
            <span class="segmented-thumb"></span>
          </div>
          <div class="field"><label>Location in ${esc(tree?.space?.name || 'space')}</label>
            <button class="btn parent-btn location" data-change>${icon('tree')}<span data-parent-label></span><span class="change">Change</span></button>
            ${quick.length ? `<div class="quick-parents">${quick.map((s) => `<button class="chip" data-pid="${s.id}">${esc((s.m || s.t).replace(/ Service$/, ''))}</button>`).join('')}</div>` : ''}
          </div>
          <div data-pane="template" ${tab === 'template' ? '' : 'hidden'}>
            <div class="field"><label>Title</label><input class="input" name="title" placeholder="API Get Balance Biller" autofocus></div>
            <div class="field"><label>Template <span class="suggest-note" data-suggest-note></span></label><div class="template-grid" data-templates><div class="skeleton" style="height:64px"></div></div></div>
            <div class="props-grid" style="padding:0">
              <div class="field"><label>Owner</label><input class="input" name="owner" value="${esc(localStorage.getItem('cn-owner') || '')}" placeholder="Nama kamu"></div>
              <div class="field"><label>Tribe</label><input class="input" name="tribe" list="tribe-list" placeholder="BILLER"><datalist id="tribe-list">${['VAS', 'BILLER', 'PAYMENT ACCEPTANCE', 'TRANSFER', 'MERCHANT', 'WALLET', 'GLOBAL'].map((t) => `<option value="${t}">`).join('')}</datalist></div>
            </div>
          </div>
          <div data-pane="import" ${tab === 'import' ? '' : 'hidden'}>
            <label class="dropzone" data-drop>
              <input type="file" multiple accept=".md,.markdown,.mdx,.txt,.html,.htm,image/*" hidden>
              ${icon('download')}
              <strong>Drop .md or .html PRDs here, or click to choose</strong>
              <span>Page properties are read from the header table, heading numbers are removed, and diagrams keep their mermaid source. Add referenced images too (select them together).</span>
            </label>
            <div class="file-list" data-files></div>
          </div>
        </div>
        <div class="dialog-foot"><button class="btn" data-x>Cancel</button><button class="btn btn-primary" data-ok>${icon('plus')} Create</button></div>`;

      const label = b.querySelector('[data-parent-label]');
      const grid = b.querySelector('[data-templates]');
      const note = b.querySelector('[data-suggest-note]');
      let chosen = null;
      const drawTemplates = (suggested) => {
        const order = [...templates].sort((a, c) => (a.id === suggested ? -1 : c.id === suggested ? 1 : a.source.localeCompare(c.source)));
        chosen = suggested;
        grid.innerHTML =
          order
            .map((t) => `<button class="template-card ${t.id === chosen ? 'sel' : ''}" data-tid="${esc(t.id)}"><strong>${esc(t.name)}</strong><span>${t.source === 'confluence' ? 'Confluence template' : 'Notebook template'}${t.id === suggested ? ' · recommended here' : ''}</span></button>`)
            .join('') + `<button class="template-card ${chosen === 'blank' ? 'sel' : ''}" data-tid="blank"><strong>Blank page</strong><span>Start from scratch</span></button>`;
      };
      const setParent = async (id) => {
        parentId = id;
        label.textContent = id ? breadcrumb(tree, id) || tree?.nodes?.[id]?.t || 'Space home' : 'Space home';
        b.querySelectorAll('[data-pid]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.pid === id)));
        const r = await api.templates(id).catch(() => ({ templates: [], suggested: 'local:prd.md' }));
        templates = r.templates;
        const name = templates.find((t) => t.id === r.suggested)?.name;
        note.textContent = name ? `· ${name} fits this location` : '';
        drawTemplates(r.suggested);
      };
      setParent(parentId);
      grid.addEventListener('click', (e) => {
        const card = e.target.closest('[data-tid]');
        if (!card) return;
        chosen = card.dataset.tid;
        grid.querySelectorAll('.template-card').forEach((c) => c.classList.toggle('sel', c === card));
      });
      b.querySelector('[data-change]').addEventListener('click', async () => {
        const { pickParent } = await import('./editor.js');
        const id = await pickParent(tree, parentId);
        if (id) setParent(id);
      });
      b.querySelector('.quick-parents')?.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-pid]');
        if (chip) setParent(chip.dataset.pid);
      });

      const seg = b.querySelector('.seg-inline');
      const okBtn = b.querySelector('[data-ok]');
      const setTab = (t) => {
        tab = t;
        seg.dataset.active = t;
        seg.querySelectorAll('[data-t]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.t === t)));
        b.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== t));
        okBtn.innerHTML = t === 'import' ? `${icon('download')} Import` : `${icon('plus')} Create`;
      };
      seg.addEventListener('click', (e) => e.target.closest('[data-t]') && setTab(e.target.closest('[data-t]').dataset.t));
      setTab(tab);

      // import files
      const drop = b.querySelector('[data-drop]');
      const input = drop.querySelector('input');
      const list = b.querySelector('[data-files]');
      const drawFiles = () => {
        list.innerHTML = pendingFiles
          .map((f, i) => `<div class="file-row">${icon(/\.(md|markdown|mdx|txt|html?)$/i.test(f.name) ? 'file' : 'image')}<span class="grow">${esc(f.name)}</span><span class="muted">${Math.max(1, Math.round(f.size / 1024))} KB</span><button class="icon-btn" data-rm="${i}" aria-label="Remove">${icon('close')}</button></div>`)
          .join('');
      };
      const addFiles = (files) => {
        pendingFiles = [...pendingFiles, ...files];
        drawFiles();
        setTab('import');
      };
      input.addEventListener('change', () => addFiles([...input.files]));
      list.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-rm]');
        if (rm) (pendingFiles.splice(Number(rm.dataset.rm), 1), drawFiles());
      });
      for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add('over')));
      for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        addFiles([...e.dataTransfer.files]);
      });
      drawFiles();

      const submit = () => {
        if (tab === 'import') {
          if (!pendingFiles.some((f) => /\.(md|markdown|mdx|txt|html?)$/i.test(f.name))) return toast('Choose at least one .md or .html file', { type: 'error' });
          return close({ kind: 'import', files: pendingFiles, parentId });
        }
        const v = (n) => b.querySelector(`[name="${n}"]`).value.trim();
        if (!v('title')) return b.querySelector('[name="title"]').focus();
        localStorage.setItem('cn-owner', v('owner'));
        close({ kind: 'template', title: v('title'), template: chosen || 'blank', owner: v('owner'), tribe: v('tribe'), parentId: parentId || undefined });
      };
      b.querySelector('[name="title"]').addEventListener('keydown', (e) => e.key === 'Enter' && submit());
      b.querySelector('[data-x]').onclick = () => close();
      okBtn.onclick = submit;
    },
  });
  if (!result) return;
  try {
    if (result.kind === 'import') return await runImport(result.files, result.parentId);
    const { name } = await api.createDraft(result);
    await loadDrafts();
    navigate(`#/draft/${encodeURIComponent(name)}`);
  } catch (e) {
    toast(esc(e.message), { type: 'error' });
  }
}

async function runImport(files, parentId) {
  const close = toast(`Importing ${files.length} file${files.length > 1 ? 's' : ''}…`, { timeout: 0 });
  try {
    const payload = await Promise.all(
      files.map(async (f) => {
        const buf = new Uint8Array(await f.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return { name: f.webkitRelativePath || f.name, data: btoa(bin) };
      }),
    );
    const { results } = await api.importFiles(payload, parentId);
    await loadDrafts();
    close();
    const warnings = results.flatMap((r) => r.warnings.map((w) => `${r.title}: ${w}`));
    if (warnings.length || results.length > 1) {
      await dialog({
        title: `Imported ${results.length} document${results.length > 1 ? 's' : ''}`,
        subtitle: 'Formatting was normalised for Confluence. Review the notes below before publishing.',
        render(b, done) {
          b.innerHTML = `<div class="dialog-body">${results
            .map((r) => `<a class="list-item" href="#/draft/${encodeURIComponent(r.name)}" data-open>${r.publishable ? '<span class="pill pill-green">READY</span>' : '<span class="pill pill-yellow">CHECK</span>'}<div class="grow"><div class="t">${esc(r.title)}</div><div class="s">${r.images} image(s) copied</div></div></a>${r.warnings.map((w) => `<div class="import-warning">${icon('info')}<span>${esc(w)}</span></div>`).join('')}`)
            .join('')}</div><div class="dialog-foot"><button class="btn btn-primary" data-x>Open ${results.length > 1 ? 'first' : 'draft'}</button></div>`;
          b.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', () => done()));
          b.querySelector('[data-x]').onclick = () => (done(), navigate(`#/draft/${encodeURIComponent(results[0].name)}`));
        },
      });
    } else {
      toast(`Imported “${esc(results[0].title)}”`);
      navigate(`#/draft/${encodeURIComponent(results[0].name)}`);
    }
  } catch (e) {
    close();
    toast(esc(e.message), { type: 'error' });
  }
}

// ---------------- palette ----------------
async function openPalette() {
  const tree = state.tree;
  const nodes = tree ? Object.values(tree.nodes) : [];
  await dialog({
    className: 'palette',
    render(b, close) {
      b.innerHTML = `<div class="palette-input">${icon('search')}<input placeholder="Search titles, or type 2+ letters for full text…" autofocus aria-label="Search"><kbd>esc</kbd></div><div class="palette-list" role="listbox"></div>`;
      const input = b.querySelector('input');
      const list = b.querySelector('.palette-list');
      let items = [];
      let sel = 0;
      let seq = 0;
      const mark = (text, q) => {
        if (!q) return esc(text);
        const i = text.toLowerCase().indexOf(q);
        return i < 0 ? esc(text) : `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
      };
      const draw = () => {
        list.innerHTML = items.length
          ? items.map((it, i) => (it.group ? `<div class="palette-group">${esc(it.group)}</div>` : `<div class="palette-item ${i === sel ? 'sel' : ''}" data-i="${i}" role="option">${it.iconHtml}<div class="grow"><div class="t">${it.title}</div>${it.sub ? `<div class="s">${it.sub}</div>` : ''}</div>${it.right || ''}</div>`)).join('')
          : `<div class="empty">${input.value ? 'No matches' : 'Type to search'}</div>`;
      };
      const selectable = () => items.map((it, i) => (it.group ? -1 : i)).filter((i) => i >= 0);
      const update = async () => {
        const q = input.value.trim().toLowerCase();
        const my = ++seq;
        const actions = [
          { title: 'New PRD', sub: 'Create a draft from template', iconHtml: icon('plus'), run: () => newDraftDialog() },
          { title: 'Import Markdown file', sub: 'Turn existing .md into a draft', iconHtml: icon('download'), run: () => newDraftDialog({ tab: 'import' }) },
          { title: 'Fetch space now', sub: 'Pull changes from Confluence', iconHtml: icon('refresh'), run: () => startPull() },
          { title: 'Settings', sub: 'Auto fetch, theme', iconHtml: icon('settings'), run: () => settingsDialog() },
        ].filter((a) => !q || a.title.toLowerCase().includes(q));
        const drafts = state.drafts.filter((d) => !q || d.title.toLowerCase().includes(q)).slice(0, 5).map((d) => ({ title: mark(d.title, q), sub: esc(d.name), iconHtml: icon('file'), run: () => navigate(`#/draft/${encodeURIComponent(d.name)}`) }));
        const pages = (q ? nodes.filter((n) => n.t.toLowerCase().includes(q) || (n.g || []).some((l) => l.includes(q.replace(/^label:/, '')))) : [...nodes].filter((n) => n.d === 'prd').sort((a, b2) => String(b2.u).localeCompare(String(a.u))))
          .sort((a, b2) => (a.l === 'archived') - (b2.l === 'archived'))
          .slice(0, 30)
          .map((n) => ({ title: mark(n.t, q), sub: esc(breadcrumb(tree, n.p)), iconHtml: `<span class="dot dot-${n.d}"></span>`, right: n.l === 'archived' ? '<span class="pill">ARCHIVE</span>' : statusPill(n.s), run: () => navigate(`#/page/${n.id}`) }));
        items = [
          ...(drafts.length ? [{ group: 'Drafts' }, ...drafts] : []),
          ...(pages.length ? [{ group: q ? 'Pages' : 'Recent PRDs' }, ...pages] : []),
          ...(actions.length ? [{ group: 'Actions' }, ...actions] : []),
        ];
        sel = selectable()[0] ?? 0;
        draw();
        if (q.length >= 3 && pages.length < 8) {
          const { results } = await api.search(q).catch(() => ({ results: [] }));
          if (my !== seq) return;
          const extra = results.filter((r) => !r.titleHit).slice(0, 15).map((r) => ({ title: esc(r.title), sub: mark(`…${r.snippet}…`, q), iconHtml: `<span class="dot dot-${r.docType}"></span>`, run: () => navigate(`#/page/${r.id}`) }));
          if (extra.length) {
            items.splice(items.findIndex((it) => it.group === 'Actions') >= 0 ? items.findIndex((it) => it.group === 'Actions') : items.length, 0, { group: 'In page content' }, ...extra);
            sel = selectable()[0] ?? 0;
            draw();
          }
        }
      };
      const debounced = debounce(update, 90);
      input.addEventListener('input', debounced);
      input.addEventListener('keydown', (e) => {
        const idx = selectable();
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const pos = idx.indexOf(sel);
          sel = idx[(pos + (e.key === 'ArrowDown' ? 1 : -1) + idx.length) % idx.length];
          draw();
          list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' && items[sel]?.run) {
          close();
          items[sel].run();
        }
      });
      list.addEventListener('click', (e) => {
        const it = e.target.closest('[data-i]');
        if (!it) return;
        close();
        items[Number(it.dataset.i)].run();
      });
      update();
    },
  });
}

// ---------------- settings ----------------
async function settingsDialog() {
  const s = await api.settings();
  const theme = localStorage.getItem('cn-theme') || 'system';
  await dialog({
    title: 'Settings',
    subtitle: `${esc(state.status?.email || '')} · ${esc(state.status?.baseUrl || '')}`,
    render(b, close) {
      b.innerHTML = `
        <div class="dialog-body">
          <div class="field"><label>Auto fetch from Confluence</label><select class="select" name="interval">
            ${[[0, 'Off (manual only)'], [15, 'Every 15 minutes'], [30, 'Every 30 minutes'], [60, 'Every hour'], [240, 'Every 4 hours']].map(([v, l]) => `<option value="${v}" ${Number(s.autoFetchMinutes) === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></div>
          <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="onStart" ${s.autoFetchOnStart ? 'checked' : ''}> Fetch when the server starts</label>
          <div class="field"><label>Theme</label><div class="mode-switch" data-theme-switch>${['system', 'light', 'dark'].map((t) => `<button data-t="${t}" aria-pressed="${t === theme}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
          <div class="field"><label>Maintenance</label><div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm" data-full>${icon('refresh')} Full re-fetch</button>
            <button class="btn btn-sm" data-reconvert>${icon('undo')} Re-convert cached pages</button></div></div>
        </div>
        <div class="dialog-foot"><button class="btn" data-x>Close</button><button class="btn btn-primary" data-ok>Save</button></div>`;
      b.querySelector('[data-theme-switch]').addEventListener('click', (e) => {
        const t = e.target.closest('[data-t]')?.dataset.t;
        if (!t) return;
        localStorage.setItem('cn-theme', t);
        if (t === 'system') delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = t;
        b.querySelectorAll('[data-t]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.t === t)));
      });
      b.querySelector('[data-full]').onclick = () => (close(), startPull({ full: true }));
      b.querySelector('[data-reconvert]').onclick = () => (close(), startPull({ reconvert: true }));
      b.querySelector('[data-x]').onclick = () => close();
      b.querySelector('[data-ok]').onclick = async () => {
        await api.saveSettings({ autoFetchMinutes: Number(b.querySelector('[name="interval"]').value), autoFetchOnStart: b.querySelector('[name="onStart"]').checked });
        toast('Settings saved');
        close();
      };
    },
  });
}

// ---------------- move pages ----------------
const PLACE = { append: 'inside', before: 'above', after: 'below' };

/** Confirm, move in Confluence, refresh the tree, offer undo. */
async function movePageFlow(id, position, targetId, { confirm = true } = {}) {
  const tree = state.tree;
  const node = tree.nodes[id];
  const target = tree.nodes[targetId];
  const newParent = position === 'append' ? targetId : target.p;
  if (confirm) {
    const ok = await dialog({
      title: 'Move page in Confluence?',
      subtitle: 'This changes the page tree in Confluence for everyone. Child pages move along.',
      render(b, close) {
        b.innerHTML = `<div class="dialog-body"><dl class="kv">
            <dt>Page</dt><dd><strong>${esc(node.t)}</strong>${node.c?.length ? ` <span class="muted">+ ${node.c.length} child page${node.c.length > 1 ? 's' : ''}</span>` : ''}</dd>
            <dt>From</dt><dd>${esc(breadcrumb(tree, node.p) || 'Space home')}</dd>
            <dt>To</dt><dd>${esc(breadcrumb(tree, newParent) || 'Space home')}${position === 'append' ? '' : ` <span class="muted">(${PLACE[position]} “${esc(target.t)}”)</span>`}</dd>
          </dl></div>
          <div class="dialog-foot"><button class="btn" data-x>Cancel</button><button class="btn btn-primary" data-ok>${icon('tree')} Move page</button></div>`;
        b.querySelector('[data-x]').onclick = () => close(false);
        b.querySelector('[data-ok]').onclick = () => close(true);
      },
    });
    if (!ok) return;
  }
  const done = toast(`Moving “${esc(node.t)}”…`, { timeout: 0 });
  try {
    const r = await api.move(id, position, targetId);
    await loadTree();
    state.expanded.add(newParent);
    revealInTree(id);
    done();
    toast(`Moved “${esc(node.t)}”`, {
      timeout: 8000,
      action: r.undo && confirm ? { label: 'Undo', onClick: () => movePageFlow(id, r.undo.position, r.undo.targetId, { confirm: false }) } : undefined,
    });
  } catch (e) {
    done();
    toast(`Move failed: ${esc(e.message)}`, { type: 'error', timeout: 7000 });
  }
}

enableTreeDnd({
  el: $('#tree'),
  getTree: () => state.tree,
  onMove: (id, position, targetId) => movePageFlow(id, position, targetId),
  expand: (id, row) => {
    if (!state.expanded.has(id)) toggleNode(id, row);
  },
});

// ---------------- global events ----------------
document.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (actionEl) {
    if (['palette', 'new-draft', 'settings'].includes(actionEl.dataset.action) && document.querySelector('.overlay:not(.closing)')) return;
    const a = actionEl.dataset.action;
    if (a === 'pull') startPull();
    else if (a === 'palette') openPalette();
    else if (a === 'new-draft') newDraftDialog();
    else if (a === 'settings') settingsDialog();
    else if (a === 'open-drawer') {
      app.classList.add('drawer-open');
      if (actionEl.dataset.nav === 'space') setTab('space');
    } else if (a === 'close-drawer') app.classList.remove('drawer-open');
    return;
  }
  const tab = e.target.closest('[data-tab]');
  if (tab) return setTab(tab.dataset.tab);
  const chip = e.target.closest('[data-filter]');
  if (chip) {
    state.filter = chip.dataset.filter;
    localStorage.setItem('cn-filter', state.filter);
    renderFilters();
    renderTree();
    return;
  }
  const add = e.target.closest('[data-add]');
  if (add) {
    if (!document.querySelector('.overlay:not(.closing)')) newDraftDialog({ parentId: add.dataset.add });
    return;
  }
  const row = e.target.closest('.tree-row');
  if (row) {
    const id = row.dataset.id;
    if (e.target.closest('[data-toggle]')) return toggleNode(id, row);
    const hasKids = row.hasAttribute('aria-expanded');
    if (hasKids && row.getAttribute('aria-expanded') === 'false') toggleNode(id, row);
    navigate(`#/page/${id}`);
    return;
  }
  const d = e.target.closest('.draft-item');
  if (d) navigate(`#/draft/${encodeURIComponent(d.dataset.name)}`);
});

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k' && !e.target.closest?.('.md-input') && !document.querySelector('.overlay:not(.closing)')) {
    e.preventDefault();
    openPalette();
  }
  if (mod && e.altKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    newDraftDialog();
  }
});

// Drop .md files anywhere (outside the editor) to import them
document.addEventListener('dragover', (e) => {
  if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file') && !e.target.closest?.('.md-input, .rich-doc, .dropzone')) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (e.target.closest?.('.md-input, .rich-doc, .dropzone')) return;
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.some((f) => /\.(md|markdown|mdx|txt|html?)$/i.test(f.name))) return;
  e.preventDefault();
  if (!document.querySelector('.overlay:not(.closing)')) newDraftDialog({ tab: 'import', files, parentId: state.current?.type === 'page' ? state.current.id : undefined });
});

// Swipe from the left edge opens the drawer on touch devices
let touchX = null;
document.addEventListener('touchstart', (e) => (touchX = e.touches[0].clientX < 24 ? e.touches[0].clientX : null), { passive: true });
document.addEventListener('touchend', (e) => {
  if (touchX !== null && e.changedTouches[0].clientX - touchX > 60) app.classList.add('drawer-open');
  touchX = null;
}, { passive: true });

function initSpaceSelector() {
  const sel = $('#space-select');
  if (!sel) return;
  if (state.status?.spaces?.length) {
    sel.innerHTML = state.status.spaces.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${esc(s.key)})</option>`).join('');
  }
  if (state.status?.activeSpace) {
    sel.value = state.status.activeSpace;
  }
  sel.onchange = async () => {
    const target = sel.value;
    try {
      $('#sync').classList.add('busy', 'indeterminate');
      renderSync('Switching space…');
      await api.switchSpace(target);
      state.status = await api.status();
      state.expanded.clear();
      await Promise.all([loadTree(), loadDrafts()]);
      renderSync();
      renderFilters();
      setTab('space');
      location.hash = '#/';
      toast(`Switched space to ${esc(state.status.space?.name || target)}`);
    } catch (e) {
      toast(`Failed to switch space: ${esc(e.message)}`, { type: 'error' });
      if (state.status?.activeSpace) sel.value = state.status.activeSpace;
    } finally {
      $('#sync').classList.remove('busy', 'indeterminate');
    }
  };
}

// ---------------- present / read mode ----------------
const PRESENT_ZOOM_LEVELS = [0.85, 1.0, 1.15, 1.3, 1.5];
let presentZoomIdx = 2; // default 1.15 (115%)
let isPresentMode = false;
let presentExitCallback = null;

function updatePresentZoom() {
  const scale = PRESENT_ZOOM_LEVELS[presentZoomIdx];
  document.documentElement.style.setProperty('--present-scale', scale);
  const valEl = $('#present-zoom-val');
  if (valEl) valEl.textContent = `${Math.round(scale * 100)}%`;
}

function setupPresentToc(headings = []) {
  const container = $('#present-toc-content');
  if (!container) return;
  const valid = (headings || []).filter((h) => h.text && h.depth >= 2 && h.depth <= 3);
  if (!valid.length) {
    container.innerHTML = '<div class="empty-toc">No section headings found</div>';
    return;
  }
  container.innerHTML = valid
    .map((h) => `<a href="#" data-id="${esc(h.id)}" class="l${h.depth}">${esc(h.text)}</a>`)
    .join('');

  container.onclick = (e) => {
    const a = e.target.closest('a[data-id]');
    if (!a) return;
    e.preventDefault();
    const el = document.getElementById(a.dataset.id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const drawer = $('#present-toc-drawer');
      if (drawer) drawer.hidden = true;
    }
  };
}

export function enterPresentMode({ title = '', headings = [], onExit = null } = {}) {
  if (isPresentMode) return;
  isPresentMode = true;
  presentExitCallback = onExit;
  app.classList.add('present-mode');
  const bar = $('#present-bar');
  if (bar) bar.hidden = false;
  const titleEl = $('#present-doc-title');
  if (titleEl) titleEl.textContent = title;

  setupPresentToc(headings);
  updatePresentZoom();
  hydrateIcons($('#present-bar'));
}

export function exitPresentMode() {
  if (!isPresentMode) return;
  isPresentMode = false;
  app.classList.remove('present-mode');
  const bar = $('#present-bar');
  if (bar) bar.hidden = true;
  const drawer = $('#present-toc-drawer');
  if (drawer) drawer.hidden = true;
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
  if (typeof presentExitCallback === 'function') {
    presentExitCallback();
    presentExitCallback = null;
  }
}

export function togglePresentMode() {
  if (isPresentMode) {
    exitPresentMode();
    return;
  }
  if (state.current?.type === 'page') {
    const p = state.tree?.nodes?.[state.current.id];
    const title = p?.t || view.querySelector('.doc h1')?.textContent || 'Document';
    const hs = Array.from(view.querySelectorAll('[data-body] h2, [data-body] h3')).map((el) => ({
      id: el.id,
      text: el.textContent,
      depth: Number(el.tagName.slice(1)),
    }));
    enterPresentMode({ title, headings: hs });
  } else if (state.current?.type === 'draft') {
    const btn = topActions.querySelector('[data-act="present"]');
    if (btn) btn.click();
  }
}

window.enterPresentMode = enterPresentMode;
window.exitPresentMode = exitPresentMode;
window.togglePresentMode = togglePresentMode;

function initPresentControls() {
  $('#present-exit-btn')?.addEventListener('click', exitPresentMode);
  $('#present-toc-btn')?.addEventListener('click', () => {
    const d = $('#present-toc-drawer');
    if (d) d.hidden = !d.hidden;
  });
  $('#present-toc-close')?.addEventListener('click', () => {
    const d = $('#present-toc-drawer');
    if (d) d.hidden = true;
  });
  $('#present-zoom-in')?.addEventListener('click', () => {
    if (presentZoomIdx < PRESENT_ZOOM_LEVELS.length - 1) {
      presentZoomIdx++;
      updatePresentZoom();
    }
  });
  $('#present-zoom-out')?.addEventListener('click', () => {
    if (presentZoomIdx > 0) {
      presentZoomIdx--;
      updatePresentZoom();
    }
  });
  $('#present-fs-btn')?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  });

  document.addEventListener('fullscreenchange', () => {
    const fsBtn = $('#present-fs-btn');
    if (fsBtn) {
      fsBtn.innerHTML = document.fullscreenElement ? icon('minimize') : icon('maximize');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isPresentMode) {
      const drawer = $('#present-toc-drawer');
      if (drawer && !drawer.hidden) {
        drawer.hidden = true;
      } else {
        exitPresentMode();
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      togglePresentMode();
    }
  });
}

// ---------------- boot ----------------
(async function boot() {
  hydrateIcons();
  renderFilters();
  setTab('space');
  initPresentControls();
  try {
    state.status = await api.status();
    if (state.status.busy === 'pull') $('#sync').classList.add('busy', 'indeterminate');
    initSpaceSelector();
  } catch {}
  await Promise.all([loadTree(), loadDrafts()]);
  renderSync();
  if (state.status?.busy === 'pull') renderSync('Fetching…');
  route();
})();
