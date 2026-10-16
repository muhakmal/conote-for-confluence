// Confluence storage format (XHTML + ac:/ri: macros) → clean Markdown.
// Strategy: rewrite macros into plain HTML with data-* hints (innermost first),
// then let Turndown produce GFM with a few custom rules.
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const DIAGRAM_START = /^\s*(flowchart|graph\s+(TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|journey|pie\b|mindmap|timeline|gitGraph|C4Context|quadrantChart|sankey|block-beta|architecture)/;

export function detectCodeLanguage(code, declared = '') {
  if (/^\s*@start(uml|mindmap|gantt|salt|wbs|json|yaml)/.test(code)) return 'plantuml';
  if (DIAGRAM_START.test(code)) return 'mermaid';
  return declared && !['none', 'text'].includes(declared) ? declared : '';
}

function param(inner, name) {
  const m = inner.match(new RegExp(`<ac:parameter ac:name="${name}"[^>]*>([\\s\\S]*?)</ac:parameter>`));
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
}

function decodeEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/**
 * @param {string} storage
 * @param {{ pageId?: string, userName?: (id:string)=>string, pageLink?: (title:string)=>string|null, attachmentUrl?: (pageId:string, file:string)=>string }} ctx
 */
export function preprocessStorage(storage, ctx = {}) {
  let s = storage
    // normalise self-closing macros so body-matching regexes can't over-reach
    .replace(/<ac:structured-macro([^>]*?)\s*\/>/g, '<ac:structured-macro$1></ac:structured-macro>')
    .replace(/\s(local-id|ac:local-id|ac:macro-id|ac:schema-version|data-layout|data-table-width|data-highlight-colour)="[^"]*"/g, '');
  const attachmentUrl = ctx.attachmentUrl || ((pid, f) => `_attachments/${pid}/${encodeURIComponent(f)}`);

  // Code macros (no nesting inside) → <pre>
  s = s.replace(/<ac:structured-macro ac:name="(code|noformat)"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g, (_, _n, inner) => {
    const body = inner.match(/<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/);
    const code = body ? body[1].replace(/\]\]\]\]><!\[CDATA\[>/g, ']]>') : '';
    const lang = detectCodeLanguage(code, param(inner, 'language'));
    const title = param(inner, 'title');
    return `${title ? `<p><em>${esc(title)}</em></p>` : ''}<pre data-lang="${esc(lang)}"><code>${esc(code)}</code></pre>`;
  });
  // Any stray CDATA (HTML parsers would drop it)
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) => esc(c));

  // Status lozenge → inline token {status:TITLE|colour}
  s = s.replace(/<ac:structured-macro ac:name="status"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g, (_, inner) => {
    const title = param(inner, 'title') || 'STATUS';
    const colour = param(inner, 'colour').toLowerCase();
    return `<span data-status="${esc(title.toUpperCase())}" data-colour="${esc(colour)}"></span>`;
  });

  // Macros without bodies we can express
  s = s.replace(/<ac:structured-macro ac:name="toc"[^>]*>[\s\S]*?<\/ac:structured-macro>/g, '<p>[TOC]</p>');
  s = s.replace(/<ac:structured-macro ac:name="(page-signatures|roadmap|view-file|jira|children|pagetree|recently-updated|anchor)"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g, (m, name, rest) => {
    if (name === 'view-file') {
      const f = rest.match(/ri:filename="([^"]+)"/);
      if (f && ctx.pageId) return `<p><a href="${attachmentUrl(ctx.pageId, decodeEntities(f[1]))}">📎 ${esc(decodeEntities(f[1]))}</a></p>`;
    }
    if (name === 'jira') {
      const key = param(rest, 'key');
      return key ? `<code>${esc(key)}</code>` : '';
    }
    return `<p data-macro-placeholder="${name}"></p>`;
  });

  // Emoticons → emoji fallback
  s = s.replace(/<ac:emoticon[^>]*?(?:ac:emoji-fallback="([^"]*)")?[^>]*\/>/g, (m) => {
    const fb = m.match(/ac:emoji-fallback="([^"]*)"/)?.[1] || '';
    return /^:.*:$/.test(fb) ? '' : decodeEntities(fb);
  });

  // Images
  s = s.replace(/<ac:image([^>]*)>([\s\S]*?)<\/ac:image>/g, (_, attrs, inner) => {
    const alt = attrs.match(/ac:alt="([^"]*)"/)?.[1] || '';
    const att = inner.match(/<ri:attachment ri:filename="([^"]+)"/);
    const url = inner.match(/<ri:url ri:value="([^"]+)"/);
    const src = att && ctx.pageId ? attachmentUrl(ctx.pageId, decodeEntities(att[1])) : url ? url[1] : '';
    return src ? `<img src="${esc(src)}" alt="${alt || (att ? att[1] : '')}">` : '';
  });

  // Links: users, pages, attachments
  s = s.replace(/<ac:link[^>]*>([\s\S]*?)<\/ac:link>/g, (_, inner) => {
    const body = inner.match(/<ac:(?:plain-text-)?link-body>([\s\S]*?)<\/ac:(?:plain-text-)?link-body>/)?.[1];
    const user = inner.match(/<ri:user ri:account-id="([^"]+)"/);
    if (user) return `<span data-user>@${esc(ctx.userName ? ctx.userName(user[1]) : user[1])}</span>`;
    const page = inner.match(/<ri:page ri:content-title="([^"]+)"/);
    if (page) {
      const title = decodeEntities(page[1]);
      const href = ctx.pageLink?.(title);
      const text = body || esc(title);
      return href ? `<a href="${esc(href)}">${text}</a>` : `<em>${text}</em>`;
    }
    const att = inner.match(/<ri:attachment ri:filename="([^"]+)"/);
    if (att && ctx.pageId) return `<a href="${attachmentUrl(ctx.pageId, decodeEntities(att[1]))}">${body || esc(decodeEntities(att[1]))}</a>`;
    return body || '';
  });

  // Container macros, innermost first
  const container = /<ac:structured-macro ac:name="([\w-]+)"((?:(?!<ac:structured-macro)[\s\S])*?)<\/ac:structured-macro>/g;
  for (let guard = 0; guard < 50 && /<ac:structured-macro/.test(s); guard++) {
    const before = s;
    s = s.replace(container, (_, name, inner) => {
      const body = inner.match(/<ac:rich-text-body>([\s\S]*)<\/ac:rich-text-body>/)?.[1] ?? '';
      const title = param(inner, 'title');
      if (['info', 'note', 'warning', 'tip', 'panel', 'success', 'error'].includes(name)) {
        const kind = { note: 'WARNING', warning: 'CAUTION', tip: 'TIP', success: 'TIP', error: 'CAUTION' }[name] || 'NOTE';
        return `<blockquote data-callout="${kind}">${title ? `<p><strong>${esc(title)}</strong></p>` : ''}${body}</blockquote>`;
      }
      if (name === 'expand') return `<details data-title="${esc(title || 'Details')}">${body}</details>`;
      if (name === 'details') return `<div data-page-properties>${body}</div>`;
      return body; // unknown container: keep content
    });
    s = s.replace(/<ac:structured-macro ac:name="[\w-]+"[^>]*\/>/g, '');
    if (s === before) break;
  }

  // Layouts, adf extensions, inline comments, task lists
  s = s
    .replace(/<\/?ac:layout(-section|-cell)?[^>]*>/g, '')
    .replace(/<\/?ac:inline-comment-marker[^>]*>/g, '')
    .replace(/<ac:adf-extension>[\s\S]*?<ac:adf-fallback>([\s\S]*?)<\/ac:adf-fallback>[\s\S]*?<\/ac:adf-extension>/g, '$1')
    .replace(/<ac:task-list>([\s\S]*?)<\/ac:task-list>/g, '<ul>$1</ul>')
    .replace(/<ac:task>[\s\S]*?<ac:task-status>(\w+)<\/ac:task-status>[\s\S]*?<ac:task-body>([\s\S]*?)<\/ac:task-body>[\s\S]*?<\/ac:task>/g,
      (_, st, b) => `<li>${st === 'complete' ? '[x]' : '[ ]'} ${b}</li>`)
    .replace(/<p>\s*<ac:placeholder[^>]*>([\s\S]*?)<\/ac:placeholder>\s*<\/p>/g, (_, t) => `<p data-hint="">${t.replace(/<[^>]+>/g, '')}</p>`)
    .replace(/<ac:placeholder[^>]*>[\s\S]*?<\/ac:placeholder>/g, '')
    .replace(/<blockquote>\s*(<p data-hint="">[\s\S]*?<\/p>)\s*<\/blockquote>/g, '$1')
    .replace(/<blockquote>\s*<p>\s*(Type\s*\/\s*\w+\s+to add\b[^<]*)<\/p>\s*<\/blockquote>/gi, (_, t) => `<p data-hint="">${t.trim()}</p>`)
    .replace(/<\/?(ac|ri):[^>]*>/g, '')
    .replace(/<colgroup>[\s\S]*?<\/colgroup>/g, '')
    .replace(/<p\s*\/>/g, '')
    .replace(/<br\s*\/?>(?=\s*<\/(p|td|th|li)>)/g, '')
    .replace(/<p\s+style="[^"]*">/g, '<p>')
    .replace(/<(td|th)([^>]*)>\s*<p>((?:(?!<\/?p>)[\s\S])*)<\/p>\s*<\/\1>/g, '<$1$2>$3</$1>')
    .replace(/<li>\s*<p>((?:(?!<\/?p>)[\s\S])*)<\/p>(?=\s*(<\/li>|<ul|<ol))/g, '<li>$1')
    .replace(/<time datetime="(\d{4}-\d{2}-\d{2})[^"]*"\s*(?:\/>|><\/time>)/g, '{date:$1}')
    .replace(/<time datetime="([^"]+)"\s*\/>/g, '$1');
  return s;
}

