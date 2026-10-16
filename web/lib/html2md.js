// Rich editor DOM → Notebook Markdown. Mirrors the HTML produced by notebook-md.js (target 'html').
import TurndownService from '/vendor/turndown.js';
import { gfm } from '/vendor/turndown-gfm.js';

const KIND_BY_CLASS = { 'callout-note': 'NOTE', 'callout-info': 'NOTE', 'callout-tip': 'TIP', 'callout-important': 'WARNING', 'callout-warning': 'WARNING', 'callout-caution': 'CAUTION' };
const DEFAULT_TITLE = { NOTE: 'Note', TIP: 'Tip', WARNING: 'Warning', CAUTION: 'Caution' };

export const b64 = {
  enc: (s) => btoa(unescape(encodeURIComponent(s))),
  dec: (s) => decodeURIComponent(escape(atob(s))),
};

export function createHtmlToMarkdown() {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '_', hr: '---', br: '<br>' });
  td.use(gfm);

  td.addRule('atomic', {
    filter: (n) => n.nodeType === 1 && n.hasAttribute('data-md'),
    replacement: (_, n) => {
      const src = b64.dec(n.getAttribute('data-md')).trim();
      return n.nodeName === 'SPAN' ? src : `\n\n${src}\n\n`; // mentions/dates/status stay inline
    },
  });
  td.addRule('status', {
    filter: (n) => n.nodeName === 'SPAN' && n.classList.contains('status'),
    replacement: (_, n) => {
      const title = n.textContent.trim();
      const colour = [...n.classList].find((c) => c.startsWith('status-'))?.slice(7);
      const custom = n.getAttribute('data-colour');
      return title ? `{status:${title}${custom ? `|${custom}` : colour && colour !== 'grey' && n.hasAttribute('data-custom') ? `|${colour}` : ''}}` : '';
    },
  });
  td.addRule('calloutTitle', { filter: (n) => n.nodeType === 1 && n.classList.contains('callout-title'), replacement: () => '' });
  td.addRule('callout', {
    filter: (n) => n.nodeName === 'DIV' && n.classList.contains('callout'),
    replacement: (content, n) => {
      const kind = Object.entries(KIND_BY_CLASS).find(([c]) => n.classList.contains(c))?.[1] || 'NOTE';
      const title = n.querySelector(':scope > .callout-title')?.textContent.trim() || '';
      const head = `> [!${kind}]${title && title !== DEFAULT_TITLE[kind] ? ` ${title}` : ''}`;
      const lines = content.trim().split('\n').map((l) => (l ? `> ${l}` : '>'));
      return `\n\n${head}\n${lines.join('\n')}\n\n`;
    },
  });
  td.addRule('hintX', { filter: (n) => n.nodeType === 1 && n.classList.contains('hint-x'), replacement: () => '' });
  td.addRule('hint', {
    filter: (n) => n.nodeName === 'P' && n.classList.contains('hint'),
    replacement: (_, n) => `\n\n<!-- ${(n.getAttribute('data-hint') || n.textContent).replace(/--+/g, '-')} -->\n\n`,
  });
  td.addRule('summary', { filter: 'summary', replacement: () => '' });
  td.addRule('details', {
    filter: 'details',
    replacement: (content, n) => {
      const title = n.querySelector(':scope > summary')?.textContent.trim() || 'Details';
      return `\n\n<details>\n<summary>${title.replace(/</g, '&lt;')}</summary>\n\n${content.trim()}\n\n</details>\n\n`;
    },
  });
  td.addRule('codeBlock', {
    filter: (n) => n.nodeName === 'PRE',
    replacement: (_, n) => {
      const code = n.textContent.replace(/\n$/, '');
      const fence = code.includes('```') ? '~~~~' : '```';
      return `\n\n${fence}${n.getAttribute('data-lang') || ''}\n${code}\n${fence}\n\n`;
    },
  });
  td.addRule('image', {
    filter: 'img',
    replacement: (_, n) => {
      const src = n.getAttribute('data-src') || n.getAttribute('src') || '';
      return src ? `![${(n.getAttribute('alt') || '').replace(/[[\]]/g, '')}](${src.replace(/ /g, '%20')})` : '';
    },
  });
  td.addRule('checkbox', {
    filter: (n) => n.nodeName === 'INPUT' && n.type === 'checkbox',
    replacement: (_, n) => (n.checked || n.hasAttribute('checked') ? '[x]' : '[ ]'),
  });
  // Keep table cells on one line: escape pipes, keep explicit breaks
  td.addRule('cellBreak', {
    filter: (n) => n.nodeName === 'BR' && !!n.closest?.('td, th'),
    replacement: () => '<br>',
  });
  td.addRule('cellParagraph', {
    filter: (n) => (n.nodeName === 'P' || n.nodeName === 'DIV') && !!n.parentNode?.closest?.('td, th'),
    replacement: (content, n) => (n.nextElementSibling ? `${content}<br>` : content),
  });
  td.addRule('strike', { filter: ['del', 's', 'strike'], replacement: (c) => (c.trim() ? `~~${c}~~` : c) });
  td.addRule('listItem', {
    filter: 'li',
    replacement: (content, node) => {
      const parent = node.parentNode;
      let prefix = '- ';
      if (parent.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start')) || 1;
        prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `;
      }
      const indent = ' '.repeat(prefix.length);
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '').replace(/\n/g, `\n${indent}`);
      return `${prefix}${body}${node.nextSibling ? '\n' : ''}`;
    },
  });
  td.addRule('kbd', { filter: ['kbd'], replacement: (c) => `<kbd>${c}</kbd>` });
  td.addRule('underline', { filter: ['u', 'ins'], replacement: (c) => `<u>${c}</u>` });
  td.addRule('supsub', { filter: ['sup', 'sub'], replacement: (c, n) => `<${n.nodeName.toLowerCase()}>${c}</${n.nodeName.toLowerCase()}>` });
  td.addRule('drop', { filter: ['script', 'style', 'meta', 'button'], replacement: () => '' });
  const baseEscape = td.escape.bind(td);
  td.escape = (s) => baseEscape(s).replace(/\{status:/g, '\\{status:');

  return (root) => {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('td, th').forEach((cell) => {
      cell.querySelectorAll('*').forEach((el) => el.childNodes.forEach((t) => t.nodeType === 3 && (t.data = t.data.replace(/\|/g, '\\|'))));
      cell.childNodes.forEach((t) => t.nodeType === 3 && (t.data = t.data.replace(/\|/g, '\\|')));
    });
    // Chrome sometimes wraps lines in <div>; treat them as paragraphs
    clone.querySelectorAll(':scope > div:not([class]):not([data-md])').forEach((d) => {
      const p = document.createElement('p');
      p.innerHTML = d.innerHTML;
      d.replaceWith(p);
    });
    // Empty paragraphs (the caret line the editor keeps at the end, blank lines typed with Enter)
    // hold only a <br>; Markdown has no empty paragraph, and Turndown would write a literal "<br>"
    clone.querySelectorAll('p').forEach((p) => {
      if (p.closest('td, th') || p.textContent.trim() || p.querySelector('img, [data-md], input')) return;
      if ([...p.childNodes].every((c) => c.nodeName === 'BR' || (c.nodeType === 3 && !c.data.trim()))) p.remove();
    });
    // a bare <br> between blocks is the same leftover (older saves wrote it as a "<br>" line)
    clone.querySelectorAll(':scope > br').forEach((br) => br.remove());
    return td
      .turndown(clone)
      .replace(/\\\\\|/g, '\\|')
      .replace(/^\\\[TOC\\\]$/gm, '[TOC]')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n';
  };
}
