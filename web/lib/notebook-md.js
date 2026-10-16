// Isomorphic Markdown renderer shared by the server (publish/export) and the browser (preview).
// Pass a Marked class in; targets: 'html' (preview/export) or 'storage' (Confluence XHTML).
//
// Notebook Markdown = GFM + a few PRD-friendly extras:
//   {status:DRAFT|green}             → status lozenge
//   [TOC]                            → table of contents
//   > [!NOTE] / [!TIP] / [!WARNING] / [!CAUTION] / [!INFO]  → callout panels
//   <details><summary>Title</summary> … </details>          → expand
//   ```mermaid / ```plantuml (```puml)                     → rendered diagrams
//   @[Full Name]                     → user mention
//   {date:2026-09-17}                → date lozenge

export const DIAGRAM_LANGS = { mermaid: 'mermaid', plantuml: 'plantuml', puml: 'plantuml', uml: 'plantuml' };

export const escapeHtml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function headingSlug(text, used) {
  let s = String(text).toLowerCase().replace(/<[^>]+>/g, '').replace(/&\w+;/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
  if (used) {
    const base = s;
    let i = 1;
    while (used.has(s)) s = `${base}-${i++}`;
    used.add(s);
  }
  return s;
}

// Instruction text that Confluence templates put in quotes, e.g. "Type/image to add diagram or chart…"
export const PLACEHOLDER_QUOTE = /^Type\s*\/\s*\w+\s+to add\b[^\n]*$/i;

const CALLOUT = { NOTE: 'info', INFO: 'info', TIP: 'tip', IMPORTANT: 'note', WARNING: 'note', CAUTION: 'warning' };
const STATUS_COLOURS = { DRAFT: 'grey', 'IN REVIEW': 'blue', REVIEW: 'blue', 'FINAL PRD': 'green', FINAL: 'green', APPROVED: 'green', 'IN DEVELOPMENT': 'blue', RELEASED: 'purple', CANCELLED: 'red', 'DESIGN ON PROGRESS': 'yellow', 'DESIGN DONE': 'green' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const formatDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
};
export const statusColour = (title, c) => (c || STATUS_COLOURS[String(title).toUpperCase()] || 'grey').toLowerCase();

const CODE_LANGS = { js: 'javascript', javascript: 'javascript', ts: 'typescript', typescript: 'typescript', json: 'json', java: 'java', kotlin: 'kotlin', go: 'go', py: 'py', python: 'py', sql: 'sql', xml: 'xml', html: 'html', yaml: 'yaml', yml: 'yaml', bash: 'bash', sh: 'bash', shell: 'bash', php: 'php', ruby: 'ruby', swift: 'swift', css: 'css', diff: 'diff', powershell: 'powershell', http: 'text', text: 'text' };

const VOID_TAGS = /<(br|hr|img|col|input|meta|wbr)(\s[^<>]*?)?\s*\/?>/gi;
const xhtml = (html) => html.replace(VOID_TAGS, (_, t, a = '') => `<${t}${a.replace(/\s*\/$/, '')} />`).replace(/&nbsp;/g, '&#160;');
const cdata = (s) => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

/**
 * @param {typeof import('marked').Marked} Marked
 * @param {{ target: 'html'|'storage', diagram?: (lang:string, code:string, index:number)=>string, image?: (href:string, alt:string)=>string, gfmBreaks?: boolean }} opts
 */
export function createMarkdown(Marked, opts) {
  const storage = opts.target === 'storage';
  const marked = new Marked({ gfm: true, breaks: false });
  const mentionHtml = (name, accountId) => {
    if (storage) {
      const id = accountId || opts.mention?.(name);
      return id ? `<ac:link><ri:user ri:account-id="${escapeHtml(id)}" /></ac:link>` : `@${escapeHtml(name)}`;
    }
    return `<span class="mention">@${escapeHtml(name)}</span>`;
  };
  const dateHtml = (date) => (storage ? `<time datetime="${date}" />` : `<span class="date-chip" data-date="${date}">${formatDate(date)}</span>`);
  let usedSlugs = new Set();
  let diagramIndex = 0;
  let headings = [];

  marked.use({
    hooks: {
      preprocess(md) {
        usedSlugs = new Set();
        diagramIndex = 0;
        headings = [];
        return md;
      },
    },
    extensions: [
      {
        name: 'mention',
        level: 'inline',
        start: (src) => src.indexOf('@['),
        tokenizer(src) {
          const m = /^@\[([^\]\n]{1,80})\](?:\(([\w:-]{6,})\))?/.exec(src);
          if (m) return { type: 'mention', raw: m[0], name: m[1].trim(), accountId: m[2] };
        },
        renderer: (t) => mentionHtml(t.name, t.accountId),
      },
      {
        name: 'date',
        level: 'inline',
        start: (src) => src.indexOf('{date:'),
        tokenizer(src) {
          const m = /^\{date:(\d{4}-\d{2}-\d{2})\}/.exec(src);
          if (m) return { type: 'date', raw: m[0], date: m[1] };
        },
        renderer: (t) => dateHtml(t.date),
      },
      {
        name: 'status',
        level: 'inline',
        start: (src) => src.indexOf('{status:'),
        tokenizer(src) {
          const m = /^\{status:([^}|]+)(?:\|(\w+))?\}/.exec(src);
          if (m) return { type: 'status', raw: m[0], title: m[1].trim(), colour: m[2] };
        },
        renderer: (t) => {
          const colour = statusColour(t.title, t.colour);
          if (storage) {
            const c = colour === 'grey' ? '' : `<ac:parameter ac:name="colour">${escapeHtml(colour[0].toUpperCase() + colour.slice(1))}</ac:parameter>`;
            return `<ac:structured-macro ac:name="status" ac:schema-version="1">${c}<ac:parameter ac:name="title">${escapeHtml(t.title)}</ac:parameter></ac:structured-macro>`;
          }
          return `<span class="status status-${colour}">${escapeHtml(t.title)}</span>`;
        },
      },
    ],
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        if (storage) return `<h${depth}>${inner}</h${depth}>\n`;
        const id = headingSlug(inner, usedSlugs);
        headings.push({ depth, id, text: inner.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      paragraph({ tokens, text }) {
        if (text.trim() === '[TOC]') {
          return storage
            ? '<ac:structured-macro ac:name="toc" ac:schema-version="1"><ac:parameter ac:name="maxLevel">3</ac:parameter></ac:structured-macro>\n'
            : '<nav class="toc" data-toc></nav>\n';
        }
        return `<p>${this.parser.parseInline(tokens)}</p>\n`;
      },
      blockquote({ tokens, text }) {
        if (PLACEHOLDER_QUOTE.test(text.trim())) {
          const t = text.trim().replace(/\s+/g, ' ');
          return storage ? '' : `<p class="hint" contenteditable="false" data-hint="${escapeHtml(t)}">${escapeHtml(t)}</p>\n`;
        }
        const first = tokens[0];
        const m = first?.type === 'paragraph' && /^\[!(\w+)\][ \t]*(.*)/.exec(first.text);
        if (m && CALLOUT[m[1].toUpperCase()]) {
          const kind = m[1].toUpperCase();
          const title = m[2].trim();
          // re-lex the quote without its marker line (lexer does not run hooks)
          const body = this.parser.parse(marked.lexer(text.replace(/^\s*\[!\w+\][^\n]*\n?/, '')));
          if (storage) {
            const t = title ? `<ac:parameter ac:name="title">${escapeHtml(title)}</ac:parameter>` : '';
            return `<ac:structured-macro ac:name="${CALLOUT[kind]}" ac:schema-version="1">${t}<ac:rich-text-body>${body}</ac:rich-text-body></ac:structured-macro>\n`;
          }
          return `<div class="callout callout-${kind.toLowerCase()}"><div class="callout-title">${escapeHtml(title || kind[0] + kind.slice(1).toLowerCase())}</div>${body}</div>\n`;
        }
        return `<blockquote>${this.parser.parse(tokens)}</blockquote>\n`;
      },
      code({ text, lang = '' }) {
        const l = (lang || '').trim().split(/\s+/)[0].toLowerCase();
        if (DIAGRAM_LANGS[l] && opts.diagram) return opts.diagram(DIAGRAM_LANGS[l], text, diagramIndex++);
        if (storage) {
          const language = CODE_LANGS[l];
          const p = language ? `<ac:parameter ac:name="language">${language}</ac:parameter>` : '';
          return `<ac:structured-macro ac:name="code" ac:schema-version="1">${p}<ac:plain-text-body>${cdata(text)}</ac:plain-text-body></ac:structured-macro>\n`;
        }
        return `<pre class="code"${l ? ` data-lang="${escapeHtml(l)}"` : ''}><code>${escapeHtml(text)}</code></pre>\n`;
      },
      html({ text, block }) {
        const statusMacro = (title, colour) => {
          const c = statusColour(title, colour);
          return storage
            ? `<ac:structured-macro ac:name="status" ac:schema-version="1">${c === 'grey' ? '' : `<ac:parameter ac:name="colour">${c[0].toUpperCase() + c.slice(1)}</ac:parameter>`}<ac:parameter ac:name="title">${escapeHtml(title)}</ac:parameter></ac:structured-macro>`
            : `<span class="status status-${c}">${escapeHtml(title)}</span>`;
        };
        const withStatus = (s) =>
          s
            .replace(/\{status:([^}|<]+)(?:\|(\w+))?\}/g, (_, t, c) => statusMacro(t.trim(), c))
            .replace(/@\[([^\]<\n]{1,80})\]/g, (_, n) => mentionHtml(n.trim()))
            .replace(/\{date:(\d{4}-\d{2}-\d{2})\}/g, (_, d) => dateHtml(d));
        // Inline <details data-title="…"> (e.g. inside a table cell) → expand macro; <summary> tags are dropped
        if (!block && storage && /^<\/?summary>$/i.test(text.trim())) return '';
        if (!block && storage && /^<details[^>]*>$/i.test(text.trim())) {
          const t = /data-title="([^"]*)"/i.exec(text)?.[1] || 'Details';
          return `<ac:structured-macro ac:name="expand" ac:schema-version="1"><ac:parameter ac:name="title">${escapeHtml(t)}</ac:parameter><ac:rich-text-body>`;
        }
        if (!block && storage && /^<\/details>$/i.test(text.trim())) return '</ac:rich-text-body></ac:structured-macro>';
        if (!block && opts.inlineHtml && storage) return opts.inlineHtml(text);
        const hint = /^\s*<!--([\s\S]*?)-->\s*$/.exec(text);
        if (hint) return storage ? '' : `<p class="hint" contenteditable="false" data-hint="${escapeHtml(hint[1].trim())}">${escapeHtml(hint[1].trim())}</p>\n`;
        // Split out <details>/<summary> wrappers (they open and close in different tokens)
        const parts = text.split(/(<details[^>]*>\s*(?:<summary>[\s\S]*?<\/summary>)?|<\/details>)/i);
        let out = '';
        for (const part of parts) {
          if (!part) continue;
          const open = /^<details/i.exec(part);
          if (open) {
            const title = (/<summary>([\s\S]*?)<\/summary>/i.exec(part)?.[1] || 'Details').replace(/<[^>]+>/g, '');
            const plain = title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
            out += storage
              ? `<ac:structured-macro ac:name="expand" ac:schema-version="1"><ac:parameter ac:name="title">${escapeHtml(plain)}</ac:parameter><ac:rich-text-body>`
              : `<details><summary>${escapeHtml(plain)}</summary><div class="details-body">`;
          } else if (/^<\/details>$/i.test(part)) {
            out += storage ? '</ac:rich-text-body></ac:structured-macro>' : '</div></details>';
          } else if (storage) {
            out += withStatus(opts.rawHtml ? opts.rawHtml(part) : xhtml(part.replace(/<!--[\s\S]*?-->/g, '')));
          } else {
            out += withStatus(part);
          }
        }
        return block ? out + '\n' : out;
      },
      link({ href, tokens }) {
        // Let the host turn local attachment links into <ac:link><ri:attachment>; otherwise default rendering.
        if (!storage || !opts.link) return false;
        return opts.link(href, this.parser.parseInline(tokens)) || false;
      },
      image({ href, title, text }) {
        if (opts.image) return opts.image(href, text, title);
        if (storage) return `<ac:image ac:align="left" ac:alt="${escapeHtml(text)}"><ri:url ri:value="${escapeHtml(href)}" /></ac:image>`;
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy">`;
      },
      del({ tokens }) {
        const inner = this.parser.parseInline(tokens);
        return storage ? `<span style="text-decoration: line-through;">${inner}</span>` : `<del>${inner}</del>`;
      },
      br() {
        return storage ? '<br />' : '<br>';
      },
      hr() {
        return storage ? '<hr />\n' : '<hr>\n';
      },
      checkbox({ checked }) {
        return storage ? (checked ? '☑ ' : '☐ ') : `<input type="checkbox" disabled${checked ? ' checked' : ''}> `;
      },
      table(token) {
        const colCount = token.header.length;
        // Distribute columns evenly, align left always
        const colPct = colCount > 0 ? Math.floor(100 / colCount) : 100;
        const cell = (c, tag) => {
          // Always left-align in storage; honour explicit align for HTML
          const align = storage ? '' : (c.align ? ` align="${c.align}" style="text-align:${c.align}"` : '');
          return `<${tag}${align}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        };
        if (storage) {
          // Full-width table with evenly distributed columns, all left-aligned
          const colgroup = Array.from({ length: colCount }, () => `<col ac:width="${colPct}%" />`).join('');
          const head = `<tr>${token.header.map((c) => cell(c, 'th')).join('')}</tr>`;
          const rows = token.rows.map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`).join('\n');
          return `<table ac:style="full-width:true;"><colgroup>${colgroup}</colgroup><tbody>${head}\n${rows}</tbody></table>\n`;
        }
        const head = `<tr>${token.header.map((c) => cell(c, 'th')).join('')}</tr>`;
        const rows = token.rows.map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`).join('\n');
        return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>\n`;
      },
    },
  });

  return {
    marked,
    render(md) {
      let html = marked.parse(md);
      if (storage) html = html.replace(/&nbsp;/g, '&#160;');
      else if (html.includes('data-toc')) html = html.replace(/<nav class="toc" data-toc><\/nav>/g, tocHtml(headings));
      return html;
    },
    headings: () => headings,
  };
}