const PROPERTY_KEYS = {
  tribe: 'tribe',
  'target release': 'target_release',
  epic: 'epic',
  'document status': 'doc_status',
  'document owner': 'owner',
  designer: 'designer',
  'tech lead': 'tech_lead',
  qa: 'qa',
};

/** Pull the PRD "page properties" table out of the body into metadata. */
export function extractProperties(html) {
  const meta = {};
  const out = html.replace(/<div data-page-properties>([\s\S]*?)<\/div>/, (whole, inner) => {
    let known = 0;
    for (const row of inner.matchAll(/<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g)) {
      const key = PROPERTY_KEYS[row[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim().toLowerCase()];
      if (!key) continue;
      known++;
      const statuses = [...row[2].matchAll(/data-status="([^"]+)"/g)].map((m) => m[1]);
      const users = [...row[2].matchAll(/<span data-user>@([^<]+)<\/span>/g)].map((m) => decodeEntities(m[1]));
      const text = decodeEntities(row[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
      const val = statuses.length ? statuses : users.length ? users : text && text !== '-' && !/^Type \/\//.test(text) ? [text] : [];
      if (val.length) meta[key] = val.length === 1 ? val[0] : val;
    }
    return known >= 2 ? '' : whole.replace('<div data-page-properties>', '<div>');
  });
  return { html: out, meta };
}

export function createTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    hr: '---',
  });
  td.use(gfm);
  td.keep(['sub', 'sup', 'u']);

  td.addRule('status', {
    filter: (n) => n.nodeName === 'SPAN' && n.hasAttribute('data-status'),
    replacement: (_, n) => {
      const c = n.getAttribute('data-colour');
      return ` {status:${n.getAttribute('data-status')}${c ? `|${c}` : ''}} `;
    },
  });
  td.addRule('fencedWithLang', {
    filter: (n) => n.nodeName === 'PRE' && n.hasAttribute('data-lang'),
    replacement: (_, n) => {
      const code = n.textContent.replace(/\n+$/, '');
      const fence = code.includes('```') ? '~~~~' : '```';
      return `\n\n${fence}${n.getAttribute('data-lang')}\n${code}\n${fence}\n\n`;
    },
  });
  td.addRule('mention', {
    filter: (n) => n.nodeName === 'SPAN' && n.hasAttribute('data-user'),
    replacement: (_, n) => `@[${n.textContent.replace(/^@/, '').trim()}]`,
  });
  td.addRule('callout', {
    filter: (n) => n.nodeName === 'BLOCKQUOTE' && n.hasAttribute('data-callout'),
    replacement: (content, n) => {
      const lines = content.trim().split('\n').map((l) => `> ${l}`.trimEnd());
      return `\n\n> [!${n.getAttribute('data-callout')}]\n${lines.join('\n')}\n\n`;
    },
  });
  td.addRule('expand', {
    filter: (n) => n.nodeName === 'DETAILS' && n.hasAttribute('data-title'),
    replacement: (content, n) => `\n\n<details>\n<summary>${n.getAttribute('data-title')}</summary>\n\n${content.trim()}\n\n</details>\n\n`,
  });
  td.addRule('hint', {
    filter: (n) => n.nodeName === 'P' && n.hasAttribute('data-hint'),
    replacement: (_, n) => {
      for (let p = n.parentNode; p; p = p.parentNode) if (/^(TD|TH|LI)$/.test(p.nodeName)) return '';
      return `\n\n<!-- ${n.textContent.replace(/--+/g, '-').trim()} -->\n\n`;
    },
  });
  td.addRule('placeholder', {
    filter: (n) => n.nodeName === 'P' && n.hasAttribute('data-macro-placeholder'),
    replacement: (_, n) => `\n\n<!-- confluence:${n.getAttribute('data-macro-placeholder')} -->\n\n`,
  });
  td.addRule('emptyParagraph', {
    filter: (n) => n.nodeName === 'P' && !n.textContent.trim() && !n.querySelector('img'),
    replacement: () => '\n',
  });
  // Tables with block content can't be GFM: keep them as tidy HTML.
  td.addRule('complexTable', {
    filter: (n) => n.nodeName === 'TABLE' && (isComplexTable(n) || !hasHeaderRow(n)),
    replacement: (_, n) => `\n\n${cleanTableHtml(n.outerHTML)}\n\n`,
  });
  return td;
}

