// Line diff (Myers, O(ND)) and unified-style hunks. No dependencies; runs in Node and the browser.

/** @returns {{op:'='|'-'|'+', line:string}[]} */
export function diffLines(a, b) {
  const A = String(a).replace(/\r\n?/g, '\n').split('\n');
  const B = String(b).replace(/\r\n?/g, '\n').split('\n');
  // trim common prefix/suffix: keeps the search small for mostly-equal documents
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a2 = A.slice(pre, A.length - suf);
  const b2 = B.slice(pre, B.length - suf);
  const mid = myers(a2, b2);
  return [
    ...A.slice(0, pre).map((line) => ({ op: '=', line })),
    ...mid,
    ...A.slice(A.length - suf).map((line) => ({ op: '=', line })),
  ];
}

function myers(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n) return b.map((line) => ({ op: '+', line }));
  if (!m) return a.map((line) => ({ op: '-', line }));
  const max = n + m;
  const off = max;
  const v = new Int32Array(2 * max + 2);
  const trace = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) x++, y++;
      v[off + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, off, d);
    }
  }
  return [];
}

function backtrack(trace, a, b, off, dEnd) {
  const out = [];
  let x = a.length;
  let y = b.length;
  for (let d = dEnd; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? k + 1 : k - 1;
    const prevX = v[off + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) out.push({ op: '=', line: a[--x] }), y--;
    if (x === prevX) out.push({ op: '+', line: b[--y] });
    else out.push({ op: '-', line: a[--x] });
  }
  while (x > 0 && y > 0) out.push({ op: '=', line: a[--x] }), y--;
  return out.reverse();
}

/**
 * Group a diff into hunks with `context` unchanged lines around each change.
 * @returns {{aStart:number, bStart:number, lines:{op:string, line:string}[]}[]}
 */
export function hunks(ops, context = 3) {
  const changed = ops.map((o, i) => (o.op === '=' ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return [];
  // line numbers (1-based) of every op in a and b
  const aNo = [];
  const bNo = [];
  let a = 1;
  let b = 1;
  for (const o of ops) {
    aNo.push(a);
    bNo.push(b);
    if (o.op !== '+') a++;
    if (o.op !== '-') b++;
  }
  const ranges = [];
  for (const i of changed) {
    const last = ranges[ranges.length - 1];
    if (last && i - last[1] <= context * 2 + 1) last[1] = i;
    else ranges.push([i, i]);
  }
  return ranges.map(([s, e]) => {
    const from = Math.max(0, s - context);
    const to = Math.min(ops.length - 1, e + context);
    return { aStart: aNo[from], bStart: bNo[from], lines: ops.slice(from, to + 1) };
  });
}

export function diffStats(ops) {
  return { added: ops.filter((o) => o.op === '+').length, removed: ops.filter((o) => o.op === '-').length };
}
