// Draft editor: properties form + Markdown textarea + live preview.
import { api } from './api.js';
import { icon, esc, h, debounce, toast, dialog, confirmDialog, menu, timeAgo } from './ui.js';
import { renderDocument } from './preview.js';
import { createRichEditor } from './rich.js';
import { pickUser, pickDate, attachPeopleAutocomplete } from './pickers.js';
import { historyDialog, compareDialog } from './versions.js';

const STATUSES = ['DRAFT', 'DESIGN ON PROGRESS', 'DESIGN DONE', 'FINAL PRD', 'IN DEVELOPMENT', 'RELEASED', 'CANCELLED'];
const TRIBES = ['VAS', 'BILLER', 'PAYMENT ACCEPTANCE', 'TRANSFER', 'MERCHANT', 'WALLET', 'GLOBAL'];

const SNIPPETS = {
  h2: { label: 'Heading 2', icon: 'toc', hint: '##', line: '## ' },
  h3: { label: 'Heading 3', icon: 'toc', hint: '###', line: '### ' },
  table: { label: 'Table', icon: 'table', block: '| Column | Column |\n| --- | --- |\n| ▍ |  |\n' },
  requirements: { label: 'Requirements table', icon: 'table', block: '| # | User Story | Keyword | Requirement |\n| --- | --- | --- | --- |\n| 1 | Sebagai ▍ | KEYWORD | 1. … |\n' },
  checklist: { label: 'Checklist', icon: 'checklist', line: '- [ ] ' },
  note: { label: 'Info panel', icon: 'info', block: '> [!NOTE]\n> ▍\n' },
  warning: { label: 'Warning panel', icon: 'info', block: '> [!WARNING]\n> ▍\n' },
  tip: { label: 'Tip panel', icon: 'info', block: '> [!TIP]\n> ▍\n' },
  details: { label: 'Expand section', icon: 'details', block: '<details>\n<summary>▍Details</summary>\n\n\n\n</details>\n' },
  flowchart: { label: 'Mermaid flowchart', icon: 'diagram', block: '```mermaid\nflowchart TD\n    A[▍Start] --> B{Valid?}\n    B -- Ya --> C[Proses]\n    B -- Tidak --> D[Error]\n```\n' },
  sequence: { label: 'Mermaid sequence', icon: 'sequence', block: '```mermaid\nsequenceDiagram\n    autonumber\n    participant M as Merchant\n    participant F as Flash Mobile\n    M->>F: ▍Request\n    F-->>M: Response\n```\n' },
  state: { label: 'Mermaid state', icon: 'diagram', block: '```mermaid\nstateDiagram-v2\n    [*] --> PENDING\n    PENDING --> SUCCESS\n    PENDING --> FAILED\n    SUCCESS --> [*]\n```\n' },
  plantuml: { label: 'PlantUML', icon: 'diagram', block: '```plantuml\n@startuml\nactor Merchant\nMerchant -> "Flash Mobile": ▍request\n"Flash Mobile" --> Merchant: response\n@enduml\n```\n' },
  code: { label: 'Code block (JSON)', icon: 'code', block: '```json\n▍\n```\n' },
  status: { label: 'Status lozenge', icon: 'tag', inline: '{status:▍DRAFT}' },
  mention: { label: 'Mention person', icon: 'at', action: 'mention' },
  date: { label: 'Date', icon: 'calendar', action: 'date' },
  toc: { label: 'Table of contents', icon: 'toc', block: '[TOC]\n' },
  hr: { label: 'Divider', icon: 'hr', block: '---\n' },
  image: { label: 'Image…', icon: 'image', action: 'image' },
};

