// Drag & drop pages in the sidebar tree (native HTML5 DnD, no library).
// Drop on the top/bottom edge of a row = place before/after it, on the middle = move inside it.

const MIME = 'application/x-cn-page';

/** Same rules as src/move.js validateMove, on the client tree shape ({p, c, d}). */
export function canMove(tree, id, position, targetId) {
  const node = tree?.nodes?.[id];
  const target = tree?.nodes?.[targetId];
  if (!node || !target || id === targetId) return false;
  if (node.d === 'folder' || node.d === 'home') return false;
  if (target.d === 'folder') return false;
  const parentId = position === 'append' ? targetId : target.p;
  if (!parentId || tree.nodes[parentId]?.d === 'folder') return false;
  for (let p = parentId; p; p = tree.nodes[p]?.p) if (p === id) return false;
  // dropping where it already is does nothing
  if (position === 'append' && node.p === targetId) {
    const kids = target.c || [];
    return kids[kids.length - 1] !== id;
  }
  if (position !== 'append' && node.p === target.p) {
    const kids = tree.nodes[target.p]?.c || [];
    const i = kids.indexOf(targetId) + (position === 'after' ? 1 : 0);
    const cur = kids.indexOf(id);
    if (i === cur || i === cur + 1) return false;
  }
  return true;
}

/**
 * @param {{ el: HTMLElement, getTree: () => object, onMove: (id:string, position:string, targetId:string) => void, expand: (id:string, row:HTMLElement) => void }} opts
 */
export function enableTreeDnd({ el, getTree, onMove, expand }) {
  let dragId = null;
  let marked = null;
  let hoverTimer = null;

  const clear = () => {
    marked?.classList.remove('drop-before', 'drop-after', 'drop-inside', 'drop-no');
    marked = null;
    clearTimeout(hoverTimer);
    hoverTimer = null;
  };
  const zone = (row, y) => {
    const r = row.getBoundingClientRect();
    const f = (y - r.top) / r.height;
    return f < 0.28 ? 'before' : f > 0.72 ? 'after' : 'append';
  };

  el.addEventListener('dragstart', (e) => {
    const row = e.target.closest?.('.tree-row[draggable="true"]');
    if (!row) return;
    dragId = row.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(MIME, dragId);
    e.dataTransfer.setData('text/plain', row.querySelector('.label')?.textContent || dragId);
    // after the browser took its drag image, so the ghost isn't faded too
    requestAnimationFrame(() => dragId === row.dataset.id && row.classList.add('dragging'));
  });
  el.addEventListener('dragend', () => {
    dragId = null;
    el.querySelectorAll('.tree-row.dragging').forEach((r) => r.classList.remove('dragging'));
    clear();
  });
  el.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const row = e.target.closest('.tree-row');
    if (!row) return clear();
    const pos = zone(row, e.clientY);
    const ok = canMove(getTree(), dragId, pos, row.dataset.id);
    if (marked !== row) clear();
    marked = row;
    row.classList.toggle('drop-before', ok && pos === 'before');
    row.classList.toggle('drop-after', ok && pos === 'after');
    row.classList.toggle('drop-inside', ok && pos === 'append');
    row.classList.toggle('drop-no', !ok && row.dataset.id !== dragId);
    if (ok) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
    // hovering over a collapsed page opens it, so you can drop deeper
    if (pos === 'append' && row.getAttribute('aria-expanded') === 'false' && !hoverTimer) {
      hoverTimer = setTimeout(() => {
        if (marked === row) expand(row.dataset.id, row);
      }, 700);
    } else if (pos !== 'append') {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  });
  el.addEventListener('dragleave', (e) => {
    if (marked && !marked.contains(e.relatedTarget)) clear();
  });
  el.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData(MIME) || dragId;
    const row = e.target.closest('.tree-row');
    if (!id || !row) return;
    e.preventDefault();
    const pos = zone(row, e.clientY);
    clear();
    if (canMove(getTree(), id, pos, row.dataset.id)) onMove(id, pos, row.dataset.id);
  });
}
