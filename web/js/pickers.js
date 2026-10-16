// Person and date pickers shared by the Markdown and Write editors.
import { api } from './api.js';
import { dialog, esc, icon, debounce } from './ui.js';

/** @returns {Promise<string|null>} display name */
export function pickUser(initial = '') {
  return dialog({
    title: 'Mention a person',
    subtitle: 'Names come from your Confluence site. The mention links to their profile when published.',
    className: 'palette',
    render(b, close) {
      b.innerHTML = `<div class="palette-input">${icon('at')}<input placeholder="Type a name…" value="${esc(initial)}" autofocus></div><div class="palette-list"></div>`;
      const input = b.querySelector('input');
      const list = b.querySelector('.palette-list');
      let items = [];
      let sel = 0;
      let seq = 0;
      const draw = () => {
        list.innerHTML = items.length
          ? items.map((u, i) => `<div class="palette-item ${i === sel ? 'sel' : ''}" data-i="${i}"><span class="avatar">${esc(initials(u.name))}</span><div class="grow"><div class="t">${esc(u.name)}</div></div></div>`).join('')
          : `<div class="empty">${input.value.trim().length < 2 ? 'Type at least 2 letters' : 'No one found'}</div>`;
      };
      const load = debounce(async () => {
        const my = ++seq;
        const res = await api.users(input.value.trim()).catch(() => []);
        if (my !== seq) return;
        items = res;
        sel = 0;
        draw();
      }, 180);
      input.addEventListener('input', load);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!items.length) return;
          sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          draw();
          list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' && items[sel]) close(items[sel].name);
      });
      list.addEventListener('click', (e) => {
        const it = e.target.closest('[data-i]');
        if (it) close(items[Number(it.dataset.i)].name);
      });
      load();
    },
  }).then((v) => v || null);
}

/** @returns {Promise<string|null>} YYYY-MM-DD */
export function pickDate(initial) {
  const today = new Date().toLocaleDateString('sv-SE');
  return dialog({
    title: 'Insert date',
    render(b, close) {
      b.innerHTML = `
        <div class="dialog-body">
          <input class="input" type="date" value="${esc(initial || today)}" autofocus>
          <div class="quick-parents">
            <button class="chip" data-d="0">Today</button><button class="chip" data-d="1">Tomorrow</button>
            <button class="chip" data-d="7">In a week</button><button class="chip" data-d="14">In 2 weeks</button><button class="chip" data-d="30">In a month</button>
          </div>
        </div>
        <div class="dialog-foot"><button class="btn" data-x>Cancel</button><button class="btn btn-primary" data-ok>${icon('calendar')} Insert</button></div>`;
      const input = b.querySelector('input');
      b.querySelector('.quick-parents').addEventListener('click', (e) => {
        const d = e.target.closest('[data-d]')?.dataset.d;
        if (d === undefined) return;
        const dt = new Date();
        dt.setDate(dt.getDate() + Number(d));
        close(dt.toLocaleDateString('sv-SE'));
      });
      input.addEventListener('keydown', (e) => e.key === 'Enter' && input.value && close(input.value));
      b.querySelector('[data-x]').onclick = () => close(null);
      b.querySelector('[data-ok]').onclick = () => close(input.value || null);
    },
  }).then((v) => v || null);
}

function initials(name) {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

/** Name suggestions under a comma-separated people input (last name being typed). */
export function attachPeopleAutocomplete(input, onPick) {
  let box = null;
  let seq = 0;
  const close = () => {
    box?.remove();
    box = null;
  };
  const show = debounce(async () => {
    const parts = input.value.split(',');
    const term = parts[parts.length - 1].trim();
    if (term.length < 2 || document.activeElement !== input) return close();
    const my = ++seq;
    const users = await api.users(term).catch(() => []);
    if (my !== seq || document.activeElement !== input) return;
    const already = new Set(parts.slice(0, -1).map((p) => p.trim().toLowerCase()));
    const list = users.filter((u) => !already.has(u.name.toLowerCase()) && u.name.toLowerCase() !== term.toLowerCase()).slice(0, 6);
    close();
    if (!list.length) return;
    box = document.createElement('div');
    box.className = 'menu suggest';
    box.innerHTML = list.map((u, i) => `<button type="button" data-i="${i}"><span class="avatar">${esc(initials(u.name))}</span><span>${esc(u.name)}</span></button>`).join('');
    document.body.append(box);
    const r = input.getBoundingClientRect();
    Object.assign(box.style, { top: `${r.bottom + 4}px`, left: `${r.left}px`, minWidth: `${r.width}px` });
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const it = e.target.closest('[data-i]');
      if (!it) return;
      parts[parts.length - 1] = ` ${list[Number(it.dataset.i)].name}`;
      input.value = parts.join(',').replace(/^\s+/, '');
      close();
      onPick?.();
    });
  }, 160);
  input.addEventListener('input', show);
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => e.key === 'Escape' && close());
}
