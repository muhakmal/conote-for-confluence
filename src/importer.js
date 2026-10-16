// Import existing Markdown (GitHub, Obsidian, Notion/Typora exports, …) as a publishable draft.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { parseDoc } from './frontmatter.js';
import { slugify } from './classify.js';
import { newDraftPath } from './drafts.js';
import { stringifyDoc } from './frontmatter.js';
import { validateStorage } from './render.js';
import { readIndex } from './sync.js';
import { extractHeaderProperties, normalizePrdTitle, standardizeHeadings, reviewPrd } from './prd-standard.js';
import { createTurndown } from './storage2md.js';
import domino from '@mixmark-io/domino';

const KNOWN = ['title', 'parent_id', 'tribe', 'target_release', 'epic', 'doc_status', 'owner', 'designer', 'tech_lead', 'qa', 'labels'];
const ALIASES = { tags: 'labels', label: 'labels', status: 'doc_status', author: 'owner', authors: 'owner', 'tech-lead': 'tech_lead', techlead: 'tech_lead', release: 'target_release', parent: 'parent_id' };
const CALLOUTS = {
  NOTE: 'NOTE', INFO: 'NOTE', ABSTRACT: 'NOTE', SUMMARY: 'NOTE', TLDR: 'NOTE', TODO: 'NOTE', QUESTION: 'NOTE', HELP: 'NOTE', FAQ: 'NOTE', EXAMPLE: 'NOTE', QUOTE: 'NOTE', CITE: 'NOTE',
  TIP: 'TIP', HINT: 'TIP', SUCCESS: 'TIP', CHECK: 'TIP', DONE: 'TIP', IMPORTANT: 'WARNING', WARNING: 'WARNING', ATTENTION: 'WARNING',
  CAUTION: 'CAUTION', DANGER: 'CAUTION', ERROR: 'CAUTION', BUG: 'CAUTION', FAILURE: 'CAUTION', FAIL: 'CAUTION', MISSING: 'CAUTION',
};
const MERMAID_ALIASES = { mmd: 'mermaid', 'mermaid-js': 'mermaid', plantUML: 'plantuml', uml: 'plantuml', puml: 'plantuml' };