function hasHeaderRow(table) {
  const first = table.querySelector('tr');
  return !!first && Array.from(first.childNodes).filter((c) => c.nodeType === 1).every((c) => c.nodeName === "TH");
}

function isComplexTable(table) {
  for (const cell of table.querySelectorAll('td, th')) {
    const blocks = cell.querySelectorAll('p, ul, ol, pre, table, blockquote, details, img, h1, h2, h3, h4');
    const paragraphs = cell.querySelectorAll('p');
    if (blocks.length > paragraphs.length || paragraphs.length > 1) return true;
    if (cell.hasAttribute('rowspan') || cell.hasAttribute('colspan')) return true;
  }
  return false;
}

function cleanTableHtml(html) {
  return html
    .replace(/<span data-status="([^"]*)" data-colour="([^"]*)"><\/span>/g, (_, t, c) => ` {status:${t}${c ? `|${c}` : ''}} `)
    .replace(/<p data-hint="">[\s\S]*?<\/p>/g, '')
    .replace(/<span data-user="">@([^<]*)<\/span>/g, '@[$1]')
    .replace(/\s(style|class|data-[\w-]+|width)="[^"]*"/g, '')
    .replace(/<colgroup>[\s\S]*?<\/colgroup>/g, '')
    .replace(/<p\s*\/>/g, '')
    .replace(/<br\s*\/?>(?=\s*<\/(p|td|th|li)>)/g, '')
    .replace(/<(td|th)([^>]*)>\s*<p>((?:(?!<\/?p>)[\s\S])*)<\/p>\s*<\/\1>/g, '<$1$2>$3</$1>')
    .replace(/<\/?tbody>/g, '')
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/<td>\s*<p>([\s\S]*?)<\/p>\s*<\/td>/g, (m, inner) => (/<p>/.test(inner) ? m : `<td>${inner}</td>`))
    .replace(/<th>\s*<p>([\s\S]*?)<\/p>\s*<\/th>/g, (m, inner) => (/<p>/.test(inner) ? m : `<th>${inner}</th>`))
    .replace(/&nbsp;/g, ' ')
    .replace(/<tr>/g, '\n<tr>')
    .replace(/<\/table>/, '\n</table>');
}

let sharedTd;
export function storageToMarkdown(storage, ctx = {}) {
  sharedTd ||= createTurndown();
  const pre = preprocessStorage(storage, ctx);
  const { html, meta } = extractProperties(pre);
  let md = sharedTd.turndown(html || '');
  md = md
    .replace(/ /g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\\\[TOC\\\]$/gm, '[TOC]')
    .replace(/^(#{1,6}) +/gm, '$1 ')
    .replace(/^(#{1,6}) \*\*(.+?)\*\*\s*$/gm, '$1 $2')
    .replace(/^(#{1,6}) (\d+)\\\./gm, '$1 $2.')
    .replace(/^(\s*)- {3}/gm, '$1- ')
    .replace(/^(\s*)(\d+)\. {1,2}(?=\S)/gm, '$1$2. ')
    .replace(/^(\s*[-*] .*)\n\n(?=\s*[-*] )/gm, '$1\n')
    .trim();
  return { markdown: md + '\n', meta };
}
