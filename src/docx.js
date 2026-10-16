// Markdown (Notebook flavour) → .docx, built from marked tokens.
import fs from 'node:fs';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ExternalHyperlink,
  ImageRun, AlignmentType, BorderStyle, ShadingType, LevelFormat, TableOfContents, PageBreak, Footer, PageNumber,
} from 'docx';
import { Marked } from 'marked';
import { PROPERTY_FIELDS, DIAGRAM_LANGS, formatDate } from '../web/lib/notebook-md.js';
import { renderDiagram, pngSize } from './diagrams.js';
import { resolveLocalImage, stripLeadingTitle } from './render.js';
import { config } from './config.js';

const FONT = 'Calibri';
const MONO = 'Consolas';
const MAX_IMG_WIDTH = 600; // px at 96dpi ≈ 16cm content width
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const CALLOUT_FILL = { NOTE: 'EFF6FF', INFO: 'EFF6FF', TIP: 'F0FDF4', IMPORTANT: 'FFFBEB', WARNING: 'FFFBEB', CAUTION: 'FEF2F2' };
const STATUS_FILL = { green: 'DCFCE7', blue: 'DBEAFE', red: 'FEE2E2', yellow: 'FEF3C7', purple: 'EDE9FE', grey: 'E9ECF1' };

const decode = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const border = { style: BorderStyle.SINGLE, size: 4, color: 'D0D5DD' };
const cellBorders = { top: border, bottom: border, left: border, right: border };