/** Apply fn to Markdown outside fenced code blocks. */
function outsideCode(md, fn) {
  const parts = md.split(/(^(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?\n(?:`{3,}|~{3,})[ \t]*$)/m);
  return parts.map((p, i) => (i % 2 ? p : fn(p))).join('');
}

/**
 * Pure normalisation step (no I/O).
 * @returns {{ meta: object, body: string, images: string[], warnings: string[] }}
 */
export function normalizeMarkdown(text, filename = 'imported.md', { stripNumbers = true } = {}) {
  const warnings = [];
  let src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const { meta: rawMeta, body: rawBody } = parseDoc(src);
  const meta = {};
  const dropped = [];
  for (const [k, v] of Object.entries(rawMeta || {})) {
    const key = ALIASES[k.toLowerCase()] || k.toLowerCase();
    if (KNOWN.includes(key) && v !== null && v !== '') meta[key] = typeof v === 'object' && !Array.isArray(v) ? String(v) : v;
    else dropped.push(k);
  }
  if (dropped.length) warnings.push(`Ignored frontmatter fields: ${dropped.join(', ')}`);
  let body = rawBody;

  // Title: frontmatter → first H1 (ATX or setext) → file name
  const atx = /^\s*#\s+(.+?)\s*#*\s*\n/.exec(body);
  const setext = /^\s*([^\n#>`|-][^\n]*)\n=+\s*\n/.exec(body);
  const h1 = atx?.[1] || setext?.[1];
  if (!meta.title) meta.title = h1 ? h1.replace(/[*_`]/g, '').trim() : path.basename(filename).replace(/\.(md|markdown|mdx|txt)$/i, '').replace(/[-_]+/g, ' ');
  if (h1 && h1.replace(/[*_`]/g, '').trim() === String(meta.title).trim()) body = body.slice((atx || setext)[0].length);

  // PRD standard: [PRD] title, Page Properties from the header table/lines, template section names
  const isPrd = /\bPRD\b/i.test(meta.title) || /^##\s+(\d+\.\s+)?(Objective|Success Metrics|Requirements)\b/im.test(body);
  if (isPrd) {
    meta.title = normalizePrdTitle(meta.title);
    const header = extractHeaderProperties(body);
    body = header.body;
    for (const [k, v] of Object.entries(header.meta)) if (meta[k] === undefined) meta[k] = v;
    if (header.found.length) warnings.push(`Page properties taken from the header: ${header.found.join(', ')}`);
    if (header.kept.length) warnings.push(`Kept in the document header (not Confluence page properties): ${header.kept.join(', ')}`);
    const h = standardizeHeadings(body, { stripNumbers });
    body = h.body;
    if (h.numbered && stripNumbers) warnings.push(`Removed numbering from ${h.numbered} headings (Confluence adds its own table of contents)`);
    meta.doc_status ||= 'DRAFT';
  }

  // Code fence language aliases
  body = body.replace(/^(`{3,}|~{3,})[ \t]*([\w+-]+)/gm, (m, fence, lang) => `${fence}${MERMAID_ALIASES[lang] || lang.toLowerCase()}`);

  const footnotes = new Map();
  body = outsideCode(body, (chunk) => {
    let s = chunk;
    // Obsidian embeds & wikilinks
    s = s.replace(/!\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g, (_, f) => (/\.(png|jpe?g|gif|svg|webp)$/i.test(f) ? `![${path.basename(f).replace(/\.\w+$/, '')}](${f.replace(/ /g, '%20')})` : `_${f}_`));
    s = s.replace(/\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]+))?\]\]/g, (_, page, anchor, alias) => alias || (anchor ? `${page} › ${anchor}` : page));
    // ==highlight== → bold
    s = s.replace(/==([^=\n]+)==/g, '**$1**');
    // Callouts: Obsidian types, fold markers, lowercase
    s = s.replace(/^(\s*>\s*)\[!(\w+)\][+-]?/gm, (m, q, kind) => `${q}[!${CALLOUTS[kind.toUpperCase()] || 'NOTE'}]`);
    // Footnote definitions (single line) and references
    s = s.replace(/^\[\^([^\]]+)\]:\s*(.+)$/gm, (_, id, t) => (footnotes.set(id, t), ''));
    return s;
  });
  if (footnotes.size) {
    const order = [...footnotes.keys()];
    body = outsideCode(body, (chunk) => chunk.replace(/\[\^([^\]]+)\]/g, (m, id) => (footnotes.has(id) ? `<sup>${order.indexOf(id) + 1}</sup>` : m)));
    body = `${body.trimEnd()}\n\n## Footnotes\n\n${order.map((id, i) => `${i + 1}. ${footnotes.get(id)}`).join('\n')}\n`;
  }
  // Tabs in list indentation and trailing spaces
  body = body.replace(/^\t+/gm, (t) => '    '.repeat(t.length)).replace(/\n{4,}/g, '\n\n\n');

  // Local images (markdown + <img>)
  const images = new Set();
  outsideCode(body, (chunk) => {
    for (const m of chunk.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) if (!/^(https?:|data:)/i.test(m[1])) images.add(m[1]);
    for (const m of chunk.matchAll(/<img[^>]+src\s*=\s*["']([^"']+)["']/gi)) if (!/^(https?:|data:)/i.test(m[1])) images.add(m[1]);
    return chunk;
  });
  if (isPrd) for (const n of reviewPrd(meta, body)) warnings.push(n.text);
  return { meta, body: body.replace(/^\n+/, ''), images: [...images], warnings };
}

/**
 * @param {{ filename: string, text: string, parentId?: string, assets?: Map<string, Buffer>, sourceDir?: string }} opts
 */
export function importMarkdown({ filename, text, parentId, assets = new Map(), sourceDir, stripNumbers = true }) {
  if (/\.html?$/i.test(filename)) {
    const converted = htmlToMarkdown(text, assets);
    text = converted.markdown;
    filename = filename.replace(/\.html?$/i, '.md');
  }
  const { meta, body: normalized, images, warnings } = normalizeMarkdown(text, filename, { stripNumbers });
  if (parentId) meta.parent_id = String(parentId);
  const parent = meta.parent_id ? readIndex()?.nodes?.[meta.parent_id] : null;
  if (meta.parent_id && !parent) warnings.push(`Parent page ${meta.parent_id} is not in the pulled index`);
  if (parent) meta.parent = parent.title;

  const abs = newDraftPath(meta.title, meta.parent_id);
  const draftDir = path.dirname(abs);
  const assetDir = path.join(config.draftsDir, 'assets', slugify(meta.title, 40));
  let body = normalized;
  let copied = 0;
  for (const ref of images) {
    const decoded = decodeURIComponent(ref.split(/[?#]/)[0]);
    const base = path.basename(decoded);
    let buf = assets.get(decoded) || assets.get(base) || null;
    if (!buf && sourceDir) {
      for (const cand of [path.resolve(sourceDir, decoded), path.resolve(sourceDir, 'attachments', base), path.resolve(sourceDir, 'assets', base)]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          buf = fs.readFileSync(cand);
          break;
        }
      }
    }
    if (!buf) {
      warnings.push(`Image not found, left as a link: ${ref}`);
      continue;
    }
    fs.mkdirSync(assetDir, { recursive: true });
    const safe = base.replace(/[^\w.-]+/g, '-');
    fs.writeFileSync(path.join(assetDir, safe), buf);
    const rel = path.relative(draftDir, path.join(assetDir, safe)).split(path.sep).join('/');
    body = body.split(`](${ref}`).join(`](${rel}`).split(`](<${ref}>`).join(`](${rel}`).split(`src="${ref}"`).join(`src="${rel}"`);
    copied++;
  }
  meta.doc_status ||= undefined;

  const check = validateStorage(meta, body, { baseDir: draftDir });
  if (!check.ok) warnings.push(`Needs a fix before publishing: ${check.error}`);
  fs.writeFileSync(abs, stringifyDoc(meta, body));
  return {
    name: path.relative(config.draftsDir, abs).split(path.sep).join('/'),
    title: meta.title,
    images: copied,
    publishable: check.ok,
    warnings,
  };
}

/**
 * HTML PRD (e.g. md2html_prd.py output, Google Docs/Word "save as HTML") → Markdown.
 * Diagram figures that carry their mermaid source become ```mermaid fences (the PNG is re-rendered on publish);
 * embedded data: images are extracted into `assets`.
 */
export function htmlToMarkdown(html, assets = new Map()) {
  const doc = domino.createDocument(html);
  const root = doc.querySelector('main') || doc.querySelector('article') || doc.body;
  const title = doc.querySelector('header h1, .hero h1')?.textContent.trim() || (root.querySelector('h1')?.textContent.trim() ?? doc.title);
  const metaSpans = Array.from(doc.querySelectorAll('header .meta span, .hero .meta span')).map((s) => s.textContent.trim()).filter((t) => /^[^:]{2,30}:\s*\S/.test(t));
  for (const sel of ['nav', 'script', 'style', 'noscript', 'footer', 'header.hero', 'figcaption', 'button', '.toc']) Array.from(root.querySelectorAll(sel)).forEach((n) => n.remove());
  Array.from(root.querySelectorAll('h1')).forEach((h) => h.textContent.trim() === title && h.remove());

  // diagrams with source code
  Array.from(root.querySelectorAll('figure')).forEach((fig) => {
    const code = fig.querySelector('details pre, pre.mermaid-code, pre.mermaid, code.language-mermaid');
    if (!code) return;
    const src = code.textContent.trim();
    const lang = /^\s*@start/.test(src) ? 'plantuml' : 'mermaid';
    const pre = doc.createElement('pre');
    pre.setAttribute('data-lang', lang);
    const c = doc.createElement('code');
    c.textContent = src;
    pre.appendChild(c);
    fig.replaceWith(pre);
  });
  Array.from(root.querySelectorAll('pre.mermaid, div.mermaid')).forEach((el) => {
    const pre = doc.createElement('pre');
    pre.setAttribute('data-lang', 'mermaid');
    const c = doc.createElement('code');
    c.textContent = el.textContent.trim();
    pre.appendChild(c);
    el.replaceWith(pre);
  });
  Array.from(root.querySelectorAll('pre > code[class*="language-"]')).forEach((code) => {
    const lang = /language-([\w+-]+)/.exec(code.className)?.[1];
    if (lang) code.parentElement.setAttribute('data-lang', lang);
  });
  Array.from(root.querySelectorAll('pre:not([data-lang])')).forEach((pre) => pre.setAttribute('data-lang', ''));
  // embedded images → asset files
  let n = 0;
  Array.from(root.querySelectorAll('img[src^="data:"]')).forEach((img) => {
    const m = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,(.+)$/.exec(img.getAttribute('src'));
    if (!m) return img.remove();
    const ext = m[1].replace('svg+xml', 'svg').replace('jpeg', 'jpg');
    const name = `image-${++n}.${ext}`;
    assets.set(name, Buffer.from(m[2], 'base64'));
    img.setAttribute('src', name);
  });
  Array.from(root.querySelectorAll('colgroup, .tablewrap > caption')).forEach((x) => x.remove());
  const md = createTurndown().turndown(root.innerHTML);
  const header = metaSpans.length ? `${metaSpans.map((t) => `**${t.split(':')[0].trim()}:** ${t.slice(t.indexOf(':') + 1).trim()}`).join('\n')}\n\n` : '';
  return { markdown: `# ${title}\n\n${header}${md.replace(/\n{3,}/g, '\n\n')}\n` };
}
