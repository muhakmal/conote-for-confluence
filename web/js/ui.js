// Tiny UI toolkit: element builder, icons, toasts, dialogs, menus.

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z"/>',
  tree: '<path d="M21 12h-8M21 6H8M21 18h-8M3 6v4a2 2 0 0 0 2 2h3M3 10v6a2 2 0 0 0 2 2h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
  italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
  strike: '<path d="M16 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H7M4 12h16"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  olist: '<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  checklist: '<path d="m3 7 2 2 4-4M3 17l2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  details: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
  diagram: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M7 10v4a3 3 0 0 0 3 3h4"/>',
  sequence: '<path d="M6 3v18M18 3v18M6 8h12M18 14H6"/><path d="m15 5 3 3-3 3M9 11l-3 3 3 3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.5-3.5L9 20"/>',
  tag: '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/>',
  publish: '<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/>',
  download: '<path d="M12 4v12M6 10l6 6 6-6M4 20h16"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  word: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13l1.5 5 1.5-4 1.5 4L14 13"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  toc: '<path d="M4 6h16M4 12h10M4 18h13"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  hr: '<path d="M3 12h18"/>',
  quote: '<path d="M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  label: '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/>',
  present: '<path d="M2 4h20v13H2z"/><path d="M12 17v4M8 21h8"/><path d="m10 8 5 2.5-5 2.5z"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10M6 10h10"/>',
};

export function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (!el.firstChild) el.innerHTML = icon(el.dataset.icon);
  });
  root.querySelectorAll('[data-action="close-drawer"].icon-btn:empty').forEach((el) => (el.innerHTML = icon('close')));
}

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.flush = (...a) => {
    clearTimeout(t);
    fn(...a);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function toast(message, { type = 'info', timeout = 3800, action } = {}) {
  const el = h(`<div class="toast ${type === 'error' ? 'error' : ''}" role="status">${icon(type === 'error' ? 'info' : 'check')}<span>${message}</span></div>`);
  if (action) {
    const a = h(`<a href="${esc(action.href || '#')}" ${action.href ? 'target="_blank" rel="noopener"' : ''}>${esc(action.label)}</a>`);
    if (action.onClick) a.addEventListener('click', (e) => (e.preventDefault(), action.onClick()));
    el.append(a);
  }
  document.getElementById('toasts').append(el);
  const close = () => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  if (timeout) setTimeout(close, timeout);
  el.addEventListener('click', (e) => e.target.tagName !== 'A' && close());
  return close;
}

/** Modal dialog. `render(body, close)` fills content; resolves with close(value). */
export function dialog({ title, subtitle = '', className = '', render, dismissable = true }) {
  return new Promise((resolve) => {
    const overlay = h(`<div class="overlay" role="dialog" aria-modal="true"><div class="dialog ${className}">${title ? `<div class="dialog-head"><h2>${esc(title)}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>` : ''}<div class="dialog-content"></div></div></div>`);
    const prevFocus = document.activeElement;
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      overlay.classList.add('closing');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => {
        overlay.remove();
        // don't steal focus (and the caret) back if the caller already moved it
        if (!document.activeElement || document.activeElement === document.body) prevFocus?.focus?.({ preventScroll: true });
      }, 170);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation();
        close(undefined);
      }
    };
    overlay.addEventListener('mousedown', (e) => e.target === overlay && dismissable && close(undefined));
    document.addEventListener('keydown', onKey, true);
    render(overlay.querySelector('.dialog-content'), close, overlay);
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.querySelector('[autofocus], input, select, .btn-primary')?.focus());
  });
}

export function confirmDialog({ title, message, confirm = 'Confirm', danger = false }) {
  return dialog({
    title,
    subtitle: message,
    render(body, close) {
      body.innerHTML = `<div class="dialog-foot"><button class="btn" data-x>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirm)}</button></div>`;
      body.querySelector('[data-x]').onclick = () => close(false);
      body.querySelector('[data-ok]').onclick = () => close(true);
    },
  });
}

let openMenu = null;
/** Anchored popover menu. items: [{icon, label, hint, onClick, href, divider}] */
export function menu(anchor, items) {
  closeMenu();
  const el = h('<div class="menu" role="menu"></div>');
  for (const it of items) {
    if (it.divider) {
      el.append(h('<hr>'));
      continue;
    }
    const b = h(`<${it.href ? 'a' : 'button'} role="menuitem" ${it.href ? `href="${esc(it.href)}" target="_blank" rel="noopener"` : ''}>${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ''}</${it.href ? 'a' : 'button'}>`);
    b.addEventListener('click', () => {
      closeMenu();
      it.onClick?.();
    });
    el.append(b);
  }
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  el.style.top = `${Math.min(r.bottom + 6, innerHeight - el.offsetHeight - 8)}px`;
  el.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
  openMenu = el;
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  return el;
}
function outside(e) {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
}
export function closeMenu() {
  document.removeEventListener('pointerdown', outside, true);
  if (openMenu) {
    const m = openMenu;
    openMenu = null;
    m.style.transition = 'opacity .12s';
    m.style.opacity = '0';
    setTimeout(() => m.remove(), 120);
  }
}

export const DOC_TYPE_LABEL = {
  prd: 'PRD', tad: 'TAD', deployment: 'Deployment', 'user-requirement': 'User Req', 'business-requirement': 'Business Req', 'system-design': 'System Design',
  'api-doc': 'API Doc', release: 'Release', uat: 'UAT', 'product-update': 'Update', notes: 'Notes', postmortem: 'Post-mortem', section: 'Section', page: 'Page', home: 'Home', folder: 'Folder',
};

export function statusPill(s) {
  if (!s) return '';
  const u = String(s).toUpperCase();
  const c = /FINAL|APPROVED|DONE/.test(u) ? 'green' : /DRAFT/.test(u) ? '' : /PROGRESS|REVIEW|DEVELOPMENT/.test(u) ? 'blue' : /RELEASED/.test(u) ? 'green' : 'yellow';
  return `<span class="pill ${c ? `pill-${c}` : ''}">${esc(u)}</span>`;
}
