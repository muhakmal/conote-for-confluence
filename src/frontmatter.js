import YAML from 'yaml';

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseDoc(text) {
  const m = text.match(FM_RE);
  if (!m) return { meta: {}, body: text };
  let meta = {};
  try {
    meta = YAML.parse(m[1]) || {};
  } catch {}
  return { meta, body: text.slice(m[0].length).replace(/^\r?\n/, '') };
}

export function stringifyDoc(meta, body) {
  const clean = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const yaml = Object.keys(clean).length ? YAML.stringify(clean, { lineWidth: 0 }).trimEnd() : '';
  return (yaml ? `---\n${yaml}\n---\n\n` : '') + body.replace(/^\n+/, '');
}