export async function openEditor({ name, view, topActions, crumbs, app, getTree, onChanged, navigate, reload }) {
  const data = await api.draft(name);
  let meta = { ...data.meta };
  let body = data.body;
  const draftDir = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
  let mode = localStorage.getItem('cn-editor-mode') || 'rich';
  if (innerWidth <= 900 && mode === 'split') mode = 'rich';
  let saveState = 'saved';
  let destroyed = false;
  let deleted = false;

  app.classList.add('editing');
  crumbs.innerHTML = `<a href="#/drafts">Drafts</a><span class="sep">/</span><span class="current">${esc(meta.title || name)}</span>`;

  topActions.innerHTML = `
    <span class="save-state" id="save-state">Saved</span>
    <button class="btn btn-present" data-act="present" title="Read / Present mode (⌘P)">${icon('present')}<span class="label-hide">Present</span></button>
    <div class="mode-switch" role="group" aria-label="Editor mode">
      <button data-mode="rich" title="Write (normal)">${icon('edit')}<span class="mode-label">Write</span></button>
      <button data-mode="write" title="Markdown">${icon('code')}<span class="mode-label">Markdown</span></button>
      <button data-mode="split" class="mode-split" title="Split">${icon('split')}</button>
      <button data-mode="preview" title="Preview">${icon('eye')}</button>
    </div>
    <button class="icon-btn" data-act="export" title="Export" aria-label="Export">${icon('download')}</button>
    <button class="btn btn-primary" data-act="publish">${icon('publish')}<span class="label-hide">Publish</span></button>
    <button class="icon-btn" data-act="more" aria-label="More">${icon('more')}</button>`;

  view.innerHTML = `
    <div class="editor page-enter" data-mode="${mode}">
      <section class="pane pane-write">
        <div class="toolbar" role="toolbar" aria-label="Formatting">
          <button class="icon-btn" data-snip="h2" title="Heading" style="font-weight:700;font-size:13px">H2</button>
          <button class="icon-btn" data-snip="h3" title="Subheading" style="font-weight:700;font-size:12px">H3</button>
          <span class="sep"></span>
          <button class="icon-btn" data-wrap="**" title="Bold (⌘B)">${icon('bold')}</button>
          <button class="icon-btn" data-wrap="_" title="Italic (⌘I)">${icon('italic')}</button>
          <button class="icon-btn" data-wrap="~~" title="Strikethrough">${icon('strike')}</button>
          <button class="icon-btn" data-wrap="\`" title="Inline code (⌘E)">${icon('code')}</button>
          <button class="icon-btn" data-act="link" title="Link (⌘K)">${icon('link')}</button>
          <span class="sep"></span>
          <button class="icon-btn" data-prefix="- " title="Bullet list">${icon('list')}</button>
          <button class="icon-btn" data-prefix="1. " title="Numbered list">${icon('olist')}</button>
          <button class="icon-btn" data-snip="checklist" title="Checklist">${icon('checklist')}</button>
          <button class="icon-btn" data-snip="table" title="Table">${icon('table')}</button>
          <span class="sep"></span>
          <button class="icon-btn" data-snip="note" title="Info panel">${icon('info')}</button>
          <button class="icon-btn" data-snip="details" title="Expand section">${icon('details')}</button>
          <button class="icon-btn" data-act="diagram" title="Diagram">${icon('diagram')}</button>
          <button class="icon-btn" data-snip="status" title="Status">${icon('tag')}</button>
          <button class="icon-btn" data-snip="mention" title="Mention person (@)">${icon('at')}</button>
          <button class="icon-btn" data-snip="date" title="Date">${icon('calendar')}</button>
          <button class="icon-btn" data-snip="image" title="Image">${icon('image')}</button>
          <span class="sep"></span>
          <button class="icon-btn" data-act="undo" title="Undo (⌘Z)" aria-label="Undo" disabled>${icon('undo')}</button>
          <button class="icon-btn" data-act="redo" title="Redo (⌘⇧Z)" aria-label="Redo" disabled>${icon('redo')}</button>
          <span class="sep"></span>
          <button class="icon-btn" data-act="slash" title="Insert block (/)">${icon('plus')}</button>
        </div>
        <div class="write-scroll">
          <div class="props-panel ${(localStorage.getItem('cn-props-collapsed') ?? (innerWidth <= 640 ? '1' : '0')) === '1' ? 'collapsed' : ''}">
            <input class="input input-title" data-meta="title" placeholder="[PRD] Judul dokumen" value="${esc(meta.title || '')}" aria-label="Title">
            <div class="props-head" data-act="toggle-props"><h3>${icon('down')} Page properties</h3><span class="pill" id="publish-pill"></span></div>
            <div class="props-body"><div><div class="props-grid">
              <div class="field wide"><label>Publish under</label><button class="btn parent-btn" data-act="parent">${icon('tree')}<span id="parent-label"></span></button></div>
              <div class="field"><label>Document status</label><select class="select" data-meta="doc_status">${STATUSES.map((s) => `<option ${meta.doc_status === s ? 'selected' : ''}>${s}</option>`).join('')}${meta.doc_status && !STATUSES.includes(meta.doc_status) ? `<option selected>${esc(meta.doc_status)}</option>` : ''}</select></div>
              <div class="field"><label>Tribe</label><input class="input" data-meta="tribe" list="tribes" value="${esc([].concat(meta.tribe || []).join(', '))}" placeholder="BILLER, MERCHANT"></div>
              <div class="field"><label>Document owner</label><input class="input" data-meta="owner" value="${esc([].concat(meta.owner || []).join(', '))}"></div>
              <div class="field"><label>Target release</label><input class="input" data-meta="target_release" value="${esc(meta.target_release || '')}" placeholder="W1 October"></div>
              <div class="field"><label>Designer</label><input class="input" data-meta="designer" value="${esc([].concat(meta.designer || []).join(', '))}"></div>
              <div class="field"><label>Tech lead</label><input class="input" data-meta="tech_lead" value="${esc([].concat(meta.tech_lead || []).join(', '))}"></div>
              <div class="field"><label>QA</label><input class="input" data-meta="qa" value="${esc([].concat(meta.qa || []).join(', '))}"></div>
              <div class="field"><label>Epic</label><input class="input" data-meta="epic" value="${esc(meta.epic || '')}" placeholder="JIRA-123"></div>
              <div class="field wide"><label>${icon('label')} Labels</label><input class="input" data-meta="labels" value="${esc([].concat(meta.labels || []).join(', '))}" placeholder="prd, biller, qris"></div>
            </div></div></div>
            <datalist id="tribes">${TRIBES.map((t) => `<option value="${t}">`).join('')}</datalist>
          </div>
          <textarea class="md-input" spellcheck="true" autocapitalize="sentences" aria-label="Markdown"></textarea>
        </div>
      </section>
      <section class="pane pane-preview"><div class="scroller"><article class="doc"></article></div></section>
      <section class="pane pane-rich"><div class="rich-scroll"><article class="doc rich-doc" aria-label="Document"></article></div></section>
    </div>`;

  const editorEl = view.querySelector('.editor');
  const ta = view.querySelector('.md-input');
  const writeScroll = view.querySelector('.write-scroll');
  const previewScroll = view.querySelector('.pane-preview .scroller');
  const doc = view.querySelector('.doc');
  const saveEl = topActions.querySelector('#save-state');
  ta.value = body;

  const autosize = () => {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };

  // ---- properties ----
  const listFields = new Set(['tribe', 'owner', 'designer', 'tech_lead', 'qa', 'labels']);
  const readMeta = () => {
    view.querySelectorAll('[data-meta]').forEach((el) => {
      const k = el.dataset.meta;
      let v = el.value.trim();
      if (listFields.has(k)) {
        const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
        v = parts.length > 1 ? parts : parts[0] || '';
      }
      if (v === '' || (Array.isArray(v) && !v.length)) delete meta[k];
      else meta[k] = v;
    });
  };
  const parentLabel = () => {
    const tree = getTree();
    const id = meta.parent_id ? String(meta.parent_id) : tree?.space?.homeId;
    const node = tree?.nodes?.[id];
    view.querySelector('#parent-label').textContent = node ? breadcrumb(tree, id) : meta.parent || 'Space home (pick a section)';
  };
  const publishPill = () => {
    const pill = view.querySelector('#publish-pill');
    if (meta.confluence_id) {
      pill.className = 'pill pill-green';
      pill.textContent = `Published v${meta.confluence_version || '?'} · ${timeAgo(meta.published_at)}`;
    } else {
      pill.className = 'pill';
      pill.textContent = 'Not published';
    }
  };
  parentLabel();
  publishPill();
  view.querySelectorAll('[data-meta="owner"], [data-meta="designer"], [data-meta="tech_lead"], [data-meta="qa"]').forEach((el) =>
    attachPeopleAutocomplete(el, () => el.dispatchEvent(new Event('input'))),
  );

  // ---- preview ----
  const render = () => {
    renderDocument(doc, meta, body, { draftDir });
  };
  const renderSoon = debounce(render, 140);

  // ---- saving ----
  const setSave = (state, text) => {
    saveState = state;
    saveEl.className = `save-state ${state === 'dirty' ? 'dirty' : state === 'error' ? 'error' : ''}`;
    saveEl.textContent = text;
  };
  const save = async () => {
    if (deleted || (destroyed && saveState !== 'dirty')) return;
    if (mode === 'rich') rich.flush();
    readMeta();
    body = ta.value;
    setSave('saving', 'Saving…');
    try {
      await api.saveDraft(name, meta, body);
      setSave('saved', 'Saved');
      onChanged?.();
    } catch (e) {
      setSave('error', 'Save failed');
      toast(e.status === 404 ? 'This draft was deleted (see Recently deleted on the Drafts page). Your latest edits were not saved.' : esc(e.message), { type: 'error', timeout: 8000 });
    }
  };
  const saveSoon = debounce(save, 700);
  const changed = () => {
    body = ta.value;
    setSave('dirty', 'Editing');
    saveSoon();
    renderSoon();
  };

  ta.addEventListener('input', () => {
    autosize();
    changed();
    maybeSlash();
  });
  view.querySelectorAll('[data-meta]').forEach((el) =>
    el.addEventListener('input', () => {
      readMeta();
      if (el.dataset.meta === 'title') crumbs.querySelector('.current').textContent = meta.title || name;
      setSave('dirty', 'Editing');
      saveSoon();
      renderSoon();
    }),
  );

  // ---- text helpers (keep native undo via insertText) ----
  const insert = (text, start = ta.selectionStart, end = ta.selectionEnd) => {
    ta.focus();
    ta.setSelectionRange(start, end);
    const caret = text.indexOf('▍');
    const clean = text.replace('▍', '');
    if (!document.execCommand('insertText', false, clean)) {
      ta.setRangeText(clean, start, end, 'end');
      ta.dispatchEvent(new Event('input'));
    }
    if (caret >= 0) ta.setSelectionRange(start + caret, start + caret);
  };
  const lineStart = (pos) => ta.value.lastIndexOf('\n', pos - 1) + 1;
  const wrap = (mark, placeholder = 'text') => {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e);
    if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2) insert(sel.slice(mark.length, -mark.length), s, e);
    else insert(`${mark}${sel || `▍${placeholder}`}${mark}`, s, e);
    if (!sel) ta.setSelectionRange(s + mark.length, s + mark.length + placeholder.length);
  };
  const prefixLines = (prefix) => {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const ls = lineStart(s);
    const block = value.slice(ls, e);
    const lines = block.split('\n');
    const numbered = /^\d+\. $/.test(prefix);
    const all = lines.every((l) => (numbered ? /^\d+\. /.test(l) : l.startsWith(prefix)));
    const out = lines.map((l, i) => (all ? l.replace(numbered ? /^\d+\. / : prefix, '') : `${numbered ? `${i + 1}. ` : prefix}${l}`)).join('\n');
    insert(out, ls, e);
  };
  const insertSnippet = (key) => {
    const sn = SNIPPETS[key];
    if (!sn) return;
    if (sn.action === 'image') return pickImage();
    if (sn.action === 'mention' || sn.action === 'date') {
      const s0 = ta.selectionStart;
      const e0 = ta.selectionEnd;
      return (sn.action === 'mention' ? pickUser() : pickDate()).then((v) => v && insert(sn.action === 'mention' ? `@[${v}] ` : `{date:${v}} `, s0, e0));
    }
    const { selectionStart: s, value } = ta;
    if (sn.inline) return insert(sn.inline);
    if (sn.line) return prefixLines(sn.line);
    const ls = lineStart(s);
    const lineEmpty = !value.slice(ls, value.indexOf('\n', s) === -1 ? value.length : value.indexOf('\n', s)).trim();
    const before = lineEmpty ? (ls > 1 && value[ls - 2] !== '\n' ? '\n' : '') : '\n\n';
    const start = lineEmpty ? ls : value.indexOf('\n', s) === -1 ? value.length : value.indexOf('\n', s);
    const end = lineEmpty ? (value.indexOf('\n', s) === -1 ? value.length : value.indexOf('\n', s)) : start;
    insert(before + sn.block.replace(/\n$/, ''), start, end);
  };

  // ---- images: pick, paste, drop ----
  const relAssets = () => '../'.repeat(draftDir ? draftDir.split('/').length : 0) + '';
  const uploadImages = async (files, inserter) => {
    for (const file of files) {
      if (!/^image\//.test(file.type)) continue;
      const close = toast(`Uploading ${esc(file.name || 'image')}…`, { timeout: 0 });
      try {
        const { path } = await api.uploadAsset(file);
        const alt = (file.name || 'image').replace(/\.\w+$/, '');
        if (inserter) inserter(`${relAssets()}${path}`, alt);
        else insert(`![${alt}](${relAssets()}${path})\n`);
      } catch (e) {
        toast(esc(e.message), { type: 'error' });
      } finally {
        close();
      }
    }
  };
  const pickImage = () => {
    const input = h('<input type="file" accept="image/*" multiple hidden>');
    input.onchange = () => uploadImages([...input.files], mode === 'rich' ? (href, alt) => rich.insertMarkdown(`![${alt}](${href})`) : undefined);
    document.body.append(input);
    input.click();
    setTimeout(() => input.remove(), 60_000);
  };
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      uploadImages(files);
    }
  });
  ta.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) {
      e.preventDefault();
      uploadImages(files);
    }
  });

  // ---- slash menu ----
  let slashEl = null;
  let slashSel = 0;
  const closeSlash = () => {
    slashEl?.remove();
    slashEl = null;
  };
  const maybeSlash = () => {
    const pos = ta.selectionStart;
    const ls = lineStart(pos);
    const typed = ta.value.slice(ls, pos);
    const m = /^\/([\w-]*)$/.exec(typed);
    if (!m) return closeSlash();
    const q = m[1].toLowerCase();
    const items = Object.entries(SNIPPETS).filter(([k, v]) => !q || k.includes(q) || v.label.toLowerCase().includes(q));
    if (!items.length) return closeSlash();
    showSlash(items, ls, pos);
  };
  const showSlash = (items, from, to) => {
    closeSlash();
    slashSel = 0;
    slashEl = h('<div class="menu slash" role="listbox"></div>');
    items.forEach(([k, v], i) => {
      const b = h(`<button role="option" data-k="${k}" class="${i === 0 ? 'sel' : ''}">${icon(v.icon)}<span>${esc(v.label)}</span></button>`);
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(k);
      });
      slashEl.append(b);
    });
    const pick = (k) => {
      closeSlash();
      if (from !== undefined) {
        ta.setSelectionRange(from, to);
        document.execCommand('delete') || ta.setRangeText('', from, to, 'end');
      }
      insertSnippet(k);
    };
    slashEl.pick = () => pick(items[slashSel][0]);
    slashEl.move = (d) => {
      slashSel = (slashSel + d + items.length) % items.length;
      [...slashEl.children].forEach((c, i) => c.classList.toggle('sel', i === slashSel));
      slashEl.children[slashSel].scrollIntoView({ block: 'nearest' });
    };
    document.body.append(slashEl);
    const r = caretRect(ta);
    const top = r.bottom + 6 + 300 > innerHeight ? r.top - Math.min(300, slashEl.offsetHeight) - 6 : r.bottom + 6;
    slashEl.style.top = `${Math.max(8, top)}px`;
    slashEl.style.left = `${Math.min(r.left, innerWidth - 270)}px`;
  };

  // ---- keyboard ----
  ta.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (slashEl) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        return slashEl.move(e.key === 'ArrowDown' ? 1 : -1);
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        return slashEl.pick();
      }
      if (e.key === 'Escape') return closeSlash();
    }
    if (mod && e.key.toLowerCase() === 'b') return e.preventDefault(), wrap('**');
    if (mod && e.key.toLowerCase() === 'i') return e.preventDefault(), wrap('_');
    if (mod && e.key.toLowerCase() === 'e') return e.preventDefault(), wrap('`', 'code');
    if (mod && e.key.toLowerCase() === 'k') return e.preventDefault(), linkPrompt();
    if (e.key === 'Tab') {
      const ls = lineStart(ta.selectionStart);
      const line = ta.value.slice(ls, ta.value.indexOf('\n', ls) === -1 ? undefined : ta.value.indexOf('\n', ls));
      e.preventDefault();
      if (/^\s*([-*+]|\d+\.) /.test(line)) {
        if (e.shiftKey) {
          if (line.startsWith('  ')) insert(line.slice(2), ls, ls + line.length);
        } else insert(`  ${line}`, ls, ls + line.length);
        return;
      }
      if (!e.shiftKey) insert('  ');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod && ta.selectionStart === ta.selectionEnd) {
      const pos = ta.selectionStart;
      const ls = lineStart(pos);
      const line = ta.value.slice(ls, pos);
      const m = /^(\s*)([-*+] \[[ x]\] |[-*+] |(\d+)\. |> )(.*)$/.exec(line);
      if (m) {
        e.preventDefault();
        if (!m[4].trim()) return insert('', ls, pos); // empty item ends the list
        const next = m[3] ? `${Number(m[3]) + 1}. ` : m[2].replace('[x]', '[ ]');
        return insert(`\n${m[1]}${next}`);
      }
      // table row: add a new empty row with same column count
      const tm = /^\|(.*)\|\s*$/.exec(ta.value.slice(ls, ta.value.indexOf('\n', pos) === -1 ? undefined : ta.value.indexOf('\n', pos)));
      if (tm && pos === (ta.value.indexOf('\n', pos) === -1 ? ta.value.length : ta.value.indexOf('\n', pos)) && !/^\s*\|?\s*-{3}/.test(tm[1])) {
        e.preventDefault();
        const cols = tm[1].split('|').length;
        return insert(`\n|${' ▍ |'}${'  |'.repeat(cols - 1)}`);
      }
    }
  });
  const linkPrompt = async () => {
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const url = await dialog({
      title: 'Insert link',
      render(b, close) {
        b.innerHTML = `<div class="dialog-body"><input class="input" placeholder="https://" autofocus></div><div class="dialog-foot"><button class="btn" data-x>Cancel</button><button class="btn btn-primary" data-ok>Insert</button></div>`;
        const inp = b.querySelector('input');
        inp.addEventListener('keydown', (ev) => ev.key === 'Enter' && close(inp.value));
        b.querySelector('[data-x]').onclick = () => close();
        b.querySelector('[data-ok]').onclick = () => close(inp.value);
      },
    });
    if (url) insert(`[${sel || '▍link'}](${url})`, s, e);
  };

  // ---- toolbar & actions ----
  const richSnippet = (key) => {
    const sn = SNIPPETS[key];
    if (!sn) return;
    if (sn.action === 'image') return pickImage();
    if (key === 'h2' || key === 'h3') return rich.exec(key);
    if (key === 'checklist') return rich.insertMarkdown('- [ ] ');
    if (sn.action === 'mention') return rich.insertMention();
    if (sn.action === 'date') return rich.insertDate();
    if (sn.inline) return rich.insertInline(sn.inline.replace('▍', ''));
    rich.insertMarkdown((sn.block || sn.line).replace('▍', ''));
  };
  const RICH_WRAP = { '**': 'bold', _: 'italic', '~~': 'strikeThrough', '`': 'code' };
  view.querySelector('.toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    // Undo/Redo: handled for both modes
    if (b.dataset.act === 'undo') {
      if (mode === 'rich') rich?.undo();
      else { ta.focus(); document.execCommand('undo'); }
      return;
    }
    if (b.dataset.act === 'redo') {
      if (mode === 'rich') rich?.redo();
      else { ta.focus(); document.execCommand('redo'); }
      return;
    }
    if (mode === 'rich') {
      if (b.dataset.wrap) rich.exec(RICH_WRAP[b.dataset.wrap]);
      else if (b.dataset.prefix) rich.exec(b.dataset.prefix === '- ' ? 'insertUnorderedList' : 'insertOrderedList');
      else if (b.dataset.snip) richSnippet(b.dataset.snip);
      else if (b.dataset.act === 'link') rich.exec('link');
      else if (b.dataset.act === 'diagram')
        menu(b, ['flowchart', 'sequence', 'state', 'plantuml'].map((k) => ({ icon: SNIPPETS[k].icon, label: SNIPPETS[k].label, onClick: () => richSnippet(k) })));
      else if (b.dataset.act === 'slash')
        menu(b, Object.entries(SNIPPETS).map(([k, v]) => ({ icon: v.icon, label: v.label, onClick: () => richSnippet(k) })));
      return;
    }
    if (b.dataset.wrap) wrap(b.dataset.wrap, b.dataset.wrap === '`' ? 'code' : 'text');
    else if (b.dataset.prefix) prefixLines(b.dataset.prefix);
    else if (b.dataset.snip) insertSnippet(b.dataset.snip);
    else if (b.dataset.act === 'link') linkPrompt();
    else if (b.dataset.act === 'diagram')
      menu(b, ['flowchart', 'sequence', 'state', 'plantuml'].map((k) => ({ icon: SNIPPETS[k].icon, label: SNIPPETS[k].label, onClick: () => insertSnippet(k) })));
    else if (b.dataset.act === 'slash') {
      ta.focus();
      showSlash(Object.entries(SNIPPETS));
    }
  });
  view.querySelector('[data-act="toggle-props"]').addEventListener('click', () => {
    const p = view.querySelector('.props-panel');
    p.classList.toggle('collapsed');
    localStorage.setItem('cn-props-collapsed', p.classList.contains('collapsed') ? '1' : '0');
  });
  view.querySelector('[data-act="parent"]').addEventListener('click', async () => {
    const id = await pickParent(getTree(), meta.parent_id);
    if (id) {
      meta.parent_id = id;
      meta.parent = getTree().nodes[id]?.t;
      parentLabel();
      setSave('dirty', 'Editing');
      saveSoon();
    }
  });

  const toolbarEl = view.querySelector('.toolbar');
  const propsEl = view.querySelector('.props-panel');
  const richDoc = view.querySelector('.rich-doc');
  const rich = createRichEditor({
    container: richDoc,
    draftDir,
    uploadImages,
    onChange: (markdown) => {
      ta.value = markdown;
      body = markdown;
      setSave('dirty', 'Editing');
      saveSoon();
    },
  });

  // ---- undo/redo button state ----
  const undoBtn = view.querySelector('[data-act="undo"]');
  const redoBtn = view.querySelector('[data-act="redo"]');
  const updateUndoRedo = () => {
    if (mode === 'rich') {
      undoBtn.disabled = !rich.canUndo();
      redoBtn.disabled = !rich.canRedo();
    } else {
      // In Markdown textarea mode the browser manages the native undo stack —
      // we always enable the buttons so the browser handles them naturally.
      undoBtn.disabled = false;
      redoBtn.disabled = false;
    }
  };
  rich.onHistoryChange(updateUndoRedo);

  const setMode = (m) => {
    if (mode === 'rich' && m !== 'rich') rich.flush();
    if (m === 'rich' && (mode !== 'rich' || !richDoc.childNodes.length)) rich.setMarkdown(ta.value);
    mode = m;
    editorEl.dataset.mode = m;
    if (m === 'rich') {
      view.querySelector('.pane-rich').prepend(toolbarEl);
      view.querySelector('.rich-scroll').prepend(propsEl);
    } else {
      view.querySelector('.pane-write').prepend(toolbarEl);
      writeScroll.prepend(propsEl);
      if (m !== 'write') render();
    }
    localStorage.setItem('cn-editor-mode', m);
    topActions.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    if (m !== 'preview') requestAnimationFrame(autosize);
    updateUndoRedo();
  };
  topActions.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  mode = null;
  setMode(localStorage.getItem('cn-editor-mode') && !(innerWidth <= 900 && localStorage.getItem('cn-editor-mode') === 'split') ? localStorage.getItem('cn-editor-mode') : 'rich');

  topActions.querySelector('[data-act="present"]')?.addEventListener('click', async () => {
    const prevMode = mode;
    if (mode === 'rich') ta.value = rich.toMarkdown();
    setMode('preview');
    const hs = Array.from(previewEl.querySelectorAll('h2, h3')).map((el) => ({
      id: el.id,
      text: el.textContent,
      depth: Number(el.tagName.slice(1)),
    }));
    window.enterPresentMode?.({
      title: meta.title || name,
      headings: hs,
      onExit: () => {
        if (prevMode && prevMode !== 'preview') setMode(prevMode);
      },
    });
  });

  topActions.querySelector('[data-act="export"]').addEventListener('click', async (e) => {
    await save();
    menu(e.currentTarget, [
      { icon: 'word', label: 'Save as Word (.docx)', onClick: () => download(api.exportUrl('docx', { draft: name })) },
      { icon: 'globe', label: 'Save as HTML', onClick: () => download(api.exportUrl('html', { draft: name })) },
      { icon: 'external', label: 'Open HTML preview', href: `${api.exportUrl('html', { draft: name })}&inline=1` },
    ]);
  });
  // Replace the editor with what is on disk now (after restore / taking the Confluence version)
  const reopen = () => {
    saveSoon.cancel();
    setSave('saved', 'Saved');
    onChanged?.();
    reload?.();
  };
  topActions.querySelector('[data-act="publish"]').addEventListener('click', async () => {
    await save();
    const result = await publishFlow({ name, meta, getTree });
    if (result?.adopted) return reopen();
    if (result) {
      const fresh = await api.draft(name);
      meta = { ...fresh.meta };
      publishPill();
      onChanged?.();
    }
  });
  topActions.querySelector('[data-act="more"]').addEventListener('click', (e) => {
    menu(e.currentTarget, [
      { icon: 'present', label: 'Present mode (⌘P)', onClick: () => topActions.querySelector('[data-act="present"]')?.click() },
      ...(meta.confluence_url ? [{ icon: 'external', label: 'Open in Confluence', href: meta.confluence_url }] : []),
      {
        icon: 'close',
        label: 'Remove template hints',
        onClick: () => {
          let n = 0;
          if (mode === 'rich') n = rich.removeHints();
          else {
            const before = ta.value;
            const quote = /^>[ \t]*Type\s*\/\s*\w+\s+to add\b[^\n]*\n(\n)?/gim;
            ta.value = before.replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\n(\n)?/gm, '').replace(quote, '');
            n = (before.match(/^[ \t]*<!--/gm) || []).length + (before.match(quote) || []).length;
            ta.dispatchEvent(new Event('input'));
          }
          toast(n ? `Removed ${n} hint${n > 1 ? 's' : ''}` : 'No template hints');
        },
      },
      {
        icon: 'undo',
        label: 'Version history…',
        onClick: async () => {
          await save();
          const { text } = await api.draft(name);
          if (await historyDialog({ name, currentText: text })) reopen();
        },
      },
      ...(meta.confluence_id
        ? [{
            icon: 'split',
            label: 'Compare with Confluence…',
            onClick: async () => {
              await save();
              if ((await compareDialog({ name })) === 'adopted') reopen();
            },
          }]
        : []),
      { icon: 'copy', label: 'Copy Markdown', onClick: () => navigator.clipboard.writeText(ta.value).then(() => toast('Markdown copied')) },
      { divider: true },
      {
        icon: 'trash',
        label: 'Delete draft',
        onClick: async () => {
          if (await confirmDialog({ title: 'Delete draft?', message: `${esc(meta.title || name)} will be moved to .cache/trash (restore it from the Drafts page). The Confluence page is not touched.`, confirm: 'Delete', danger: true })) {
            // nothing may be written after this point, or leaving the editor would recreate the file
            saveSoon.cancel();
            deleted = true;
            await api.deleteDraft(name);
            onChanged?.();
            navigate('#/drafts');
            toast('Draft deleted');
          }
        },
      },
    ]);
  });

  // Scroll sync (split mode): preview follows the writing pane proportionally
  let syncing = false;
  writeScroll.addEventListener(
    'scroll',
    () => {
      if (mode !== 'split' || syncing) return;
      const ratio = writeScroll.scrollTop / Math.max(1, writeScroll.scrollHeight - writeScroll.clientHeight);
      syncing = true;
      previewScroll.scrollTop = ratio * (previewScroll.scrollHeight - previewScroll.clientHeight);
      requestAnimationFrame(() => (syncing = false));
    },
    { passive: true },
  );

  const onKey = (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveSoon.flush();
      toast('Saved');
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      topActions.querySelector('[data-act="publish"]').click();
    }
    // Undo: Cmd/Ctrl+Z — intercept only in rich mode (textarea uses browser native)
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && mode === 'rich') {
      e.preventDefault();
      rich.undo();
    }
    // Redo: Cmd/Ctrl+Shift+Z or Ctrl+Y — intercept only in rich mode
    if (mod && (e.shiftKey && e.key.toLowerCase() === 'z' || !e.shiftKey && e.key.toLowerCase() === 'y') && mode === 'rich') {
      e.preventDefault();
      rich.redo();
    }
  };
  document.addEventListener('keydown', onKey);
  const beforeUnload = (e) => {
    if (saveState === 'dirty' || saveState === 'saving') {
      saveSoon.flush();
      e.preventDefault();
    }
  };
  window.addEventListener('beforeunload', beforeUnload);

  render();
  requestAnimationFrame(autosize);
  if (!body.trim()) (mode === 'rich' ? rich.focus() : ta.focus());

  return async function destroy() {
    destroyed = true;
    closeSlash();
    rich.destroy();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeunload', beforeUnload);
    app.classList.remove('editing');
    if (mode === 'rich') rich.flush();
    if (saveState === 'dirty') {
      saveSoon.cancel();
      await save();
    }
  };
}

