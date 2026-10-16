// "Normal" writing mode: a contenteditable document that round-trips to Notebook Markdown.
import { Marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';
import { createMarkdown, escapeHtml } from '/lib/notebook-md.js';
import { createHtmlToMarkdown, b64 } from '/lib/html2md.js';
import { renderDiagram, imageSrc } from './preview.js';
import { dialog, esc, icon } from './ui.js';
import { pickUser, pickDate } from './pickers.js';

const PURIFY = {
  ADD_TAGS: ['details', 'summary', 'figure', 'nav', 'kbd'],
  ADD_ATTR: ['open', 'data-md', 'data-lang', 'data-src', 'contenteditable', 'data-kind', 'data-hint', 'align', 'checked'],
};

export function createRichEditor({ container, draftDir, onChange, uploadImages }) {
  const toMarkdown = createHtmlToMarkdown();
  const md = createMarkdown(Marked, {
    target: 'html',
    diagram: (kind, code) => atomic(`\`\`\`${kind}\n${code}\n\`\`\``, `<figure class="diagram diagram-${kind} diagram-box loading" data-kind="${kind}"></figure>`),
    image: (href, alt) => `<img src="${escapeHtml(imageSrc(href, { draftDir }))}" data-src="${escapeHtml(href)}" alt="${escapeHtml(alt)}">`,
  });

  container.classList.add('rich');
  container.setAttribute('contenteditable', 'true');
  container.setAttribute('spellcheck', 'true');
  document.execCommand('defaultParagraphSeparator', false, 'p');

  const renderHtml = (markdown) => {
    let html = md.render(markdown || '');
    // TOC placeholder and status lozenges are atomic (edited through their own UI)
    html = html.replace(/<nav class="toc">[\s\S]*?<\/nav>|<nav class="toc" data-toc><\/nav>/g, () => atomic('[TOC]', '<nav class="toc toc-chip">Table of contents</nav>'));
    html = html.replace(/(<p class="hint"[^>]*>)([\s\S]*?)<\/p>/g, '$1$2<span class="hint-x" role="button" title="Remove hint" aria-label="Remove hint">×</span></p>');
    html = html.replace(/<span class="mention">@([^<]*)<\/span>/g, (_, n) => atomic(`@[${decode(n)}]`, `<span class="mention">@${n}</span>`));
    html = html.replace(/<span class="date-chip" data-date="([\d-]+)">([^<]*)<\/span>/g, (_, d, t) => atomic(`{date:${d}}`, `<span class="date-chip" data-date="${d}">${t}</span>`));
    html = html.replace(/<span class="status status-(\w+)">([^<]*)<\/span>/g, '<span class="status status-$1" contenteditable="false">$2</span>');
    return DOMPurify.sanitize(html || '<p><br></p>', PURIFY);
  };

  const hydrate = (root = container) => {
    root.querySelectorAll('figure.diagram[data-md]').forEach((fig) => {
      const src = b64.dec(fig.getAttribute('data-md'));
      const m = /^```(\w+)\n([\s\S]*)\n```$/.exec(src.trim());
      if (!m) return;
      const kind = m[1];
      const key = `${kind}:${m[2].length}:${hashCode(m[2])}`;
      fig.title = 'Click to edit diagram';
      renderDiagram({ key, kind, code: m[2] }).then(
        (svg) => {
          fig.classList.remove('loading', 'diagram-box');
          fig.innerHTML = svg;
        },
        (e) => {
          fig.classList.remove('loading');
          fig.innerHTML = `<div class="diagram-error">${esc(String(e.message || e).split('\n')[0])}</div>`;
        },
      );
    });
  };

  let lastMarkdown = '';
  let lastRange = null;
  document.addEventListener('selectionchange', () => {
    const sel = getSelection();
    if (sel.rangeCount && container.contains(sel.anchorNode)) lastRange = sel.getRangeAt(0).cloneRange();
  });
  const restoreSelectionIfLost = () => {
    const sel = getSelection();
    if (sel.rangeCount && container.contains(sel.anchorNode)) return;
    container.focus();
    if (lastRange) (sel.removeAllRanges(), sel.addRange(lastRange));
  };

  // ---- undo / redo stack (snapshot-based) ----
  const MAX_HISTORY = 100;
  let undoStack = []; // array of markdown strings
  let redoStack = [];
  let onHistoryChange = null; // set by editor.js to update button states

  const notifyHistory = () => onHistoryChange?.();

  /**
   * Save current markdown to undo stack before a destructive operation.
   * Call this BEFORE mutating the DOM.
   */
  const pushHistory = () => {
    const snap = getMarkdown();
    if (undoStack.length && undoStack[undoStack.length - 1] === snap) return;
    undoStack.push(snap);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    notifyHistory();
  };

  const setMarkdown = (markdown) => {
    container.innerHTML = renderHtml(markdown);
    // always leave an empty paragraph at the end so there is somewhere to keep writing
    if (container.lastElementChild?.nodeName !== 'P' || container.lastElementChild.classList.contains('hint') || container.lastElementChild.textContent.trim())
      container.insertAdjacentHTML('beforeend', '<p><br></p>');
    hydrate();
    // Baseline = this document as the editor would write it, so opening a draft and leaving
    // without typing never counts as a change (the file keeps its own formatting).
    lastMarkdown = getMarkdown();
  };
  const getMarkdown = () => toMarkdown(container);

  let timer;
  const emit = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const next = getMarkdown();
      if (next !== lastMarkdown) {
        // Push to undo stack on content change from typing / native execCommand ops
        undoStack.push(lastMarkdown);
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack = [];
        lastMarkdown = next;
        onChange(next);
        notifyHistory();
      }
    }, 250);
  };

  const richUndo = () => {
    if (!undoStack.length) return;
    const current = getMarkdown();
    redoStack.push(current);
    const prev = undoStack.pop();
    setMarkdown(prev);
    lastMarkdown = prev;
    onChange(prev);
    notifyHistory();
    container.focus();
  };

  const richRedo = () => {
    if (!redoStack.length) return;
    const current = getMarkdown();
    undoStack.push(current);
    const next = redoStack.pop();
    setMarkdown(next);
    lastMarkdown = next;
    onChange(next);
    notifyHistory();
    container.focus();
  };



  // --- Markdown-style shortcuts while typing ("## ", "- ", "1. ", "> ", "```") ---
  const currentBlock = () => {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    let n = sel.anchorNode;
    while (n && n !== container && !(n.nodeType === 1 && /^(P|H[1-6]|LI|DIV|BLOCKQUOTE|PRE)$/.test(n.nodeName))) n = n.parentNode;
    return n && n !== container ? n : null;
  };
  const SHORTCUTS = [
    [/^#$/, () => document.execCommand('formatBlock', false, 'h1')],
    [/^##$/, () => document.execCommand('formatBlock', false, 'h2')],
    [/^###$/, () => document.execCommand('formatBlock', false, 'h3')],
    [/^[-*]$/, () => document.execCommand('insertUnorderedList')],
    [/^1[.)]$/, () => document.execCommand('insertOrderedList')],
    [/^>$/, () => document.execCommand('formatBlock', false, 'blockquote')],
  ];
  // Works for key-by-key typing and for text inserted in one go (mobile keyboards, autocorrect)
  container.addEventListener('input', (e) => {
    if (e.inputType !== 'insertText') return;
    const block = currentBlock();
    if (!block || block.nodeName !== 'P' || block.closest('td, th, li, blockquote, .callout')) return;
    const m = /^(#{1,3}|[-*]|1[.)]|>)[ \u00a0]([\s\S]*)$/.exec(block.textContent);
    if (!m || block.querySelector('img, [contenteditable="false"]')) return;
    const rule = SHORTCUTS.find(([re]) => re.test(m[1]));
    if (!rule) return;
    block.textContent = m[2];
    if (!m[2]) block.append(document.createElement('br'));
    placeCaret(block);
    rule[1]();
    const sel = getSelection();
    const target = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
    if (target && m[2]) placeCaret(target.closest('h1, h2, h3, li, blockquote') || target);
  });
  container.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'b') return e.preventDefault(), exec('bold');
    if (mod && e.key.toLowerCase() === 'i') return e.preventDefault(), exec('italic');
    if (mod && e.key.toLowerCase() === 'u') return e.preventDefault(), exec('underline');
    if (mod && e.key.toLowerCase() === 'e') return e.preventDefault(), exec('code');
    if (e.key === 'Enter' && !e.shiftKey) {
      const block = currentBlock();
      if (block && /^H[1-6]$/.test(block.nodeName) && caretAtEnd(block)) {
        e.preventDefault();
        const p = document.createElement('p');
        p.append(document.createElement('br'));
        block.after(p);
        placeCaret(p, true);
        emit();
        return;
      }
      if (block?.nodeName === 'P' && /^```(\w*)$/.test(block.textContent.trim())) {
        e.preventDefault();
        const lang = block.textContent.trim().slice(3);
        const pre = document.createElement('pre');
        pre.className = 'code';
        if (lang) pre.dataset.lang = lang;
        pre.textContent = '\n';
        block.replaceWith(pre);
        placeCaret(pre, true);
        emit();
      } else if (block?.nodeName === 'PRE') {
        e.preventDefault();
        document.execCommand('insertText', false, '\n');
      }
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && getSelection().isCollapsed) {
      const block = currentBlock();
      const sel = getSelection();
      if (block) {
        const r = document.createRange();
        r.selectNodeContents(block);
        r.setEnd(sel.anchorNode, sel.anchorOffset);
        const atStart = !r.toString().length;
        const neighbour = e.key === 'Backspace' ? atStart && block.previousElementSibling : caretAtEnd(block) && block.nextElementSibling;
        if (neighbour?.matches?.('p.hint')) {
          e.preventDefault();
          neighbour.remove();
          emit();
          return;
        }
      }
    }
    if (e.key === 'Tab') {
      const li = getSelection().anchorNode?.parentElement?.closest('li');
      if (li) {
        e.preventDefault();
        exec(e.shiftKey ? 'outdent' : 'indent');
      }
    }
  });
  container.addEventListener('input', emit);

  // "@" after a space (or at line start) opens the person picker
  let savedRange = null;
  const saveRange = () => {
    const sel = getSelection();
    savedRange = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  };
  const restoreRange = () => {
    container.focus();
    if (!savedRange) return;
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  };
  container.addEventListener('input', async (e) => {
    if (e.inputType !== 'insertText' || e.data !== '@') return;
    const sel = getSelection();
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3 || currentBlock()?.nodeName === 'PRE') return;
    const before = node.data.slice(0, sel.anchorOffset - 1);
    if (before && !/[\s\u00a0(]$/.test(before)) return; // e.g. an email address
    const r = document.createRange();
    r.setStart(node, sel.anchorOffset - 1);
    r.setEnd(node, sel.anchorOffset);
    r.deleteContents();
    saveRange();
    const name = await pickUser();
    restoreRange();
    if (name) insertInline(`@[${name}] `);
    else document.execCommand('insertText', false, '@');
  });
  const insertInline = (markdown) => insertInlineHtml(renderHtml(markdown.trim()).trim().replace(/^<p>/, '').replace(/<\/p>$/, ''));

  // Floating table toolbar: rows, columns, delete table
  const tableBar = document.createElement('div');
  tableBar.className = 'table-bar';
  tableBar.setAttribute('contenteditable', 'false');
  tableBar.innerHTML = [
    ['row-above', 'Row above', '<path d="M4 14h16M4 19h16M12 3v7M8.5 6.5h7"/>'],
    ['row-below', 'Row below', '<path d="M4 5h16M4 10h16M12 14v7M8.5 17.5h7"/>'],
    ['col-left', 'Column left', '<path d="M14 4v16M19 4v16M3 12h7M6.5 8.5v7"/>'],
    ['col-right', 'Column right', '<path d="M5 4v16M10 4v16M14 12h7M17.5 8.5v7"/>'],
    ['sep'],
    ['del-row', 'Delete row', '<path d="M4 12h16"/><path d="M4 7h16M4 17h16" opacity=".35"/>'],
    ['del-col', 'Delete column', '<path d="M12 4v16"/><path d="M7 4v16M17 4v16" opacity=".35"/>'],
    ['del-table', 'Delete table', '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'],
  ].map(([a, label, path]) => (a === 'sep' ? '<span class="sep"></span>' : `<button type="button" data-t="${a}" title="${label}" aria-label="${label}"><svg class="i" viewBox="0 0 24 24">${path}</svg></button>`)).join('');
  document.body.append(tableBar);
  let activeCell = null;
  const placeTableBar = () => {
    const table = activeCell?.closest('table');
    if (!table || !container.contains(table)) return (tableBar.classList.remove('show'), (activeCell = null));
    const r = (table.closest('.table-wrap') || table).getBoundingClientRect();
    const top = r.top - 44;
    tableBar.style.top = `${top < 60 ? r.bottom + 6 : top}px`;
    tableBar.style.left = `${Math.max(8, Math.min(r.left, innerWidth - tableBar.offsetWidth - 8))}px`;
    tableBar.classList.add('show');
  };
  const onSelection = () => {
    const n = getSelection().anchorNode;
    const cell = n && (n.nodeType === 1 ? n : n.parentElement)?.closest?.('td, th');
    activeCell = cell && container.contains(cell) ? cell : null;
    placeTableBar();
  };
  document.addEventListener('selectionchange', onSelection);
  container.closest('.rich-scroll')?.addEventListener('scroll', placeTableBar, { passive: true });
  tableBar.addEventListener('mousedown', (e) => e.preventDefault());
  tableBar.addEventListener('click', (e) => {
    const action = e.target.closest('[data-t]')?.dataset.t;
    const cell = activeCell?.isConnected ? activeCell : null;
    if (!action || !cell) return;
    const row = cell.parentElement;
    const table = cell.closest('table');
    const idx = Array.prototype.indexOf.call(row.children, cell);
    const rows = [...table.querySelectorAll('tr')];
    const emptyCell = (tag) => {
      const c = document.createElement(tag);
      c.append(document.createElement('br'));
      return c;
    };
    const focusCell = (c) => {
      if (!c) return;
      placeCaret(c, true);
      activeCell = c; // don't wait for selectionchange
    };
    pushHistory(); // snapshot before any table mutation
    if (action === 'row-above' || action === 'row-below') {
      const isHeader = row.parentElement.nodeName === 'THEAD';
      const tr = document.createElement('tr');
      for (let i = 0; i < row.children.length; i++) tr.append(emptyCell('td'));
      if (isHeader) (table.tBodies[0] || table.createTBody()).prepend(tr);
      else action === 'row-above' ? row.before(tr) : row.after(tr);
      focusCell(tr.children[idx]);
    } else if (action === 'col-left' || action === 'col-right') {
      for (const tr of rows) {
        const ref = tr.children[Math.min(idx, tr.children.length - 1)];
        const c = emptyCell(ref?.nodeName === 'TH' ? 'th' : 'td');
        if (!ref) tr.append(c);
        else action === 'col-left' ? ref.before(c) : ref.after(c);
      }
      focusCell(row.children[action === 'col-left' ? idx : idx + 1]);
    } else if (action === 'del-row') {
      if (row.parentElement.nodeName === 'THEAD' || rows.length <= 2) return removeTable(table);
      const next = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      focusCell(next?.children[Math.min(idx, next.children.length - 1)]);
    } else if (action === 'del-col') {
      if (row.children.length <= 1) return removeTable(table);
      for (const tr of rows) tr.children[idx]?.remove();
      focusCell(row.children[Math.min(idx, row.children.length - 1)]);
    } else if (action === 'del-table') {
      return removeTable(table);
    }
    emit();
    placeTableBar();
  });
  function removeTable(table) {
    pushHistory();
    const wrap = table.closest('.table-wrap') || table;
    const p = document.createElement('p');
    p.append(document.createElement('br'));
    wrap.replaceWith(p);
    placeCaret(p, true);
    tableBar.classList.remove('show');
    activeCell = null;
    emit();
  }
  // Backspace/Delete on a fully selected table removes it
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    const sel = getSelection();
    if (sel.isCollapsed) {
      const block = currentBlock();
      if (!block || block.closest('td, th')) return;
      const r = document.createRange();
      r.selectNodeContents(block);
      r.setEnd(sel.anchorNode, sel.anchorOffset);
      const neighbour = e.key === 'Backspace' ? !r.toString().length && block.previousElementSibling : caretAtEnd(block) && block.nextElementSibling;
      if (neighbour?.matches?.('.table-wrap, table') && !block.textContent.trim()) {
        e.preventDefault();
        pushHistory();
        neighbour.remove();
        emit();
      }
      return;
    }
    const range = sel.getRangeAt(0);
    const tables = [...container.querySelectorAll('.table-wrap, table:not(.table-wrap table)')].filter((t) => range.intersectsNode(t));
    if (tables.some((t) => range.intersectsNode(t) && !t.contains(range.startContainer) && !t.contains(range.endContainer))) {
      e.preventDefault();
      pushHistory();
      tables.forEach((t) => {
        if (!t.contains(range.startContainer) && !t.contains(range.endContainer)) t.remove();
      });
      range.deleteContents();
      emit();
    }
  }, true);

  // Diagrams open a source editor; clicking TOC/status does nothing destructive
  const removeHint = (hint, { write = false } = {}) => {
    pushHistory();
    let target = null;
    if (write) {
      target = document.createElement('p');
      target.append(document.createElement('br'));
      hint.replaceWith(target);
    } else {
      target = hint.nextElementSibling || hint.previousElementSibling;
      hint.style.transition = 'opacity .15s, transform .15s';
      hint.style.opacity = '0';
      hint.remove();
    }
    if (target && target.isContentEditable !== false) placeCaret(target, write);
    emit();
  };
  container.addEventListener('mousedown', (e) => {
    const hint = e.target.closest('p.hint');
    if (!hint) return;
    e.preventDefault();
    removeHint(hint, { write: !e.target.closest('.hint-x') });
  });
  container.addEventListener('click', async (e) => {
    const fig = e.target.closest('figure.diagram[data-md]');
    if (fig) {
      e.preventDefault();
      const src = b64.dec(fig.getAttribute('data-md'));
      const m = /^```(\w+)\n([\s\S]*)\n```$/.exec(src.trim()) || [null, 'mermaid', ''];
      const next = await editDiagram(m[1], m[2]);
      if (next === null) return;
      pushHistory();
      if (next === '') fig.remove();
      else {
        fig.setAttribute('data-md', b64.enc(`\`\`\`${m[1]}\n${next}\n\`\`\``));
        fig.classList.add('loading', 'diagram-box');
        fig.innerHTML = '';
        hydrate(fig.parentElement);
      }
      emit();
    }
    const dateChip = e.target.closest('.date-chip[data-md]');
    if (dateChip) {
      const d = await pickDate(dateChip.dataset.date);
      if (d) {
        pushHistory();
        dateChip.dataset.date = d;
        dateChip.setAttribute('data-md', b64.enc(`{date:${d}}`));
        dateChip.textContent = new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        emit();
      }
      return;
    }
    const status = e.target.closest('.status[contenteditable="false"]');
    if (status) {
      const title = await promptText('Status label', status.textContent);
      if (title !== null) {
        pushHistory();
        status.textContent = title.toUpperCase();
        emit();
      }
    }
  });

  // Paste: images upload; rich HTML is normalised through Markdown so junk styles never survive
  container.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      uploadImages(files, (href, alt) => insertHtml(`<img src="${esc(imageSrc(href, { draftDir }))}" data-src="${esc(href)}" alt="${esc(alt)}">`));
      return;
    }
    const html = e.clipboardData?.getData('text/html');
    const text = e.clipboardData?.getData('text/plain') || '';
    if (currentBlock()?.nodeName === 'PRE') {
      e.preventDefault();
      document.execCommand('insertText', false, text);
      return;
    }
    e.preventDefault();
    if (html) {
      const tmp = document.createElement('div');
      tmp.innerHTML = DOMPurify.sanitize(html, { FORBID_ATTR: ['style', 'class', 'id'], FORBID_TAGS: ['style', 'meta', 'font'] });
      insertHtml(renderHtml(toMarkdown(tmp)));
    } else if (/(^|\n)(#{1,6} |[-*] |\d+\. |> |```|\|.*\|)/.test(text)) {
      insertHtml(renderHtml(text));
    } else {
      document.execCommand('insertText', false, text);
    }
    hydrate();
    emit();
  });
  container.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    uploadImages(files, (href, alt) => insertHtml(`<img src="${esc(imageSrc(href, { draftDir }))}" data-src="${esc(href)}" alt="${esc(alt)}">`));
  });

  // Range-based insertion: execCommand('insertHTML') strips attributes from contenteditable=false
  // nodes (diagram source, mentions, dates), so structured content is inserted with the DOM API.
  function currentRange() {
    restoreSelectionIfLost();
    const sel = getSelection();
    if (sel.rangeCount && container.contains(sel.anchorNode)) return sel.getRangeAt(0);
    const r = document.createRange();
    r.selectNodeContents(container);
    r.collapse(false);
    return r;
  }
  function caretAfter(node) {
    const r = document.createRange();
    r.setStartAfter(node);
    r.collapse(true);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
  function insertInlineHtml(html) {
    pushHistory();
    const range = currentRange();
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const space = document.createTextNode('\u00a0');
    tpl.content.append(space);
    range.deleteContents();
    range.insertNode(tpl.content);
    caretAfter(space);
    hydrate();
    emit();
  }
  function insertHtml(html) {
    pushHistory();
    const range = currentRange();
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const blocks = [...tpl.content.childNodes].filter((n) => n.nodeType === 1 || n.textContent.trim());
    if (!blocks.length) return;
    if (blocks.every((n) => n.nodeType === 3 || /^(IMG|SPAN|A|STRONG|EM|CODE)$/.test(n.nodeName))) return insertInlineHtml(html);
    range.deleteContents();
    let top = range.startContainer;
    while (top && top.parentNode !== container) top = top.parentNode;
    const last = blocks[blocks.length - 1];
    if (top && top.nodeName === 'P' && !top.textContent.trim() && !top.querySelector('img, [contenteditable="false"]')) top.replaceWith(tpl.content);
    else if (top) top.after(tpl.content);
    else container.append(tpl.content);
    let next = last.nextElementSibling;
    if (!next || next.nodeName !== 'P' || next.classList.contains('hint')) {
      next = document.createElement('p');
      next.append(document.createElement('br'));
      last.after(next);
    }
    const r = document.createRange();
    r.selectNodeContents(next);
    r.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    hydrate();
    emit();
  }

  /** Toolbar commands shared with the Markdown editor's buttons. */
  function exec(cmd, arg) {
    container.focus();
    switch (cmd) {
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strikeThrough':
      case 'insertUnorderedList':
      case 'insertOrderedList':
      case 'indent':
      case 'outdent':
        document.execCommand(cmd);
        break;
      case 'h2':
      case 'h3':
      case 'p': {
        const block = currentBlock();
        document.execCommand('formatBlock', false, block?.nodeName === cmd.toUpperCase() ? 'p' : cmd);
        break;
      }
      case 'code': {
        const sel = getSelection();
        const text = sel.toString();
        const inCode = sel.anchorNode?.parentElement?.closest('code');
        if (inCode) inCode.replaceWith(document.createTextNode(inCode.textContent));
        else document.execCommand('insertHTML', false, `<code>${esc(text || 'code')}</code>&#8203;`);
        break;
      }
      case 'link':
        return promptText('Link URL', 'https://').then((url) => {
          if (!url) return;
          container.focus();
          if (getSelection().isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(url)}</a>`);
          else document.execCommand('createLink', false, url);
          emit();
        });
      case 'markdown':
        insertHtml(renderHtml(arg));
        break;
      default:
        return;
    }
    emit();
  }

  return {
    destroy: () => {
      document.removeEventListener('selectionchange', onSelection);
      tableBar.remove();
    },
    removeHints: () => {
      const n = container.querySelectorAll('p.hint').length; // includes "Type/image to add…" quotes
      if (n) pushHistory();
      container.querySelectorAll('p.hint').forEach((h) => h.remove());
      emit();
      return n;
    },
    setMarkdown,
    getMarkdown,
    exec,
    insertMarkdown: (markdown) => exec('markdown', markdown),
    insertInline: (markdown) => {
      restoreSelectionIfLost();
      insertInline(markdown);
    },
    insertMention: async () => {
      saveRange();
      const name = await pickUser();
      restoreRange();
      if (name) insertInline(`@[${name}] `);
    },
    insertDate: async () => {
      saveRange();
      const d = await pickDate();
      restoreRange();
      if (d) insertInline(`{date:${d}} `);
    },
    focus: () => container.focus(),
    flush: () => {
      clearTimeout(timer);
      const next = getMarkdown();
      if (next !== lastMarkdown) {
        undoStack.push(lastMarkdown);
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack = [];
        lastMarkdown = next;
        onChange(next);
        notifyHistory();
      }
    },
    // Undo / Redo
    undo: richUndo,
    redo: richRedo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    onHistoryChange: (fn) => { onHistoryChange = fn; },
  };
}

function decode(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function atomic(source, html) {
  return html.replace(/^<(\w+)/, `<$1 contenteditable="false" data-md="${b64.enc(source)}"`);
}

function hashCode(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function caretAtEnd(block) {
  const sel = getSelection();
  const r = document.createRange();
  r.selectNodeContents(block);
  r.setStart(sel.anchorNode, sel.anchorOffset);
  return !r.toString().trim();
}

function placeCaret(el, atStart = false) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(atStart);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

function promptText(label, value = '') {
  return dialog({
    title: label,
    render(b, close) {
      b.innerHTML = `<div class="dialog-body"><input class="input" value="${esc(value)}" autofocus></div><div class="dialog-foot"><button class="btn" data-x>Cancel</button><button class="btn btn-primary" data-ok>OK</button></div>`;
      const input = b.querySelector('input');
      setTimeout(() => input.select());
      input.addEventListener('keydown', (e) => e.key === 'Enter' && close(input.value.trim()));
      b.querySelector('[data-x]').onclick = () => close(null);
      b.querySelector('[data-ok]').onclick = () => close(input.value.trim());
    },
  }).then((v) => (v === undefined ? null : v));
}

/** Diagram source editor with live preview. Resolves to new code, '' to delete, null to cancel. */
export function editDiagram(kind, code) {
  return dialog({
    title: `Edit ${kind === 'plantuml' ? 'PlantUML' : 'Mermaid'} diagram`,
    className: 'diagram-dialog',
    render(b, close) {
      b.innerHTML = `
        <div class="dialog-body diagram-edit">
          <textarea class="input code-input" spellcheck="false">${esc(code)}</textarea>
          <div class="diagram-live doc"><figure class="diagram diagram-box loading"></figure></div>
        </div>
        <div class="dialog-foot"><button class="btn btn-danger" data-del style="margin-right:auto">${icon('trash')} Remove</button><button class="btn" data-x>Cancel</button><button class="btn btn-primary" data-ok>Apply</button></div>`;
      const ta = b.querySelector('textarea');
      const fig = b.querySelector('figure');
      let t;
      const draw = () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const src = ta.value;
          renderDiagram({ key: `${kind}:${src.length}:${hashCode(src)}`, kind, code: src }).then(
            (svg) => ((fig.className = 'diagram'), (fig.innerHTML = svg)),
            (e) => ((fig.className = 'diagram'), (fig.innerHTML = `<div class="diagram-error">${esc(String(e.message || e).split('\n').slice(0, 3).join('\n'))}</div>`)),
          );
        }, 300);
      };
      ta.addEventListener('input', draw);
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          document.execCommand('insertText', false, '    ');
        }
      });
      draw();
      b.querySelector('[data-x]').onclick = () => close(null);
      b.querySelector('[data-del]').onclick = () => close('');
      b.querySelector('[data-ok]').onclick = () => close(ta.value.trim());
    },
  }).then((v) => (v === undefined ? null : v));
}
