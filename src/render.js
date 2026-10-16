// Server-side rendering: Markdown draft → Confluence storage / standalone HTML.
import fs from 'node:fs';
import path from 'node:path';
import { Marked } from 'marked';
import { createMarkdown, propertiesTable, escapeHtml } from '../web/lib/notebook-md.js';
import { renderDiagram } from './diagrams.js';
import { ROOT, config } from './config.js';
import { resolveUsers } from './users.js';
import { htmlToXhtml, inlineTagToXhtml, toXmlEntities, checkXhtml, repairXhtml } from './xhtml.js';

const isRemote = (href) => /^(https?:|data:)/i.test(href);

/** Resolve a local image reference (relative to the draft, or a pulled workspace attachment). */
export function resolveLocalImage(href, baseDir) {
  if (isRemote(href)) return null;
  const clean = decodeURIComponent(href.split(/[?#]/)[0]);
  const att = clean.match(/(?:^|\/)(_attachments\/\d+\/[^/]+)$/);
  const candidates = [path.resolve(baseDir, clean), att && path.resolve(config.workspaceDir, att[1])].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}

const diagramKey = (kind, code) => `${kind}\n${String(code).trim()}`;

/**
 * Render every diagram fence that the Markdown parser actually sees (including fences nested in
 * lists or quotes, and excluding examples inside other code blocks), keyed by content.
 */
async function renderAllDiagrams(body, title) {
  const found = new Map();
  const probe = createMarkdown(Marked, { target: 'html', diagram: (kind, code) => (found.set(diagramKey(kind, code), { kind, code }), '') });
  probe.render(stripLeadingTitle(body, title));
  const out = new Map();
  for (const [key, d] of found) out.set(key, await renderDiagram(d.kind, d.code));
  return out;
}

/**
 * @returns {Promise<{ storage: string, attachments: {filename:string, buffer:Buffer, contentType:string}[] }>}
 */
export const PEOPLE_FIELDS = ['owner', 'designer', 'tech_lead', 'qa'];
export function mentionedNames(meta, body) {
  const names = [...body.matchAll(/@\[([^\]\n]{1,80})\](?!\()/g)].map((m) => m[1].trim());
  for (const k of PEOPLE_FIELDS) for (const v of [].concat(meta[k] ?? [])) if (v) names.push(String(v).replace(/^@\[?|\]$/g, '').trim());
  return names;
}

export async function toStorage(meta, body, { baseDir = config.draftsDir, onWarning = () => {} } = {}) {
  const diagrams = await renderAllDiagrams(body, meta.title);
  const people = await resolveUsers(mentionedNames(meta, body));
  const unresolved = [...people].filter(([, id]) => !id).map(([n]) => n);
  if (unresolved.length) onWarning(`No Confluence user found for: ${unresolved.join(', ')} (published as plain text)`);
  const mention = (name) => people.get(String(name).trim()) || null;
  const attachments = new Map();
  const imageToStorage = (href, alt, extra) => {
    const w = extra && typeof extra === 'object' && extra.width ? ` ac:width="${Math.round(extra.width)}"` : '';
    if (isRemote(href)) return `<ac:image ac:align="left" ac:alt="${escapeHtml(alt)}"><ri:url ri:value="${escapeHtml(href)}" /></ac:image>`;
    const file = resolveLocalImage(href, baseDir);
    if (!file) return `<em>[missing image: ${escapeHtml(href)}]</em>`;
    const filename = path.basename(file);
    attachments.set(filename, { filename, buffer: fs.readFileSync(file), contentType: mimeOf(filename) });
    return `<ac:image ac:align="left" ac:alt="${escapeHtml(alt || filename)}"${w}><ri:attachment ri:filename="${escapeHtml(filename)}" /></ac:image>`;
  };
  // [📎 file.html](_attachments/<pageId>/file.html) → a real attachment link, not a dead relative href
  const linkToStorage = (href, inner) => {
    if (isRemote(href) || !/(?:^|\/)_attachments\/\d+\/[^/]+$/.test(decodeURIComponent(href.split(/[?#]/)[0]))) return null;
    const file = resolveLocalImage(href, baseDir);
    const filename = file ? path.basename(file) : decodeURIComponent(href.split(/[?#]/)[0]).split('/').pop();
    if (file) attachments.set(filename, { filename, buffer: fs.readFileSync(file), contentType: mimeOf(filename) });
    return `<ac:link><ri:attachment ri:filename="${escapeHtml(filename)}" /><ac:link-body>${inner || escapeHtml(filename)}</ac:link-body></ac:link>`;
  };
  const md = createMarkdown(Marked, {
    target: 'storage',
    link: linkToStorage,
    mention,
    rawHtml: (html) => htmlToXhtml(html, { image: imageToStorage }),
    inlineHtml: (html) => inlineTagToXhtml(html, { image: imageToStorage }),
    diagram(kind, code) {
      const d = diagrams.get(diagramKey(kind, code));
      const filename = `diagram-${d.kind}-${d.hash}.png`;
      attachments.set(filename, { filename, buffer: d.png, contentType: 'image/png' });
      const width = Math.min(Math.round(d.width / 2), 1200);
      return (
        `<ac:image ac:align="left" ac:alt="${filename}" ac:width="${width}"><ri:attachment ri:filename="${filename}" /></ac:image>\n` +
        `<ac:structured-macro ac:name="expand" ac:schema-version="1"><ac:parameter ac:name="title">Diagram source (${kind})</ac:parameter><ac:rich-text-body>` +
        `<ac:structured-macro ac:name="code" ac:schema-version="1"><ac:parameter ac:name="wrap">true</ac:parameter><ac:plain-text-body><![CDATA[${code.replace(/]]>/g, ']]]]><![CDATA[>')}]]></ac:plain-text-body></ac:structured-macro>` +
        `</ac:rich-text-body></ac:structured-macro>\n`
      );
    },
    image: imageToStorage,
  });
  const innerContent = repairXhtml(toXmlEntities(propertiesTable(meta, 'storage', { mention }) + md.render(stripLeadingTitle(body, meta.title))));
  // Wrap in full-width layout so Confluence renders the page at maximum width
  const storage = `<ac:layout><ac:layout-section ac:type="full-width" ac:breakout-mode="full-width"><ac:layout-cell>\n${innerContent}\n</ac:layout-cell></ac:layout-section></ac:layout>`;
  const check = checkXhtml(storage);
  if (!check.ok) {
    const err = new Error(`Not published: the page would be malformed in Confluence (${check.error}). Near: …${check.context.replace(/\s+/g, ' ')}…`);
    err.code = 'INVALID_STORAGE';
    throw err;
  }
  return { storage, attachments: [...attachments.values()] };
}

/**
 * Fast structural check without rendering diagrams: would this draft produce valid storage?
 * @returns {{ ok: boolean, error?: string, context?: string }}
 */
export function validateStorage(meta, body, { baseDir = config.draftsDir } = {}) {
  try {
    const stubImage = () => '<ac:image><ri:attachment ri:filename="x.png" /></ac:image>';
    const md = createMarkdown(Marked, {
      target: 'storage',
      mention: () => '000000000000000000000000',
      rawHtml: (html) => htmlToXhtml(html, { image: stubImage }),
      inlineHtml: (html) => inlineTagToXhtml(html, { image: stubImage }),
      diagram: () => '<ac:image><ri:attachment ri:filename="diagram.png" /></ac:image>',
      image: stubImage,
    });
    void baseDir;
    const innerContent = repairXhtml(toXmlEntities(propertiesTable(meta, 'storage', { mention: () => '000000000000000000000000' }) + md.render(stripLeadingTitle(body, meta.title))));
    const storage = `<ac:layout><ac:layout-section ac:type="full-width" ac:breakout-mode="full-width"><ac:layout-cell>\n${innerContent}\n</ac:layout-cell></ac:layout-section></ac:layout>`;
    return checkXhtml(storage);
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Confluence shows the page title itself — drop a duplicate "# Title" at the top. */
export function stripLeadingTitle(body, title) {
  const m = body.match(/^\s*#\s+(.+)\n/);
  return m && title && m[1].trim() === String(title).trim() ? body.slice(m[0].length) : body;
}

export function mimeOf(name) {
  const ext = path.extname(name).toLowerCase();
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.pdf': 'application/pdf', '.html': 'text/html', '.htm': 'text/html' }[ext] || 'application/octet-stream';
}

/** Body HTML with diagrams inlined as SVG and local images as data URIs (self-contained). */
export async function toHtmlFragment(meta, body, { baseDir = config.draftsDir } = {}) {
  const diagrams = await renderAllDiagrams(body).catch((e) => {
    throw new Error(`Diagram rendering failed: ${e.message}`);
  });
  const md = createMarkdown(Marked, {
    target: 'html',
    diagram: (kind, code) => `<figure class="diagram diagram-${kind}">${diagrams.get(diagramKey(kind, code)).svg.replace(/<\?xml[^>]*>/, '')}</figure>\n`,
    image(href, alt) {
      let src = href;
      const file = resolveLocalImage(href, baseDir);
      if (file) src = `data:${mimeOf(file)};base64,${fs.readFileSync(file).toString('base64')}`;
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
    },
  });
  const lead = /^\s*#\s+(.+)\n?/.exec(body);
  const title = lead ? md.render(`# ${lead[1]}`) : '';
  return title + propertiesTable(meta, 'html') + md.render(lead ? body.slice(lead[0].length) : body);
}

export async function toStandaloneHtml(meta, body, opts) {
  const fragment = await toHtmlFragment(meta, body, opts);
  const css = fs.readFileSync(path.join(ROOT, 'web/doc.css'), 'utf8');
  const title = escapeHtml(meta.title || 'Document');
  const hasTitle = /^\s*#\s+/.test(body);
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${css}</style>
</head>
<body>
<main class="doc">
${hasTitle ? '' : `<h1>${title}</h1>`}
${fragment}
</main>
</body>
</html>
`;
}