function download(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.append(a);
  a.click();
  a.remove();
  toast('Preparing export…', { timeout: 2200 });
}

export function breadcrumb(tree, id) {
  const parts = [];
  let n = tree?.nodes?.[id];
  while (n) {
    parts.unshift(n.t);
    n = tree.nodes[n.p];
  }
  return parts.slice(1).join(' / ') || parts[0] || '';
}

/** Mirror a caret position to viewport coordinates. */
function caretRect(ta) {
  const div = document.createElement('div');
  const cs = getComputedStyle(ta);
  for (const p of ['fontFamily', 'fontSize', 'lineHeight', 'padding', 'border', 'letterSpacing', 'whiteSpace', 'wordWrap', 'tabSize', 'boxSizing'])
    div.style[p] = cs[p];
  Object.assign(div.style, { position: 'fixed', visibility: 'hidden', whiteSpace: 'pre-wrap', width: `${ta.clientWidth}px`, top: '0', left: '0' });
  div.textContent = ta.value.slice(0, ta.selectionStart);
  const span = document.createElement('span');
  span.textContent = '​';
  div.append(span);
  document.body.append(div);
  const r = ta.getBoundingClientRect();
  const top = r.top + span.offsetTop - ta.scrollTop;
  const left = r.left + span.offsetLeft;
  const lh = parseFloat(cs.lineHeight) || 20;
  div.remove();
  return { top, bottom: top + lh, left };
}