function tocHtml(headings) {
  const items = headings.filter((h) => h.depth >= 1 && h.depth <= 3);
  if (!items.length) return '';
  const min = Math.min(...items.map((h) => h.depth));
  return `<nav class="toc"><div class="toc-title">Contents</div><ul>${items
    .map((h) => `<li class="toc-l${h.depth - min}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`)
    .join('')}</ul></nav>`;
}

/** PRD "page properties" rows, matching the Confluence template used in PK. */
export const PROPERTY_FIELDS = [
  ['tribe', 'Tribe', 'status'],
  ['target_release', 'Target release', 'text'],
  ['epic', 'Epic', 'text'],
  ['doc_status', 'Document status', 'status'],
  ['owner', 'Document owner', 'text'],
  ['designer', 'Designer', 'text'],
  ['tech_lead', 'Tech lead', 'text'],
  ['qa', 'QA', 'text'],
];

export function propertiesTable(meta, target, opts = {}) {
  const has = ([k]) => meta[k] !== undefined && meta[k] !== '' && !(Array.isArray(meta[k]) && !meta[k].length);
  const filled = PROPERTY_FIELDS.filter(has);
  if (!filled.length) return '';
  // A PRD (has a document status) always shows the full properties table, like the Confluence template
  const rows = meta.doc_status ? PROPERTY_FIELDS : filled;
  const val = (k, kind) => {
    const v = [].concat(meta[k] ?? []).filter((x) => x !== '');
    if (!v.length) return target === 'storage' ? '' : '<span class="muted">—</span>';
    if (kind === 'status') {
      return v
        .map((t) =>
          target === 'storage'
            ? `<ac:structured-macro ac:name="status" ac:schema-version="1">${statusColour(t) !== 'grey' ? `<ac:parameter ac:name="colour">${statusColour(t)[0].toUpperCase() + statusColour(t).slice(1)}</ac:parameter>` : ''}<ac:parameter ac:name="title">${escapeHtml(t)}</ac:parameter></ac:structured-macro>`
            : `<span class="status status-${statusColour(t)}">${escapeHtml(t)}</span>`,
        )
        .join(' ');
    }
    if (target === 'storage' && opts.mention && ['owner', 'designer', 'tech_lead', 'qa'].includes(k)) {
      return v.map((name) => {
        const id = opts.mention(String(name).replace(/^@\[?|\]$/g, ''));
        return id ? `<ac:link><ri:user ri:account-id="${escapeHtml(id)}" /></ac:link>` : escapeHtml(name);
      }).join(' ');
    }
    return v.map((x) => escapeHtml(String(x).replace(/^@\[?|\]$/g, ''))).join(', ');
  };
  const body = rows.map(([k, label, kind]) => `<tr><th>${target === 'storage' ? `<p><strong>${label}</strong></p>` : label}</th><td>${target === 'storage' ? `<p>${val(k, kind)}</p>` : val(k, kind)}</td></tr>`).join('');
  if (target === 'storage') {
    return `<ac:structured-macro ac:name="details" ac:schema-version="1"><ac:rich-text-body><table><tbody>${body}</tbody></table></ac:rich-text-body></ac:structured-macro>\n`;
  }
  return `<div class="props"><table><tbody>${body}</tbody></table></div>\n`;
}
