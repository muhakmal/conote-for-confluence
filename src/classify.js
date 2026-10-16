// Heuristics derived from the PK space layout:
//   Product Development / <Domain> / [PRD] Backlog|Development|Release - <Domain> / [PRD] ...
//   [Deprecated/Archive], Deployment - Checklist, TAD, Dokumentasi API, ...

export function slugify(title, max = 72) {
  const s = String(title)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return (s.slice(0, max).replace(/-+$/, '') || 'untitled');
}

const SECTION_RE = /^\[?PRD( Archive)?\]?\s*(Backlog|Development|Release|Releases|\d{4} Releases)\b|^Release Document\b|^\d{4} Releases/i;

export function docTypeOf(title, ancestors = []) {
  const t = title.trim().replace(/^\p{Extended_Pictographic}\s*/u, '');
  const chain = ancestors.map((a) => a.title).join(' / ');
  if (SECTION_RE.test(t)) return 'section';
  if (/^\[TAD\]|\bTAD\b/.test(t)) return 'tad';
  if (/^\[?PRD\b|^PRD\s*[-–]|\[PRD[\s-]/i.test(t)) return 'prd';
  if (/^UR\.[A-Z]/.test(t)) return 'user-requirement';
  if (/^BR\.[A-Z]/.test(t)) return 'business-requirement';
  if (/^SD\.[A-Z]/.test(t)) return 'system-design';
  if (/Deployment - Checklist/.test(chain) || /^Document Deployment/.test(t)) return 'deployment';
  if (/^(\[Product Release\]|\[Product Guide\]|\[TO\])|Release Notes/i.test(t)) return 'release';
  if (/^Dokumentasi|API Reference|Open API|Callback Specification|Status Code Mapping/i.test(t)) return 'api-doc';
  if (/^UAT\b/i.test(t)) return 'uat';
  if (/^Product Update/i.test(t)) return 'product-update';
  if (/Meeting|Notes \[RAW\]|Weekly/i.test(t + ' ' + chain)) return 'notes';
  if (/Post-?mortem/i.test(t + ' ' + chain)) return 'postmortem';
  return 'page';
}

export function lifecycleOf(ancestors, title = '') {
  const chain = [...ancestors.map((a) => a.title), title].join(' / ');
  if (/Deprecated|Archive/i.test(chain)) return 'archived';
  for (const a of [...ancestors].reverse()) {
    if (/Backlog/i.test(a.title)) return 'backlog';
    if (/\bDevelopment -/i.test(a.title)) return 'development';
    if (/Release/i.test(a.title)) return 'released';
  }
  return undefined;
}

export function domainOf(ancestors) {
  const idx = ancestors.findIndex((a) => a.title === 'Product Development');
  if (idx >= 0 && ancestors[idx + 1]) return ancestors[idx + 1].title;
  // top-level section directly under the space home
  return ancestors[1]?.title;
}
