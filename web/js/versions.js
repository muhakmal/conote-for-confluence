// Version history, "compare with Confluence" and deleted drafts.
import { api } from './api.js';
import { icon, esc, dialog, confirmDialog, toast, timeAgo } from './ui.js';
import { diffLines, hunks, diffStats } from '/lib/diff.js';

const REASONS = { save: 'Autosave', publish: 'Published', restore: 'Before restore', remote: 'Before taking Confluence version', delete: 'Deleted' };

/** Unified diff as HTML. part = { stats, hunks } */
export function diffHtml(part, { empty = 'No differences' } = {}) {
  if (!part || !part.hunks.length) return `<div class="diff-empty">${icon('check')} ${esc(empty)}</div>`;
  return `<div class="diff">${part.hunks
    .map(
      (h) =>
        `<div class="diff-hunk"><div class="diff-at">Line ${h.bStart}</div>${h.lines
          .map((l) => `<div class="diff-line diff-${l.op === '+' ? 'add' : l.op === '-' ? 'del' : 'eq'}"><span class="diff-op">${l.op === '=' ? '' : l.op}</span><span class="diff-text">${esc(l.line) || '&#8203;'}</span></div>`)
          .join('')}</div>`,
    )
    .join('')}</div>`;
}

const statsHtml = (s) => `<span class="diff-stat"><b class="add">+${s.added}</b> <b class="del">−${s.removed}</b></span>`;

/**
 * Saved versions of a draft; preview any version against the current text and restore it.
 * @returns {Promise<boolean>} true when a version was restored
 */
export async function historyDialog({ name, currentText }) {
  const { history } = await api.history(name);
  let restored = false;
  await dialog({
    title: 'Version history',
    subtitle: 'Snapshots are kept locally in .cache/history: every 10 minutes while you edit, and on every publish and restore.',
    className: 'wide-dialog',
    render(b, close) {
      if (!history.length) {
        b.innerHTML = `<div class="dialog-body"><div class="empty">${icon('undo')}<h3>No saved versions yet</h3><p>They appear as you keep editing this draft.</p></div></div><div class="dialog-foot"><button class="btn" data-x>Close</button></div>`;
        b.querySelector('[data-x]').onclick = () => close();
        return;
      }
      b.innerHTML = `<div class="versions">
          <div class="version-list">${history
            .map((h, i) => `<button class="version-item ${i === 0 ? 'sel' : ''}" data-id="${esc(h.id)}"><div class="t">${esc(new Date(h.at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }))}</div><div class="s">${esc(REASONS[h.reason] || h.reason)} · ${timeAgo(h.at)}</div></button>`)
            .join('')}</div>
          <div class="version-preview"><div class="skeleton" style="height:120px"></div></div>
        </div>
        <div class="dialog-foot"><span class="grow muted" data-summary></span><button class="btn" data-x>Close</button><button class="btn btn-primary" data-restore>${icon('undo')} Restore this version</button></div>`;
      const preview = b.querySelector('.version-preview');
      const summary = b.querySelector('[data-summary]');
      let selected = history[0].id;
      const show = async (id) => {
        selected = id;
        b.querySelectorAll('.version-item').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
        const { text } = await api.snapshot(name, id);
        if (selected !== id) return;
        const ops = diffLines(text, currentText);
        const part = { stats: diffStats(ops), hunks: hunks(ops) };
        summary.innerHTML = part.hunks.length ? `Changes since this version: ${statsHtml(part.stats)}` : 'Same as the current draft';
        preview.innerHTML = diffHtml(part, { empty: 'Identical to the current draft' });
      };
      b.querySelector('.version-list').addEventListener('click', (e) => {
        const it = e.target.closest('[data-id]');
        if (it) show(it.dataset.id);
      });
      b.querySelector('[data-x]').onclick = () => close();
      b.querySelector('[data-restore]').onclick = async () => {
        try {
          await api.restoreSnapshot(name, selected);
          restored = true;
          toast('Version restored. The previous text is in history too.');
          close();
        } catch (e) {
          toast(esc(e.message), { type: 'error' });
        }
      };
      show(selected);
    },
  });
  return restored;
}

/**
 * What changed in Confluence (and locally) since the last publish.
 * @returns {Promise<'adopted'|'overwrite'|undefined>}
 */
