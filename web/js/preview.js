// Live document rendering in the browser (same renderer as publish/export).
import { Marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';
import { createMarkdown, propertiesTable, escapeHtml } from '/lib/notebook-md.js';
import { api } from './api.js';

const diagramCache = new Map(); // key → svg markup
let mermaidReady = null;

function isDark() {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
}

function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/mermaid.js';
      s.onload = () => {
        window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', fontFamily: 'inherit' });
        resolve(window.mermaid);
      };
      s.onerror = () => reject(new Error('Mermaid failed to load'));
      document.head.append(s);
    });
  }
  return mermaidReady;
}

const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** Rewrite image paths so the browser can load them through the local server. */
export function imageSrc(href, ctx) {
  if (/^(https?:|data:|blob:)/.test(href)) return href;
  const att = href.match(/(?:^|\/)_attachments\/(\d+)\/([^?#]+)/);
  if (att) return `/att/${att[1]}/${att[2]}`;
  if (ctx.draftDir !== undefined) {
    const parts = (ctx.draftDir ? ctx.draftDir.split('/') : []).concat(href.split('/'));
    const out = [];
    for (const p of parts) p === '..' ? out.pop() : p && p !== '.' && out.push(p);
    return `/draft-file/${out.map(encodeURIComponent).join('/')}`;
  }
  return href;
}

/**
 * Render meta + body into `container`. Diagrams render asynchronously and are cached,
 * so re-rendering while typing doesn't flicker.
 * @param {{ draftDir?: string, onPageLink?: (href:string)=>string|null }} ctx
 */
export function renderDocument(container, meta, body, ctx = {}) {
  const pending = [];
  const md = createMarkdown(Marked, {
    target: 'html',
    diagram(kind, code) {
      const key = `${kind}:${hash(code)}`;
      const cached = diagramCache.get(key);
      if (cached) return `<figure class="diagram diagram-${kind}" data-key="${key}">${cached}</figure>`;
      pending.push({ key, kind, code });
      return `<figure class="diagram diagram-${kind} diagram-box loading" data-key="${key}"></figure>`;
    },
    image(href, alt) {
      return `<img src="${escapeHtml(imageSrc(href, ctx))}" alt="${escapeHtml(alt)}" loading="lazy">`;
    },
  });
  // Title first, then the page-properties card, then the body
  let text = body || '';
  let title = meta?.title ? `<h1>${escapeHtml(meta.title)}</h1>` : '';
  const lead = /^\s*#\s+(.+)\n?/.exec(text);
  if (lead) {
    title = `<h1>${DOMPurify.sanitize(new Marked().parseInline(lead[1]))}</h1>`;
    text = text.slice(lead[0].length);
  }
  const html = title + propertiesTable(meta || {}, 'html') + md.render(text);
  const clean = DOMPurify.sanitize(html, { ADD_TAGS: ['details', 'summary', 'figure', 'nav'], ADD_ATTR: ['open', 'data-key', 'data-lang', 'loading', 'target', 'data-hint', 'contenteditable'] });

  // Morph-lite: keep open <details> state across re-renders
  const openSummaries = new Set([...container.querySelectorAll('details[open] > summary')].map((s) => s.textContent));
  container.innerHTML = clean;
  container.querySelectorAll('details > summary').forEach((s) => openSummaries.has(s.textContent) && s.parentElement.setAttribute('open', ''));
  container.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (/^#(?!\/)/.test(href)) {
      // in-document anchors (TOC) must not trigger the hash router
      a.addEventListener('click', (e) => {
        e.preventDefault();
        container.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } else if (/^https?:/.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener';
    } else if (ctx.onPageLink && !href.startsWith('#')) {
      const next = ctx.onPageLink(href);
      if (next) a.setAttribute('href', next);
    }
  });

  for (const job of pending) {
    renderDiagram(job).then(
      (svg) => {
        diagramCache.set(job.key, svg);
        container.querySelectorAll(`figure[data-key="${job.key}"]`).forEach((f) => {
          f.classList.remove('loading', 'diagram-box');
          f.innerHTML = svg;
          f.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
        });
      },
      (err) => {
        container.querySelectorAll(`figure[data-key="${job.key}"]`).forEach((f) => {
          f.classList.remove('loading');
          f.innerHTML = `<div class="diagram-error">${escapeHtml(job.kind)}: ${escapeHtml(String(err.message || err).split('\n').slice(0, 4).join('\n'))}</div>`;
        });
      },
    );
  }
  return md.headings();
}

const inflight = new Map();
export function renderDiagram({ key, kind, code }) {
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    if (kind === 'mermaid') {
      const mermaid = await loadMermaid();
      const id = `m${hash(key)}${Math.random().toString(36).slice(2, 6)}`;
      try {
        const { svg } = await mermaid.render(id, code);
        return svg;
      } finally {
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
      }
    }
    const svg = await api.plantuml(code);
    return `<img alt="PlantUML diagram" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Highlight the outline entry for the heading currently in view. */
export function scrollSpy(scroller, outline) {
  if (!outline) return () => {};
  const links = [...outline.querySelectorAll('a[data-id]')];
  const onScroll = () => {
    let current = null;
    const top = scroller.getBoundingClientRect().top + 90;
    for (const a of links) {
      const el = document.getElementById(a.dataset.id);
      if (el && el.getBoundingClientRect().top <= top) current = a;
    }
    links.forEach((a) => a.classList.toggle('active', a === current));
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  return () => scroller.removeEventListener('scroll', onScroll);
}

export { isDark };