export async function pickParent(tree, current, { title = 'Publish under…', subtitle = 'Choose the parent page in Confluence. Sections like “[PRD] Backlog - Biller” are listed first.' } = {}) {
  if (!tree?.nodes) {
    toast('Fetch the space first to choose a parent page', { type: 'error' });
    return null;
  }
  const all = Object.values(tree.nodes).filter((n) => n.d !== 'folder' && n.l !== 'archived');
  const preferred = (n) => (n.d === 'section' ? 0 : n.c?.length ? 1 : 2);
  return dialog({
    title,
    subtitle,
    className: 'palette',
    render(b, close) {
      b.innerHTML = `<div class="palette-input">${icon('search')}<input placeholder="Filter pages…" autofocus></div><div class="palette-list"></div>`;
      const input = b.querySelector('input');
      const list = b.querySelector('.palette-list');
      let sel = 0;
      let items = [];
      const draw = () => {
        const q = input.value.trim().toLowerCase();
        items = all
          .filter((n) => !q || n.t.toLowerCase().includes(q) || (n.m || '').toLowerCase().includes(q))
          .sort((a, b2) => preferred(a) - preferred(b2) || a.t.localeCompare(b2.t))
          .slice(0, 80);
        sel = Math.min(sel, Math.max(0, items.length - 1));
        list.innerHTML = items
          .map((n, i) => `<div class="palette-item ${i === sel ? 'sel' : ''} ${String(n.id) === String(current) ? 'current' : ''}" data-i="${i}"><span class="dot dot-${n.d}"></span><div class="grow"><div class="t">${esc(n.t)}</div><div class="s">${esc(breadcrumb(tree, n.p))}</div></div>${String(n.id) === String(current) ? icon('check') : ''}</div>`)
          .join('') || '<div class="empty">No pages</div>';
      };
      input.addEventListener('input', () => ((sel = 0), draw()));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          draw();
          list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
        }
        if (e.key === 'Enter' && items[sel]) close(items[sel].id);
      });
      list.addEventListener('click', (e) => {
        const it = e.target.closest('[data-i]');
        if (it) close(items[Number(it.dataset.i)].id);
      });
      draw();
    },
  });
}

