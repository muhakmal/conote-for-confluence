// Syntax check for every source file (Node and browser modules). Used by CI before the tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
for (const dir of ['bin', 'src', 'web/js', 'web/lib', 'scripts', 'test']) {
  const dirPath = path.join(root, dir);
  if (!fs.existsSync(dirPath)) continue;
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.js')) files.push(rel);
    }
  };
  walk(dir);
}
let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error(`✗ ${f}\n${e.stderr}`);
  }
}
console.log(failed ? `${failed} file(s) with syntax errors` : `✓ ${files.length} files OK`);
process.exitCode = failed ? 1 : 0;
