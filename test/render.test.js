// Diagram matching in publish/export and the line diff.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup } from './helpers/fake-confluence.js';

const { root, cleanup } = setup();
after(cleanup);

const { toStorage, toHtmlFragment } = await import('../src/render.js');
const { diagramHash } = await import('../src/diagrams.js');
const { diffLines, hunks, diffStats } = await import('../web/lib/diff.js');

// Pre-render diagrams into the cache so no browser is needed
const png = fs.readFileSync(new URL('./fixtures/pixel.png', import.meta.url));
function cacheDiagram(kind, code, svgText) {
  const dir = path.join(root, 'cache', 'diagrams');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${kind}-${diagramHash(kind, code)}`);
  fs.writeFileSync(`${base}.png`, png);
  fs.writeFileSync(`${base}.svg`, `<svg>${svgText}</svg>`);
  return `diagram-${kind}-${diagramHash(kind, code)}.png`;
}

test('diagrams nested in lists render, examples inside other code blocks stay code', async () => {
  const nested = 'flowchart TD\n  A --> B';
  const top = 'sequenceDiagram\n  A->>B: hi';
  const nestedFile = cacheDiagram('mermaid', nested, 'NESTED');
  const topFile = cacheDiagram('mermaid', top, 'TOP');
  const body = [
    '## Flow',
    '',
    '````markdown',
    '```mermaid',
    'graph LR',
    '  X --> Y',
    '```',
    '````',
    '',
    '1. Step one',
    '',
    '   ```mermaid',
    '   flowchart TD',
    '     A --> B',
    '   ```',
    '',
    '```mermaid',
    top,
    '```',
    '',
  ].join('\n');
  const { storage, attachments } = await toStorage({ title: 'T' }, body);
  assert.deepEqual(attachments.map((a) => a.filename).sort(), [nestedFile, topFile].sort());
  assert.match(storage, /graph LR/, 'the example stays a code block');
  const html = await toHtmlFragment({ title: 'T' }, body);
  assert.ok(html.indexOf('NESTED') < html.indexOf('TOP'), 'each figure gets its own diagram');
});

function apply(ops, side) {
  return ops.filter((o) => (side === 'a' ? o.op !== '+' : o.op !== '-')).map((o) => o.line).join('\n');
}

test('line diff reconstructs both sides and groups hunks', () => {
  const rnd = (n) => Array.from({ length: n }, (_, i) => (Math.random() < 0.3 ? `x${i % 5}` : `line ${i}`));
  for (let i = 0; i < 200; i++) {
    const a = rnd(Math.floor(Math.random() * 40)).join('\n');
    const b = rnd(Math.floor(Math.random() * 40)).join('\n');
    const ops = diffLines(a, b);
    assert.equal(apply(ops, 'a'), a);
    assert.equal(apply(ops, 'b'), b);
  }
  const ops = diffLines('a\nb\nc\nd\ne\nf\ng\nh\ni\nj', 'a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nk');
  assert.deepEqual(diffStats(ops), { added: 2, removed: 1 });
  const hs = hunks(ops, 2);
  assert.equal(hs.length, 2);
  assert.equal(hs[1].bStart, 9);
  assert.deepEqual(hunks(diffLines('same', 'same')), []);
});
