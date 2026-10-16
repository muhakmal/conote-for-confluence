// Guarantees for Confluence storage format:
//   1. raw HTML found in Markdown is re-parsed and re-serialised as safe, well-formed XHTML
//   2. named HTML entities become numeric (XML only knows five)
//   3. the final document is checked for well-formedness before anything is published
import domino from '@mixmark-io/domino';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

// tag → storage tag ('' = unwrap, keep children)
const BLOCK_TAGS = {
  p: 'p', h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6', blockquote: 'blockquote', pre: 'pre',
  ul: 'ul', ol: 'ol', li: 'li', table: 'table', thead: 'thead', tbody: 'tbody', tfoot: 'tfoot', tr: 'tr', th: 'th', td: 'td',
  caption: '', colgroup: null, col: null, hr: 'hr', br: 'br', div: '', section: '', article: '', header: '', footer: '', main: '', nav: '', center: '',
  figure: '', figcaption: 'p', dl: '', dt: 'p', dd: 'p',
};
const INLINE_TAGS = {
  strong: 'strong', b: 'strong', em: 'em', i: 'em', u: 'u', s: 's', del: 's', strike: 's', ins: 'u', sub: 'sub', sup: 'sup',
  code: 'code', kbd: 'code', samp: 'code', tt: 'code', var: 'em', cite: 'em', q: '', abbr: '', small: '', big: '', mark: '', span: '', font: '', label: '',
  a: 'a', br: 'br', img: 'img', time: '',
};
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'svg', 'math', 'video', 'audio', 'canvas', 'noscript', 'template', 'head', 'meta', 'link', 'title']);
const VOID = new Set(['br', 'hr']);

/**
 * @param {string} html fragment
 * @param {{ image?: (src:string, alt:string)=>string }} opts
 */
export function htmlToXhtml(html, opts = {}) {
  const doc = domino.createDocument(`<!doctype html><html><body>${html}</body></html>`);
  return serializeChildren(doc.body, opts);
}

function serializeChildren(node, opts) {
  let out = '';
  for (const child of Array.from(node.childNodes)) out += serializeNode(child, opts);
  return out;
}

function serializeNode(n, opts) {
  if (n.nodeType === 3) return esc(n.data.replace(/ /g, ' '));
  if (n.nodeType !== 1) return '';
  const tag = n.nodeName.toLowerCase();
  if (DROP.has(tag)) return '';
  if (tag === 'img') {
    const src = n.getAttribute('src') || '';
    const alt = n.getAttribute('alt') || '';
    if (!src) return '';
    const width = Number(n.getAttribute('width')) || undefined;
    return opts.image ? opts.image(src, alt, { width }) : `<ac:image ac:align="left" ac:alt="${escAttr(alt)}"><ri:url ri:value="${escAttr(src)}" /></ac:image>`;
  }
  const mapped = tag in BLOCK_TAGS ? BLOCK_TAGS[tag] : tag in INLINE_TAGS ? INLINE_TAGS[tag] : '';
  if (mapped === null) return '';
  const ownAlign = /text-align:\s*(left|right|center)/i.exec(n.getAttribute('style') || '')?.[1] || (/^(left|right|center)$/i.test(n.getAttribute('align') || '') ? n.getAttribute('align') : '');
  // unwrapped containers (div align="center") pass their alignment to child blocks
  const inner = serializeChildren(n, !mapped && ownAlign ? { ...opts, align: ownAlign } : opts);
  if (!mapped) return inner;
  if (VOID.has(mapped)) return `<${mapped} />`;
  let attrs = '';
  if (mapped === 'a') {
    const href = n.getAttribute('href') || '';
    if (/^\s*javascript:/i.test(href)) return inner;
    if (href) attrs += ` href="${escAttr(href)}"`;
  }
  if (mapped === 'td' || mapped === 'th') {
    for (const a of ['colspan', 'rowspan']) if (/^\d+$/.test(n.getAttribute(a) || '')) attrs += ` ${a}="${n.getAttribute(a)}"`;
  }
  const align = ownAlign || (['p', 'h1', 'h2', 'h3', 'h4'].includes(mapped) ? opts.align : '');
  if (align && ['p', 'td', 'th', 'h1', 'h2', 'h3', 'h4'].includes(mapped)) attrs += ` style="text-align: ${align.toLowerCase()};"`;
  return `<${mapped}${attrs}>${inner}</${mapped}>`;
}

