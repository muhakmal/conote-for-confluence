// People lookup for mentions: local cache (filled by pull) first, Atlassian user search second.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { Confluence } from './confluence.js';

const FILE = () => path.join(config.cacheDir, 'users.json');
const norm = (s) => String(s).replace(/\s*\(unlicensed\)\s*/i, '').replace(/^@/, '').trim().toLowerCase();
let cf;

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(FILE(), 'utf8'));
  } catch {
    return {};
  }
}
function writeCache(cache) {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(cache, null, 1));
}

/** @returns {Promise<{accountId:string, name:string}[]>} */
export async function searchUsers(q = '', { remote = true, limit = 12 } = {}) {
  const cache = readCache();
  const term = norm(q);
  const local = Object.entries(cache)
    .map(([accountId, name]) => ({ accountId, name }))
    .filter((u) => !/unlicensed/i.test(u.name) && (!term || norm(u.name).includes(term)))
    .sort((a, b) => (norm(a.name).startsWith(term) ? 0 : 1) - (norm(b.name).startsWith(term) ? 0 : 1) || a.name.localeCompare(b.name));
  if (!remote || term.length < 2 || local.length >= limit) return local.slice(0, limit);
  try {
    cf ||= new Confluence();
    const cql = `type=user AND user.fullname~"${q.replace(/["\\]/g, '')}"`;
    const res = await cf.request(`/rest/api/search/user?cql=${encodeURIComponent(cql)}&limit=${limit}`);
    let changed = false;
    for (const r of res.results || []) {
      const u = r.user;
      if (!u?.accountId || u.accountType === 'app') continue;
      const name = u.publicName || u.displayName;
      if (cache[u.accountId] !== name) (cache[u.accountId] = name), (changed = true);
      if (!local.some((x) => x.accountId === u.accountId)) local.push({ accountId: u.accountId, name });
    }
    if (changed) writeCache(cache);
  } catch {}
  return local.slice(0, limit);
}

/** Resolve display names to account ids. Unknown names map to null. */
export async function resolveUsers(names) {
  const out = new Map();
  const unique = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))];
  for (const name of unique) {
    let hits = (await searchUsers(name, { remote: false, limit: 50 })).filter((u) => norm(u.name) === norm(name));
    if (!hits.length) hits = (await searchUsers(name, { remote: true, limit: 10 })).filter((u) => norm(u.name) === norm(name));
    out.set(name, hits.length === 1 ? hits[0].accountId : hits[0]?.accountId || null);
  }
  return out;
}
