// PRD standardisation shared by import and `cn check`.
// Target shape = standard Agile PRD: [PRD] title, Page Properties (8 fields), unnumbered template sections.

export const PROPERTY_LABELS = {
  tribe: ['tribe'],
  target_release: ['target release', 'target rilis', 'target rilis produk', 'release target', 'rilis'],
  epic: ['epic', 'jira epic', 'jira'],
  doc_status: ['document status', 'doc status', 'status dokumen', 'status document', 'status'],
  owner: ['document owner', 'doc owner', 'owner', 'author', 'penulis', 'product owner', 'pic product', 'pic'],
  designer: ['designer', 'ui designer', 'ux designer', 'ui/ux designer', 'desainer'],
  tech_lead: ['tech lead', 'tech-lead', 'techlead', 'technical lead', 'lead engineer', 'engineering lead'],
  qa: ['qa', 'quality assurance', 'qa engineer', 'tester'],
  labels: ['labels', 'label', 'tags', 'tag', 'kategori', 'category'],
};
const LABEL_TO_KEY = new Map(Object.entries(PROPERTY_LABELS).flatMap(([k, labels]) => labels.map((l) => [l, k])));
const LIST_KEYS = new Set(['tribe', 'owner', 'designer', 'tech_lead', 'qa', 'labels']);
const EMPTY = /^(-+|—|–|n\/?a|none|tidak ada|belum ada)?$/i;

export const STANDARD_SECTIONS = ['Objective', 'Success Metrics', 'Assumptions & Dependencies', 'Pre-Condition', 'Post-Condition', 'Requirements'];
const SECTION_ALIASES = [
  [/^pre[\s-]?conditions?$/i, 'Pre-Condition'],
  [/^post[\s-]?conditions?$/i, 'Post-Condition'],
  [/^assumptions?\s*(&|and|dan)\s*dependenc(y|ies)$/i, 'Assumptions & Dependencies'],
  [/^success\s*metrics?$/i, 'Success Metrics'],
  [/^objectives?$/i, 'Objective'],
  [/^requirements?$/i, 'Requirements'],
  [/^out\s*of\s*scope$/i, 'Out of Scope'],
  [/^user\s*interaction\s*(and|&)\s*design$/i, 'User interaction and design'],
];

const clean = (s) => String(s).replace(/<br\s*\/?>/gi, ', ').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();

export function labelKey(label) {
  return LABEL_TO_KEY.get(clean(label).replace(/[:：]\s*$/, '').toLowerCase()) || null;
}

export function normalizeStatus(v) {
  const s = clean(v).toLowerCase();
  if (!s) return '';
  if (/cancel|batal/.test(s)) return 'CANCELLED';
  if (/hold|tunda/.test(s)) return 'ON HOLD';
  if (/released|rilis|live|production/.test(s)) return 'RELEASED';
  if (/in\s*develop|development|dikembangkan|develop/.test(s)) return 'IN DEVELOPMENT';
  if (/design\s*(done|selesai)/.test(s)) return 'DESIGN DONE';
  if (/design/.test(s)) return 'DESIGN ON PROGRESS';
  if (/final/.test(s)) return 'FINAL PRD';
  if (/draft|review|wip|progress/.test(s)) return 'DRAFT';
  return clean(v).toUpperCase();
}

function normalizeValue(key, raw) {
  let v = clean(raw);
  if (EMPTY.test(v) || /^author$/i.test(v)) return null; // "Author" is the generic document-properties placeholder
  if (key === 'doc_status') return normalizeStatus(v) || null;
  if (key === 'tribe') {
    const parts = v.split(/\s*(?:,|\/|&|\bdan\b)\s*/i).map((x) => x.trim().toUpperCase()).filter(Boolean);
    return parts.length > 1 ? parts : parts[0] || null;
  }
  if (key === 'labels') {
    // Confluence labels: lowercase, no spaces (replace with hyphens), no special chars
    const parts = v.split(/\s*(?:,|;|\s\/\s|\/)\s*/).map((x) => x.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_.-]/gu, '')).filter(Boolean);
    return parts.length > 1 ? parts : parts[0] || null;
  }
  if (LIST_KEYS.has(key)) {
    const parts = v.replace(/@\s*/g, '').split(/\s*(?:,|\s\/\s|\/|;|\bdan\b|&)\s*/i).map((x) => x.trim()).filter((x) => x && !EMPTY.test(x));
    return parts.length > 1 ? parts : parts[0] || null;
  }
  return v;
}

function splitRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
}

/**
 * Pull PRD page properties out of the document header (everything before the first "## " heading):
 * 2-column tables (Field/Value, Atribut/Keterangan, Document Control, …) and "Label: value" lines.
 * Unrecognised header rows are kept in a small table so no information is lost.
 */