/** A single inline tag emitted by marked (e.g. "<kbd>" or "</kbd>"). */
export function inlineTagToXhtml(raw, opts = {}) {
  if (/^<!--[\s\S]*-->$/.test(raw)) return '';
  const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)(\/?)>$/.exec(raw.trim());
  if (!m) return esc(raw);
  const [, close, name, attrText] = m;
  const tag = name.toLowerCase();
  if (tag === 'img' || (!close && /\/\s*$/.test(attrText) && tag !== 'br')) return htmlToXhtml(raw, opts);
  if (DROP.has(tag)) return '';
  const mapped = INLINE_TAGS[tag];
  if (mapped === undefined) return esc(raw);
  if (!mapped) return '';
  if (mapped === 'br') return '<br />';
  if (close) return `</${mapped}>`;
  if (mapped === 'a') {
    const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrText);
    const value = href ? href[2] ?? href[3] : '';
    return value && !/^\s*javascript:/i.test(value) ? `<a href="${escAttr(value)}">` : '<a>';
  }
  return `<${mapped}>`;
}

const XML_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);
const entityCache = new Map();

/** Replace named HTML entities with numeric ones, leaving CDATA untouched. */
export function toXmlEntities(xml) {
  return xml
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => {
            if (XML_ENTITIES.has(name)) return m;
            if (!entityCache.has(name)) {
              const text = domino.createDocument(`<p>&${name};</p>`).body.textContent;
              entityCache.set(name, text === `&${name};` ? null : text);
            }
            const ch = entityCache.get(name);
            return ch == null ? `&amp;${name};` : [...ch].map((c) => `&#${c.codePointAt(0)};`).join('');
          }),
    )
    .join('');
}

/** Minimal XML well-formedness check for a storage-format fragment. */
export function checkXhtml(xml) {
  const re = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);|[<&]/g;
  const stack = [];
  let m;
  while ((m = re.exec(xml))) {
    const tok = m[0];
    if (tok === '<' || tok === '&') return fail(xml, m.index, `stray "${tok}"`);
    if (tok[0] === '&') {
      if (/^&[A-Za-z]/.test(tok) && !XML_ENTITIES.has(tok.slice(1, -1))) return fail(xml, m.index, `entity ${tok}`);
      continue;
    }
    if (tok.startsWith('<!')) continue;
    const [, close, name, , selfClose] = m;
    if (selfClose) continue;
    if (close) {
      const open = stack.pop();
      if (!open || open.name !== name) return fail(xml, m.index, open ? `</${name}> closes <${open.name}>` : `unexpected </${name}>`);
    } else stack.push({ name, index: m.index });
  }
  if (stack.length) {
    const open = stack.pop();
    return fail(xml, open.index, `<${open.name}> is never closed`);
  }
  return { ok: true };
}

function fail(xml, index, error) {
  return { ok: false, error, context: xml.slice(Math.max(0, index - 80), index + 80) };
}

/**
 * Repair tag nesting in otherwise valid storage: close forgotten tags (e.g. "<b>bold" without "</b>")
 * where their parent closes, and drop closing tags that have no opener.
 */
export function repairXhtml(xml) {
  const re = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/g;
  const stack = [];
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(xml))) {
    out += xml.slice(last, m.index);
    last = m.index + m[0].length;
    const [tok, close, name, , selfClose] = m;
    if (tok.startsWith('<!') || selfClose) {
      out += tok;
      continue;
    }
    if (!close) {
      stack.push(name);
      out += tok;
      continue;
    }
    const at = stack.lastIndexOf(name);
    if (at < 0) continue; // stray closer
    while (stack.length > at + 1) out += `</${stack.pop()}>`;
    stack.pop();
    out += tok;
  }
  out += xml.slice(last);
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}
