import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeMarkdown } from '../src/importer.js';
import { validateStorage } from '../src/render.js';
import { htmlToXhtml, inlineTagToXhtml, toXmlEntities, checkXhtml, repairXhtml } from '../src/xhtml.js';

const fixture = fs.readFileSync(new URL('./fixtures/messy.md', import.meta.url), 'utf8');

test('messy markdown normalises and produces valid storage', () => {
  const { meta, body, images, warnings } = normalizeMarkdown(fixture, 'messy.md');
  assert.equal(meta.title, 'Import Torture Test & Friends');
  assert.equal(meta.doc_status, 'DRAFT');
  assert.equal(meta.owner, 'Akmal Muhamad');
  assert.ok(!/^# Import Torture/m.test(body), 'duplicate H1 removed');
  assert.match(body, /> \[!NOTE\] Obsidian callout/);
  assert.match(body, /> \[!CAUTION\] Danger zone/);
  assert.match(body, /wiki link/);
  assert.match(body, /## Footnotes\n\n1\. First footnote\.\n2\. Named footnote/);
  assert.match(body, /```mermaid\ngraph TD/);
  assert.match(body, /```plantuml\nAlice/);
  assert.match(body, /~~~\ntilde fence <tag>\n~~~/);
  assert.deepEqual(images.sort(), ['./pixel.png', 'nope/missing.png', 'pixel.png']);
  assert.deepEqual(meta.labels, ['prd', 'draft']);
  assert.ok(warnings.some((w) => /Ignored frontmatter fields: aliases/.test(w)));
  assert.deepEqual(validateStorage(meta, body), { ok: true });
});

test('raw HTML is re-serialised safely', () => {
  const out = htmlToXhtml('<div align="center"><p>Hi<br>there</p><script>x()</script><table><tr><td colspan=2>a<td>b</table><a href="javascript:alert(1)">bad</a></div>');
  assert.equal(out, '<p style="text-align: center;">Hi<br />there</p><table><tbody><tr><td colspan="2">a</td><td>b</td></tr></tbody></table>bad');
  assert.equal(inlineTagToXhtml('<kbd>'), '<code>');
  assert.equal(inlineTagToXhtml('<custom-tag>'), '&lt;custom-tag&gt;');
});

test('entities, repair and validation', () => {
  assert.equal(toXmlEntities('&copy; &amp; &bogus; <![CDATA[&copy;]]>'), '&#169; &amp; &amp;bogus; <![CDATA[&copy;]]>');
  assert.equal(repairXhtml('<p>a <strong>b</p><p>c</em></p>'), '<p>a <strong>b</strong></p><p>c</p>');
  assert.equal(checkXhtml('<p>a <b>b</p>').ok, false);
  assert.equal(checkXhtml('<p>x &nbsp;</p>').ok, false);
  assert.equal(checkXhtml('<p>ok<br /><![CDATA[<b>]]></p>').ok, true);
});

import { extractHeaderProperties, normalizePrdTitle, standardizeHeadings } from '../src/prd-standard.js';
import { normalizeLabels } from '../src/publish.js';
import { Marked } from 'marked';
import { createMarkdown, propertiesTable } from '../web/lib/notebook-md.js';

test('PRD header formats map to Confluence page properties', () => {
  const a = extractHeaderProperties('| Field | Value |\n|---|---|\n| Tribe | BILLER |\n| Document status | DRAFT |\n| Document owner | @Akmal Muhamad |\n| QA | @Reddy Kusuma Jaya / @Syendi Nazera |\n\n---\n\n## Objective\n');
  assert.deepEqual(a.meta, { tribe: 'BILLER', doc_status: 'DRAFT', owner: 'Akmal Muhamad', qa: ['Reddy Kusuma Jaya', 'Syendi Nazera'] });
  assert.match(a.body, /^## Objective/);
  const b = extractHeaderProperties('| Atribut | Keterangan |\n|---|---|\n| Product | QRIS |\n| Status Dokumen | Draft untuk review |\n\n## 1. Objective\n');
  assert.deepEqual(b.meta, { doc_status: 'DRAFT' });
  assert.deepEqual(b.kept, ['Product']);
  const c = extractHeaderProperties('**Versi:** 1.0\n**Author:** Author\n**Status:** Final\n\n## 1. Objective\n');
  assert.deepEqual(c.meta, { doc_status: 'FINAL PRD' });
  assert.equal(normalizePrdTitle('PRD: Integrasi Gapura'), '[PRD] Integrasi Gapura');
  assert.equal(standardizeHeadings('## 3. Pre-condition\n### 6.2 Flow\n## 5\\. Assumptions and Dependencies').body, '## Pre-Condition\n### Flow\n## Assumptions & Dependencies');
});

test('mentions, dates and labels', () => {
  const storage = createMarkdown(Marked, { target: 'storage', mention: (n) => (n === 'Akmal Muhamad' ? 'abc123' : null) });
  const out = storage.render('Owner @[Akmal Muhamad], reviewer @[Unknown Person], due {date:2026-09-17}\n');
  assert.match(out, /<ac:link><ri:user ri:account-id="abc123" \/><\/ac:link>/);
  assert.match(out, /@Unknown Person/);
  assert.match(out, /<time datetime="2026-09-17" \/>/);
  const html = createMarkdown(Marked, { target: 'html' }).render('{date:2026-09-17} @[Akmal Muhamad]');
  assert.match(html, /date-chip[^>]*>17 Sep 2026</);
  assert.match(html, /class="mention">@Akmal Muhamad</);
  assert.match(propertiesTable({ doc_status: 'DRAFT', owner: 'Akmal Muhamad' }, 'storage', { mention: () => 'abc123' }), /ri:account-id="abc123"/);
  assert.deepEqual(normalizeLabels('PRD, Biller Service, #qris'), ['prd', 'biller-service', 'qris']);
});