export function extractHeaderProperties(body) {
  const meta = {};
  const found = [];
  const kept = [];
  const cut = body.search(/^##\s/m);
  const head = cut < 0 ? body : body.slice(0, cut);
  const rest = cut < 0 ? '' : body.slice(cut);
  const lines = head.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // table block
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      const block = [line];
      let j = i + 1;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) block.push(lines[j++]);
      const header = splitRow(block[0]);
      const rows = block.slice(2).map(splitRow);
      if (header.length === 2) {
        const headerKey = labelKey(header[0]);
        const all = headerKey ? [header, ...rows] : rows;
        const leftovers = [];
        for (const [label, value = ''] of all) {
          const key = labelKey(label);
          if (key) {
            const v = normalizeValue(key, value);
            if (v !== null && meta[key] === undefined) meta[key] = v;
            found.push(clean(label));
          } else leftovers.push([label, value]);
        }
        if (found.length) {
          if (leftovers.length) {
            kept.push(...leftovers.map(([l]) => clean(l)));
            out.push('| Informasi | Keterangan |', '| --- | --- |', ...leftovers.map(([l, v]) => `| ${l} | ${v} |`));
          }
          i = j - 1;
          continue;
        }
      }
      out.push(...block);
      i = j - 1;
      continue;
    }
    // "**Label:** value" or "Label: value"
    const kv = /^\s*(?:[-*]\s+)?(?:\*\*([^*:]+):?\*\*:?|([A-Za-z][\w /-]{1,30}):)\s+(.+)$/.exec(line);
    if (kv) {
      const label = kv[1] || kv[2];
      const key = labelKey(label);
      if (key) {
        const v = normalizeValue(key, kv[3]);
        if (v !== null && meta[key] === undefined) meta[key] = v;
        found.push(clean(label));
        continue;
      }
      if (kv[1]) {
        kept.push(clean(label));
        out.push(line);
        continue;
      }
    }
    out.push(line);
  }
  let newHead = out.join('\n').replace(/^(\s*-{3,}\s*\n)+/, '').replace(/(\n\s*-{3,}\s*)+\s*$/, '\n');
  if (!newHead.trim()) newHead = '';
  return { meta, found, kept, body: (newHead ? `${newHead.trim()}\n\n` : '') + rest };
}

/** "PRD: X", "PRD - X", "PRD – X" → "[PRD] X" */
export function normalizePrdTitle(title) {
  const t = String(title).trim();
  const m = /^\[?PRD\]?\s*(?:[:\-–|]\s*)?(.+)$/i.exec(t);
  if (!m || /^\[PRD\]\s/.test(t)) return t;
  return `[PRD] ${m[1].trim()}`;
}

/** Drop "1." / "6.2" numbering from headings and align section names with the Confluence template. */
export function standardizeHeadings(body, { stripNumbers = true } = {}) {
  let numbered = 0;
  const out = body.replace(/^(#{2,4})\s+(\d+(?:\\?\.\d+)*\\?\.?)\s+(.+)$/gm, (m, hashes, num, text) => {
    numbered++;
    return stripNumbers ? `${hashes} ${text}` : m;
  });
  return {
    body: out.replace(/^(##)\s+(.+?)\s*$/gm, (m, h, text) => {
      const hit = SECTION_ALIASES.find(([re]) => re.test(text.trim()));
      return hit ? `${h} ${hit[1]}` : m;
    }),
    numbered,
  };
}

/** Review notes for a PRD draft (used by import and `cn check`). */
export function reviewPrd(meta, body) {
  const notes = [];
  // 'labels' is optional metadata (not a Page Properties table field), skip from empty-check
  const REQUIRED_PROPS = Object.keys(PROPERTY_LABELS).filter((k) => k !== 'labels');
  const missing = REQUIRED_PROPS.filter((k) => meta[k] === undefined || meta[k] === '');
  if (missing.length) notes.push({ level: 'info', text: `Page properties still empty: ${missing.join(', ')}` });
  if (meta.title && !/^\[PRD\]\s/.test(meta.title)) notes.push({ level: 'warn', text: `Title does not start with "[PRD] "` });
  const headings = [...body.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);
  const absent = STANDARD_SECTIONS.filter((s) => !headings.some((h) => h.toLowerCase() === s.toLowerCase()));
  if (absent.length) notes.push({ level: 'warn', text: `Missing standard sections: ${absent.join(', ')}` });
  const reqIdx = body.search(/^##\s+Requirements\s*$/m);
  if (reqIdx >= 0) {
    const table = /^\|(.+)\|\s*$/m.exec(body.slice(reqIdx));
    const cols = table ? splitRow(table[0]).map((c) => clean(c).toLowerCase()) : [];
    if (table && !(cols.includes('user story') && cols.includes('keyword') && cols.includes('requirement')))
      notes.push({ level: 'warn', text: `Requirements table columns are "${cols.join(' | ')}", expected User Story | Keyword | Requirement` });
  }
  if (/[—]/.test(body)) notes.push({ level: 'info', text: 'Contains em dash (—), which the writing convention avoids' });
  return notes;
}
