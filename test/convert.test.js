import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';
import { storageToMarkdown, detectCodeLanguage } from '../src/storage2md.js';
import { createMarkdown, propertiesTable } from '../web/lib/notebook-md.js';
import { docTypeOf, lifecycleOf, slugify } from '../src/classify.js';
import { parseDoc, stringifyDoc } from '../src/frontmatter.js';

const storage = (md) => createMarkdown(Marked, { target: 'storage' }).render(md);
const html = (md) => createMarkdown(Marked, { target: 'html' }).render(md);

test('page properties table becomes metadata', () => {
  const xml = `<ac:structured-macro ac:name="details"><ac:rich-text-body><table><tbody>
    <tr><th><p><strong>Tribe</strong></p></th><td><p><ac:structured-macro ac:name="status"><ac:parameter ac:name="title">BILLER</ac:parameter></ac:structured-macro></p></td></tr>
    <tr><th><p><strong>Document status</strong></p></th><td><p><ac:structured-macro ac:name="status"><ac:parameter ac:name="title">FINAL PRD</ac:parameter></ac:structured-macro></p></td></tr>
    <tr><th><p><strong>Document owner</strong></p></th><td><p><ac:link><ri:user ri:account-id="abc" /></ac:link></p></td></tr>
  </tbody></table></ac:rich-text-body></ac:structured-macro><h2>Objective</h2><p>Hello</p>`;
  const { markdown, meta } = storageToMarkdown(xml, { userName: () => 'Akmal' });
  assert.deepEqual(meta, { tribe: 'BILLER', doc_status: 'FINAL PRD', owner: 'Akmal' });
  assert.equal(markdown.trim(), '## Objective\n\nHello');
});

test('code macro with mermaid source becomes a mermaid fence; expand becomes details', () => {
  const xml = `<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">Flow</ac:parameter><ac:rich-text-body><ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[sequenceDiagram
  A->>B: hi]]></ac:plain-text-body></ac:structured-macro></ac:rich-text-body></ac:structured-macro>`;
  const { markdown } = storageToMarkdown(xml);
  assert.match(markdown, /<details>\n<summary>Flow<\/summary>/);
  assert.match(markdown, /```mermaid\nsequenceDiagram\n {2}A->>B: hi\n```/);
});

test('info panel and TOC survive the round trip', () => {
  const xml = `<ac:structured-macro ac:name="toc" /><ac:structured-macro ac:name="info"><ac:rich-text-body><p>Heads up</p></ac:rich-text-body></ac:structured-macro>`;
  const { markdown } = storageToMarkdown(xml);
  assert.match(markdown, /^\[TOC\]$/m);
  assert.match(markdown, /> \[!NOTE\]\n> Heads up/);
  const out = storage(markdown);
  assert.match(out, /ac:name="toc"/);
  assert.match(out, /ac:name="info"[\s\S]*<p>Heads up<\/p>/);
});

test('markdown → storage covers PRD building blocks', () => {
  const out = storage(`## Req\n\n| A | B |\n| --- | --- |\n| {status:DRAFT} | x<br>y |\n\n<details>\n<summary>API &amp; Response</summary>\n\n\`\`\`json\n{"a": "]]>"}\n\`\`\`\n\n</details>\n`);
  // full-width table, columns split evenly, header row first
  assert.match(out, /<table ac:style="full-width:true;"><colgroup><col ac:width="50%" \/><col ac:width="50%" \/><\/colgroup><tbody><tr><th>A<\/th><th>B<\/th><\/tr>/);
  assert.match(out, /ac:name="status"[^]*<ac:parameter ac:name="title">DRAFT<\/ac:parameter>/);
  assert.match(out, /x<br \/>y/);
  assert.match(out, /ac:name="expand"[^]*<ac:parameter ac:name="title">API &amp; Response<\/ac:parameter>/);
  assert.match(out, /<!\[CDATA\[\{"a": "\]\]\]\]><!\[CDATA\[>"\}\]\]>/);
});

test('html target renders callouts, toc and status', () => {
  const out = html('[TOC]\n\n## One & Two\n\n> [!WARNING] Careful\n> text {status:FINAL PRD}\n');
  assert.match(out, /<nav class="toc">[^]*One &amp; Two/);
  assert.doesNotMatch(out, /&amp;amp;/);
  assert.match(out, /callout-warning[^]*Careful[^]*status-green/);
});

test('properties table for storage uses details macro', () => {
  const out = propertiesTable({ tribe: ['BILLER', 'MERCHANT'], doc_status: 'DRAFT', owner: 'Akmal' }, 'storage');
  assert.match(out, /^<ac:structured-macro ac:name="details"/);
  assert.equal((out.match(/ac:name="status"/g) || []).length, 3);
});

test('classification follows PK space layout', () => {
  assert.equal(docTypeOf('[PRD] Payara Transfer Integration'), 'prd');
  assert.equal(docTypeOf('PRD – Fraud Detection System (FDS)'), 'prd');
  assert.equal(docTypeOf('[PRD] Backlog - Biller'), 'section');
  assert.equal(docTypeOf('[TAD] Biller Service'), 'tad');
  assert.equal(docTypeOf('UR.FCOUT.001 - Flash Checkout Payment Page'), 'user-requirement');
  assert.equal(lifecycleOf([{ title: 'Product Development' }, { title: 'Biller Service' }, { title: '[PRD] Backlog - Biller' }]), 'backlog');
  assert.equal(lifecycleOf([{ title: '[Deprecated/Archive]' }]), 'archived');
  assert.equal(detectCodeLanguage('@startuml\nA->B\n@enduml'), 'plantuml');
  assert.equal(slugify('[PRD] API Get Balance Biller'), 'prd-api-get-balance-biller');
});

test('frontmatter round trip', () => {
  const text = stringifyDoc({ title: '[PRD] X', qa: ['A', 'B'], empty: '' }, 'Body\n');
  const { meta, body } = parseDoc(text);
  assert.deepEqual(meta, { title: '[PRD] X', qa: ['A', 'B'] });
  assert.equal(body, 'Body\n');
});