/** Confirm → progress → result (or conflict resolution). */
export async function publishFlow({ name, meta, getTree }) {
  const tree = getTree();
  const isUpdate = !!meta.confluence_id;
  const parentId = meta.parent_id || tree?.space?.homeId;
  const go = await dialog({
    title: isUpdate ? 'Update Confluence page' : 'Publish to Confluence',
    subtitle: isUpdate ? 'Your local draft will replace the current page content.' : 'A new page will be created in the space.',
    render(b, close) {
      b.innerHTML = `
        <div class="dialog-body">
          <dl class="kv">
            <dt>Title</dt><dd><strong>${esc(meta.title || '(untitled)')}</strong></dd>
            <dt>${isUpdate ? 'Page' : 'Parent'}</dt><dd>${isUpdate ? `<a href="${esc(meta.confluence_url)}" target="_blank" rel="noopener">v${esc(meta.confluence_version)} ${icon('external')}</a>` : esc(breadcrumb(tree, parentId) || 'Space home')}</dd>
            <dt>Status</dt><dd>${esc(meta.doc_status || 'DRAFT')}</dd>
          </dl>
          <input class="input" data-msg placeholder="Version note (optional)">
        </div>
        <div class="dialog-foot"><button class="btn" data-x>Cancel</button><button class="btn btn-primary" data-ok>${icon('publish')} ${isUpdate ? 'Update page' : 'Publish'}</button></div>`;
      b.querySelector('[data-x]').onclick = () => close();
      b.querySelector('[data-ok]').onclick = () => close({ message: b.querySelector('[data-msg]').value.trim() || undefined });
    },
  });
  if (!go) return null;
  return runPublish(name, { message: go.message });
}

