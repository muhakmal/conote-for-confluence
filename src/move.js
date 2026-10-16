// Move a Confluence page in the page tree (drag & drop in the web app, `cn move` in the CLI).
import fs from 'node:fs';
import { Confluence } from './confluence.js';
import { readIndex, writeIndex } from './sync.js';
import { listDrafts, safeDraftPath } from './drafts.js';
import { parseDoc, stringifyDoc } from './frontmatter.js';

export const POSITIONS = ['append', 'before', 'after'];

/** Where the page currently sits, expressed as a move that would put it back. */
export function currentPlacement(index, id) {
  const node = index.nodes[id];
  const siblings = index.nodes[node.parentId]?.children || [];
  const i = siblings.indexOf(id);
  if (i > 0) return { position: 'after', targetId: siblings[i - 1] };
  if (i === 0 && siblings.length > 1) return { position: 'before', targetId: siblings[1] };
  return { position: 'append', targetId: node.parentId };
}

/**
 * Check a move against the pulled index. Throws with a readable message when it isn't allowed.
 * @returns {{ node: object, newParentId: string }}
 */
export function validateMove(index, id, position, targetId) {
  if (!POSITIONS.includes(position)) throw Object.assign(new Error(`Invalid position "${position}"`), { status: 400 });
  const node = index?.nodes?.[id];
  const target = index?.nodes?.[targetId];
  if (!node || !target) throw Object.assign(new Error('Page not found in the pulled index. Fetch the space and try again.'), { status: 404 });
  if (id === targetId) throw Object.assign(new Error('A page cannot be moved onto itself'), { status: 400 });
  if (node.type === 'folder' || id === index.space?.homeId) throw Object.assign(new Error('Folders and the space home cannot be moved from here'), { status: 400 });
  if (target.type === 'folder') throw Object.assign(new Error('Moving pages into Confluence folders is not supported from here. Use Confluence for folders.'), { status: 400 });
  const newParentId = position === 'append' ? targetId : target.parentId;
  if (!newParentId) throw Object.assign(new Error('Pages cannot be placed next to the space home'), { status: 400 });
  if (index.nodes[newParentId]?.type === 'folder') throw Object.assign(new Error('Moving pages into Confluence folders is not supported from here. Use Confluence for folders.'), { status: 400 });
  for (let p = newParentId; p; p = index.nodes[p]?.parentId) {
    if (p === id) throw Object.assign(new Error('A page cannot be moved under its own child page'), { status: 400 });
  }
  return { node, newParentId };
}

/** Apply a move to the in-memory index (children order + parent). */
export function applyMove(index, id, position, targetId) {
  const { node, newParentId } = validateMove(index, id, position, targetId);
  const old = index.nodes[node.parentId];
  if (old) old.children = old.children.filter((c) => c !== id);
  const parent = index.nodes[newParentId];
  parent.children = parent.children.filter((c) => c !== id);
  if (position === 'append') parent.children.push(id);
  else parent.children.splice(parent.children.indexOf(targetId) + (position === 'after' ? 1 : 0), 0, id);
  node.parentId = newParentId;
  return index;
}

/**
 * Move page `id` in Confluence, then mirror it locally: index order/parent, and parent_id of drafts
 * linked to that page. Paths in workspace/ are refreshed by the next pull.
 */
export async function movePage(id, position, targetId, { client } = {}) {
  const index = readIndex();
  const before = currentPlacement(index, id);
  validateMove(index, id, position, targetId);
  const cf = client || new Confluence();
  await cf.movePage(id, position, targetId);
  applyMove(index, id, position, targetId);
  writeIndex(index);
  const parentId = index.nodes[id].parentId;
  for (const d of listDrafts().filter((x) => String(x.confluence_id) === String(id))) {
    const abs = safeDraftPath(d.name);
    const { meta, body } = parseDoc(fs.readFileSync(abs, 'utf8'));
    meta.parent_id = parentId;
    meta.parent = index.nodes[parentId]?.title;
    fs.writeFileSync(abs, stringifyDoc(meta, body));
  }
  return { id, parentId, undo: before };
}
