// Local-only diagram rendering (nothing leaves the laptop).
//   mermaid  → headless system Chrome via puppeteer-core
//   plantuml → local `plantuml` CLI (Java)
// Results are cached by content hash in .cache/diagrams.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { config, ROOT } from './config.js';

export const DIAGRAM_LANGS = { mermaid: 'mermaid', plantuml: 'plantuml', puml: 'plantuml', uml: 'plantuml' };

// Bump when the renderer's output changes, so cached images and published attachments are refreshed.
const RENDER_VERSION = 'r2';

export const diagramHash = (kind, code) => crypto.createHash('sha1').update(`${RENDER_VERSION}\n${kind}\n${code.trim()}`).digest('hex').slice(0, 16);

const cacheDir = () => {
  const d = path.join(config.cacheDir, 'diagrams');
  fs.mkdirSync(d, { recursive: true });
  return d;
};

let browserPromise = null;
let idleTimer = null;

async function getBrowser() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(closeBrowser, 60_000);
  if (!browserPromise) {
    const { default: puppeteer } = await import('puppeteer-core');
    browserPromise = puppeteer.launch({
      executablePath: config.chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
    }).catch((e) => {
      browserPromise = null;
      throw new Error(`Cannot start Chrome for Mermaid rendering (${config.chromePath}): ${e.message}`);
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  clearTimeout(idleTimer);
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    await b?.close().catch(() => {});
  }
}

async function renderMermaid(code) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 2400, height: 1600, deviceScaleFactor: 2 });
    await page.setContent('<!doctype html><html><body style="margin:0;background:#fff"><div id="out" style="display:inline-block;padding:16px;background:#fff"></div></body></html>');
    await page.addScriptTag({ path: path.join(ROOT, 'node_modules/mermaid/dist/mermaid.min.js') });
    const svg = await page.evaluate(async (src) => {
      // eslint-disable-next-line no-undef
      mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict', fontFamily: 'Helvetica, Arial, sans-serif', flowchart: { htmlLabels: false } });
      // eslint-disable-next-line no-undef
      const { svg } = await mermaid.render('d' + Math.random().toString(36).slice(2), src);
      document.getElementById('out').innerHTML = svg;
      // Mermaid emits width="100%" with a max-width style, which collapses to the shrink-to-fit
      // width of the wrapper and produces a small, blurry screenshot. Pin the SVG to its natural
      // viewBox size so the capture is crisp.
      const el = document.getElementById('out').querySelector('svg');
      if (el && el.viewBox && el.viewBox.baseVal && el.viewBox.baseVal.width) {
        const vb = el.viewBox.baseVal;
        el.removeAttribute('style');
        el.setAttribute('width', String(vb.width));
        el.setAttribute('height', String(vb.height));
      }
      return el ? el.outerHTML : svg;
    }, code);
    const el = await page.$('#out');
    const png = Buffer.from(await el.screenshot({ type: 'png', omitBackground: false }));
    return { svg, png };
  } catch (e) {
    throw new Error(`Mermaid error: ${String(e.message).split('\n')[0]}`);
  } finally {
    await page.close().catch(() => {});
  }
}

function runPlantuml(code, format) {
  return new Promise((resolve, reject) => {
    const src = /@start\w+/.test(code) ? code : `@startuml\n${code}\n@enduml`;
    const p = spawn(config.plantumlCmd, [`-t${format}`, '-pipe', '-charset', 'UTF-8'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', (e) => reject(new Error(`PlantUML not available (${config.plantumlCmd}): ${e.message}`)));
    p.on('close', (codeExit) => {
      const buf = Buffer.concat(out);
      if (codeExit !== 0 && !buf.length) reject(new Error(`PlantUML error: ${Buffer.concat(err).toString().slice(0, 300)}`));
      else resolve(buf);
    });
    p.stdin.end(src);
  });
}

async function renderPlantuml(code) {
  const [svg, png] = await Promise.all([runPlantuml(code, 'svg'), runPlantuml(code, 'png')]);
  return { svg: svg.toString('utf8'), png };
}

const inflight = new Map();

/** @returns {Promise<{hash:string, kind:string, svg:string, png:Buffer, width:number, height:number}>} */
export async function renderDiagram(lang, code) {
  const kind = DIAGRAM_LANGS[lang];
  if (!kind) throw new Error(`Unsupported diagram language: ${lang}`);
  const hash = diagramHash(kind, code);
  const base = path.join(cacheDir(), `${kind}-${hash}`);
  if (fs.existsSync(`${base}.png`) && fs.existsSync(`${base}.svg`)) {
    const png = fs.readFileSync(`${base}.png`);
    return { hash, kind, svg: fs.readFileSync(`${base}.svg`, 'utf8'), png, ...pngSize(png) };
  }
  if (inflight.has(base)) return inflight.get(base);
  const job = (async () => {
    const { svg, png } = kind === 'mermaid' ? await renderMermaid(code) : await renderPlantuml(code);
    fs.writeFileSync(`${base}.svg`, svg);
    fs.writeFileSync(`${base}.png`, png);
    return { hash, kind, svg, png, ...pngSize(png) };
  })().finally(() => inflight.delete(base));
  inflight.set(base, job);
  return job;
}

export function pngSize(buf) {
  if (buf?.length > 24 && buf.readUInt32BE(12) === 0x49484452) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  return { width: 800, height: 600 };
}

/** Find all diagram fences in markdown. */
export function findDiagrams(markdown) {
  const out = [];
  const re = /^(`{3,}|~{3,})\s*(mermaid|plantuml|puml|uml)\s*\n([\s\S]*?)\n\1\s*$/gm;
  for (const m of markdown.matchAll(re)) out.push({ lang: m[2], code: m[3] });
  return out;
}