async function runPublish(name, opts) {
  let result = null;
  const followUp = await dialog({
    title: 'Publishing…',
    dismissable: false,
    render(b, close, overlay) {
      const steps = [
        ['render', 'Render diagrams & convert'],
        ['check', 'Check remote version'],
        ['upload', 'Upload attachments'],
        ['update', 'Save page'],
      ];
      b.innerHTML = `<div class="dialog-body"><div class="steps">${steps.map(([k, l]) => `<div class="step" data-step="${k}"><span class="ring"></span><span>${l}</span></div>`).join('')}</div></div>`;
      let current = null;
      const mark = (phase) => {
        const map = { create: 'update', done: 'done' };
        const key = map[phase] || phase;
        const order = steps.map((s) => s[0]);
        const idx = key === 'done' ? order.length : order.indexOf(key);
        if (idx < 0) return;
        b.querySelectorAll('.step').forEach((el, i) => {
          el.classList.toggle('done', i < idx);
          el.classList.toggle('active', i === idx);
        });
        current = key;
      };
      mark('render');
      const es = new EventSource('/api/events');
      es.addEventListener('publish', (e) => {
        const d = JSON.parse(e.data);
        if (d.name === name) mark(d.phase);
      });
      api
        .publish(name, opts)
        .then((r) => {
          result = r;
          mark('done');
          overlay.querySelector('.dialog-head h2').textContent = 'Published';
          b.innerHTML = `<div class="dialog-body" style="text-align:center"><div class="success-mark"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div><p>Page is live as <strong>version ${r.version}</strong>${r.attachments.length ? ` with ${r.attachments.length} attachment${r.attachments.length > 1 ? 's' : ''}` : ''}.</p></div><div class="dialog-foot"><button class="btn" data-x>Close</button><a class="btn btn-primary" href="${esc(r.url)}" target="_blank" rel="noopener">${icon('external')} Open in Confluence</a></div>`;
          b.querySelector('[data-x]').onclick = () => close();
        })
        .catch(async (err) => {
          if (err.code === 'PAGE_GONE') {
            overlay.querySelector('.dialog-head h2').textContent = 'Page not found in Confluence';
            b.innerHTML = `<div class="dialog-body"><p>${esc(err.error || err.message)}</p></div><div class="dialog-foot"><button class="btn" data-x>Cancel</button><button class="btn btn-primary" data-new>${icon('publish')} Publish as new page</button></div>`;
            b.querySelector('[data-x]').onclick = () => close();
            b.querySelector('[data-new]').onclick = () => close(runPublish(name, { ...opts, asNew: true }));
          } else if (err.code === 'CONFLICT') {
            // show what the other person changed, then let the user choose; the outer
            // dialog promise follows this one, so the caller gets the final result
            close(
              compareDialog({ name, conflict: true }).then((choice) =>
                choice === 'overwrite' ? runPublish(name, { ...opts, force: true }) : choice === 'adopted' ? { adopted: true } : null,
              ),
            );
          } else {
            overlay.querySelector('.dialog-head h2').textContent = 'Publish failed';
            b.innerHTML = `<div class="dialog-body"><p class="diagram-error">${esc(err.message)}</p></div><div class="dialog-foot"><button class="btn" data-x>Close</button></div>`;
            b.querySelector('[data-x]').onclick = () => close();
          }
        })
        .finally(() => es.close());
      void current;
    },
  });
  return followUp ?? result;
}