export async function compareDialog({ name, conflict = false }) {
  return dialog({
    title: conflict ? 'Page changed in Confluence' : 'Compare with Confluence',
    className: 'wide-dialog',
    render(b, close) {
      b.innerHTML = `<div class="dialog-body"><div class="skeleton" style="height:18px;width:60%"></div><div class="skeleton" style="height:160px"></div></div>`;
      api
        .remoteDiff(name)
        .then((r) => {
          const same = Number(r.remoteVersion) === Number(r.localVersion);
          const who = r.remoteAuthor ? ` by <strong>${esc(r.remoteAuthor)}</strong>` : '';
          const lead = same
            ? `<p>Confluence is still at <strong>v${esc(r.remoteVersion)}</strong>, the version you published last. Nobody else changed it.</p>`
            : `<p>Confluence is at <strong>v${esc(r.remoteVersion)}</strong>${who}${r.remoteUpdated ? ` (${timeAgo(r.remoteUpdated)})` : ''}. You last published v${esc(r.localVersion)}.${conflict ? ' Publishing now would replace their changes.' : ''}</p>`;
          b.innerHTML = `<div class="dialog-body">${lead}
              <div class="seg-tabs" role="tablist">
                <button role="tab" data-t="remote" aria-selected="true">${r.approximate ? 'Draft vs Confluence' : 'Changed in Confluence'} ${statsHtml(r.remote.stats)}</button>
                ${r.local ? `<button role="tab" data-t="local" aria-selected="false">Changed in your draft ${statsHtml(r.local.stats)}</button>` : ''}
              </div>
              ${r.approximate ? '<p class="muted small">No record of your last publish, so this compares the whole draft with the page. Formatting differences can show up as changes.</p>' : ''}
              <div data-pane="remote">${diffHtml(r.remote, { empty: 'No changes in Confluence' })}</div>
              ${r.local ? `<div data-pane="local" hidden>${diffHtml(r.local, { empty: 'No local changes since your last publish' })}</div>` : ''}
            </div>
            <div class="dialog-foot wrap">
              <button class="btn" data-x>${conflict ? 'Cancel' : 'Close'}</button>
              ${same ? '' : `<button class="btn" data-adopt title="Replace the draft with the Confluence page. Your current text is kept in version history.">${icon('download')} Use Confluence version</button>`}
              ${conflict ? `<button class="btn btn-danger" data-force>${icon('publish')} Overwrite anyway</button>` : ''}
            </div>`;
          b.querySelector('.seg-tabs').addEventListener('click', (e) => {
            const t = e.target.closest('[data-t]')?.dataset.t;
            if (!t) return;
            b.querySelectorAll('.seg-tabs [data-t]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.t === t)));
            b.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== t));
          });
          b.querySelector('[data-x]').onclick = () => close();
          b.querySelector('[data-force]')?.addEventListener('click', () => close('overwrite'));
          b.querySelector('[data-adopt]')?.addEventListener('click', async () => {
            const ok = await confirmDialog({
              title: 'Use the Confluence version?',
              message: 'The draft will be replaced with the current page. Your text now is saved in version history, so you can copy parts back.',
              confirm: 'Use Confluence version',
            });
            if (!ok) return;
            try {
              await api.adoptRemote(name);
              toast('Draft updated from Confluence');
              close('adopted');
            } catch (e) {
              toast(esc(e.message), { type: 'error' });
            }
          });
        })
        .catch((e) => {
          b.innerHTML = `<div class="dialog-body"><p class="diagram-error">${esc(e.message)}</p></div><div class="dialog-foot"><button class="btn" data-x>Close</button>${conflict ? `<button class="btn btn-danger" data-force>Overwrite anyway</button>` : ''}</div>`;
          b.querySelector('[data-x]').onclick = () => close();
          b.querySelector('[data-force]')?.addEventListener('click', () => close('overwrite'));
        });
    },
  });
}

/** "Recently deleted" card for the Drafts page. */
export async function trashCardHtml() {
  const { trash } = await api.trash().catch(() => ({ trash: [] }));
  if (!trash.length) return '';
  return `<div class="card" style="margin-top:20px"><div class="card-head"><h2>Recently deleted</h2><span class="muted small">kept in .cache/trash</span></div>
    ${trash
      .slice(0, 20)
      .map((t) => `<div class="list-item" data-trash="${esc(t.id)}">${icon('trash')}<div class="grow"><div class="t">${esc(t.title)}</div><div class="s">${esc(t.name)} · deleted ${timeAgo(t.deletedAt)}</div></div><button class="btn btn-sm" data-restore-trash="${esc(t.id)}">${icon('undo')} Restore</button></div>`)
      .join('')}</div>`;
}