function scaleImage(buf, maxWidth = MAX_IMG_WIDTH, density = 1) {
  const { width, height } = pngSize(buf);
  const w = width / density;
  const h = height / density;
  const k = Math.min(1, maxWidth / w);
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

export async function toDocx(meta, body, { baseDir = config.draftsDir } = {}) {
  const marked = new Marked({ gfm: true });
  marked.use({
    extensions: [{
      name: 'mention', level: 'inline', start: (s) => s.indexOf('@['),
      tokenizer(src) {
        const m = /^@\[([^\]\n]{1,80})\](?:\([\w:-]{6,}\))?/.exec(src);
        if (m) return { type: 'mention', raw: m[0], name: m[1].trim() };
      },
    }, {
      name: 'date', level: 'inline', start: (s) => s.indexOf('{date:'),
      tokenizer(src) {
        const m = /^\{date:(\d{4}-\d{2}-\d{2})\}/.exec(src);
        if (m) return { type: 'date', raw: m[0], date: m[1] };
      },
    }, {
      name: 'status', level: 'inline', start: (s) => s.indexOf('{status:'),
      tokenizer(src) {
        const m = /^\{status:([^}|]+)(?:\|(\w+))?\}/.exec(src);
        if (m) return { type: 'status', raw: m[0], title: m[1].trim(), colour: m[2] };
      },
    }],
  });
  const tokens = marked.lexer(stripLeadingTitle(body, meta.title));

  // Pre-render diagrams
  const diagrams = new Map();
  const walkForDiagrams = async (list) => {
    for (const t of list) {
      if (t.type === 'code' && DIAGRAM_LANGS[(t.lang || '').toLowerCase()]) {
        try {
          diagrams.set(t, await renderDiagram(t.lang.toLowerCase(), t.text));
        } catch (e) {
          diagrams.set(t, { error: e.message });
        }
      }
      if (t.tokens) await walkForDiagrams(t.tokens);
      if (t.items) for (const i of t.items) await walkForDiagrams(i.tokens || []);
    }
  };
  await walkForDiagrams(tokens);

  const inline = (list = [], style = {}) => {
    const runs = [];
    for (const t of list) {
      switch (t.type) {
        case 'strong': runs.push(...inline(t.tokens, { ...style, bold: true })); break;
        case 'em': runs.push(...inline(t.tokens, { ...style, italics: true })); break;
        case 'del': runs.push(...inline(t.tokens, { ...style, strike: true })); break;
        case 'codespan': runs.push(new TextRun({ text: decode(t.text), font: MONO, size: 19, shading: { type: ShadingType.CLEAR, fill: 'F1F3F6' }, ...style })); break;
        case 'br': runs.push(new TextRun({ text: '', break: 1 })); break;
        case 'link':
          runs.push(new ExternalHyperlink({ link: t.href, children: inline(t.tokens, { ...style, color: '2F6FED', underline: {} }) }));
          break;
        case 'mention':
          runs.push(new TextRun({ text: `@${t.name}`, color: '2F6FED', ...style }));
          break;
        case 'date':
          runs.push(new TextRun({ text: formatDate(t.date), bold: true, size: 19, shading: { type: ShadingType.CLEAR, fill: 'E9ECF1' }, ...style }));
          break;
        case 'status': {
          const c = { 'FINAL PRD': 'green', FINAL: 'green', RELEASED: 'purple', CANCELLED: 'red', 'IN DEVELOPMENT': 'blue' }[t.title.toUpperCase()] || t.colour || 'grey';
          runs.push(new TextRun({ text: ` ${t.title.toUpperCase()} `, bold: true, size: 17, shading: { type: ShadingType.CLEAR, fill: STATUS_FILL[c] || STATUS_FILL.grey } }));
          break;
        }
        case 'image': {
          const file = resolveLocalImage(t.href, baseDir);
          if (file && /\.(png|jpe?g|gif)$/i.test(file)) {
            const data = fs.readFileSync(file);
            runs.push(new ImageRun({ data, type: /\.png$/i.test(file) ? 'png' : /\.gif$/i.test(file) ? 'gif' : 'jpg', transformation: scaleImage(data) }));
          } else runs.push(new TextRun({ text: `[image: ${t.text || t.href}]`, italics: true, color: '888888' }));
          break;
        }
        case 'html': {
          const text = decode(t.text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
          text.split('\n').forEach((part, i) => runs.push(new TextRun({ text: part, break: i ? 1 : 0, ...style })));
          break;
        }
        case 'text':
        case 'escape':
          if (t.tokens) runs.push(...inline(t.tokens, style));
          else runs.push(new TextRun({ text: decode(t.text), ...style }));
          break;
        default:
          if (t.tokens) runs.push(...inline(t.tokens, style));
          else if (t.text) runs.push(new TextRun({ text: decode(t.text), ...style }));
      }
    }
    return runs;
  };

  const out = [];
  const blocks = (list, ctx = {}) => {
    const res = [];
    for (const t of list) {
      switch (t.type) {
        case 'heading':
          res.push(new Paragraph({ heading: HEADINGS[Math.min(t.depth, 6) - 1], children: inline(t.tokens), spacing: { before: 280, after: 120 } }));
          break;
        case 'paragraph':
          if (t.text.trim() === '[TOC]') {
            res.push(new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-3' }));
            break;
          }
          res.push(new Paragraph({ children: inline(t.tokens), spacing: { after: 120 }, shading: ctx.fill ? { type: ShadingType.CLEAR, fill: ctx.fill } : undefined, indent: ctx.indent }));
          break;
        case 'space':
          break;
        case 'hr':
          res.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D0D5DD', space: 1 } }, spacing: { after: 200 } }));
          break;
        case 'code': {
          const d = diagrams.get(t);
          if (d && !d.error) {
            res.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 200 }, children: [new ImageRun({ data: d.png, type: 'png', transformation: scaleImage(d.png, MAX_IMG_WIDTH, d.kind === 'mermaid' ? 2 : 1) })] }));
            break;
          }
          const lines = t.text.split('\n');
          lines.forEach((line, i) =>
            res.push(new Paragraph({
              children: [new TextRun({ text: line || ' ', font: MONO, size: 18 })],
              shading: { type: ShadingType.CLEAR, fill: 'F3F4F7' },
              spacing: { after: i === lines.length - 1 ? 160 : 0, line: 260 },
              indent: { left: 120, right: 120 },
            })),
          );
          break;
        }
        case 'blockquote': {
          const m = /^\[!(\w+)\][ \t]*(.*)/.exec(t.tokens[0]?.text || '');
          const kind = m?.[1]?.toUpperCase();
          const fill = kind && CALLOUT_FILL[kind] ? CALLOUT_FILL[kind] : 'F5F7FA';
          const inner = m ? marked.lexer(t.text.replace(/^\s*\[!\w+\][^\n]*\n?/, '')) : t.tokens;
          if (m) res.push(new Paragraph({ children: [new TextRun({ text: m[2] || kind[0] + kind.slice(1).toLowerCase(), bold: true })], shading: { type: ShadingType.CLEAR, fill }, spacing: { after: 0 }, indent: { left: 160 } }));
          res.push(...blocks(inner, { fill, indent: { left: 160 } }));
          break;
        }
        case 'list':
          res.push(...listBlocks(t, 0));
          break;
        case 'table':
          res.push(tableBlock(t.header.map((c) => ({ tokens: c.tokens, header: true })), t.rows.map((r) => r.map((c) => ({ tokens: c.tokens })))));
          res.push(new Paragraph({ spacing: { after: 120 } }));
          break;
        case 'html':
          res.push(...htmlBlock(t.text));
          break;
        default:
          if (t.tokens) res.push(new Paragraph({ children: inline(t.tokens) }));
      }
    }
    return res;
  };

  const listBlocks = (list, level) => {
    const res = [];
    for (const item of list.items) {
      const [first, ...rest] = item.tokens;
      const prefix = item.task ? [new TextRun({ text: item.checked ? '☑ ' : '☐ ' })] : [];
      const firstInline = first && (first.type === 'text' || first.type === 'paragraph') ? inline(first.tokens || [{ type: 'text', text: first.text }]) : [];
      res.push(new Paragraph({
        children: [...prefix, ...firstInline],
        numbering: { reference: list.ordered ? 'numbered' : 'bullets', level: Math.min(level, 5) },
        spacing: { after: 60 },
      }));
      const remaining = firstInline.length ? rest : item.tokens;
      for (const sub of remaining) {
        if (sub.type === 'list') res.push(...listBlocks(sub, level + 1));
        else res.push(...blocks([sub], { indent: { left: 720 * (level + 1) } }));
      }
    }
    return res;
  };

  const tableBlock = (header, rows) => {
    const cols = Math.max(header.length, ...rows.map((r) => r.length));
    const mk = (cells, isHeader) =>
      new TableRow({
        tableHeader: isHeader,
        children: Array.from({ length: cols }, (_, i) => {
          const c = cells[i];
          const children = c?.blocks || [new Paragraph({ children: c ? inline(c.tokens, isHeader ? { bold: true } : {}) : [] })];
          return new TableCell({
            children,
            borders: cellBorders,
            shading: isHeader ? { type: ShadingType.CLEAR, fill: 'F5F7FA' } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
          });
        }),
      });
    return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [...(header.length ? [mk(header, true)] : []), ...rows.map((r) => mk(r, false))] });
  };

  // Raw HTML blocks: tables from pulled pages, <details> wrappers
  const htmlBlock = (html) => {
    const res = [];
    const summary = html.match(/<summary>([\s\S]*?)<\/summary>/);
    if (summary) res.push(new Paragraph({ children: [new TextRun({ text: `▸ ${decode(summary[1].replace(/<[^>]+>/g, ''))}`, bold: true })], spacing: { before: 120, after: 80 } }));
    const tableMatch = html.match(/<table[\s\S]*?<\/table>/);
    if (tableMatch) {
      const rows = [...tableMatch[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) =>
        [...r[1].matchAll(/<(t[hd])[^>]*>([\s\S]*?)<\/\1>/g)].map((c) => ({ header: c[1] === 'th', html: c[2] })),
      );
      const toCell = (c) => ({ blocks: htmlToParagraphs(c.html, c.header) });
      const header = rows[0]?.every((c) => c.header) ? rows.shift().map(toCell) : [];
      res.push(tableBlock(header, rows.map((r) => r.map(toCell))));
      res.push(new Paragraph({ spacing: { after: 120 } }));
    }
    return res;
  };

  const htmlToParagraphs = (html, bold) => {
    const md = html
      .replace(/<li[^>]*>/g, '\n- ')
      .replace(/<\/(p|li|h\d)>/g, '\n')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<(strong|b)>([\s\S]*?)<\/\1>/g, '**$2**')
      .replace(/<code>([\s\S]*?)<\/code>/g, '`$1`')
      .replace(/<[^>]+>/g, '');
    const paras = decode(md).split('\n').map((s) => s.trim()).filter(Boolean);
    if (!paras.length) return [new Paragraph({})];
    return paras.map((p) => new Paragraph({ children: inline(marked.lexer(p)[0]?.tokens || [{ type: 'text', text: p }], bold ? { bold: true } : {}), spacing: { after: 40 } }));
  };

  // Title + properties
  if (meta.title) out.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: meta.title })], spacing: { after: 240 } }));
  const props = PROPERTY_FIELDS.filter(([k]) => meta[k] && String(meta[k]).trim());
  if (props.length) {
    out.push(tableBlock([], props.map(([k, label, kind]) => [
      { tokens: [{ type: 'text', text: label }], blocks: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })] },
      { tokens: kind === 'status' ? [].concat(meta[k]).map((v) => ({ type: 'status', title: String(v) })) : [{ type: 'text', text: [].concat(meta[k]).join(', ') }] },
    ])));
    out.push(new Paragraph({ spacing: { after: 200 } }));
  }
  out.push(...blocks(tokens));

  const doc = new Document({
    creator: meta.owner ? String(meta.owner) : 'Confluence Notebook',
    title: meta.title || 'Document',
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { line: 300 } } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', run: { size: 44, bold: true, color: '1D2330' } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 34, bold: true, color: '1D2330' } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, color: '1D2330' } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, color: '2B3445' } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: '5B6474' } },
      ],
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: Array.from({ length: 6 }, (_, i) => ({ level: i, format: LevelFormat.BULLET, text: ['•', '◦', '▪'][i % 3], alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540 + i * 360, hanging: 260 } } } })) },
        { reference: 'numbered', levels: Array.from({ length: 6 }, (_, i) => ({ level: i, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][i % 3], text: `%${i + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540 + i * 360, hanging: 300 } } } })) },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '888888' })] })] }) },
      children: out,
    }],
  });
  return Packer.toBuffer(doc);
}

export { PageBreak };
