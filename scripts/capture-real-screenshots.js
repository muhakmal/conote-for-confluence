import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { setup } from '../test/helpers/fake-confluence.js';

const { root, fake, cleanup } = setup();

// Configure realistic spaces
fs.writeFileSync(
  path.join(root, 'cache', 'settings.json'),
  JSON.stringify({ autoFetchMinutes: 0, autoFetchOnStart: false })
);

const home = fake.pages.get('100');
if (home) home.title = 'Core Engineering Home';

const rfcFolder = fake.addPage({ id: '200', title: 'Architecture RFCs', parentId: '100' });
const infraFolder = fake.addPage({ id: '300', title: 'Platform Infrastructure', parentId: '100' });

const arch202Body = `
<ac:structured-macro ac:name="info">
  <ac:rich-text-body>
    <p><strong>Architecture RFC:</strong> High-throughput payment routing engine with automated circuit breaker failover and 99.99% SLA guarantee.</p>
  </ac:rich-text-body>
</ac:structured-macro>
<h2>1. Executive Summary</h2>
<p>The core payment router handles transaction dispatching across multiple upstream payment billers and banking networks with zero editor lag and real-time health checks.</p>
<h2>2. Architecture Flowchart</h2>
<ac:structured-macro ac:name="mermaid">
  <ac:plain-text-body><![CDATA[
flowchart LR
  Client["Mobile / Web Client"] --> Router["Payment Router Engine"]
  Router --> Primary["Primary Gateway (WinPay)"]
  Router --> Secondary["Fallback Gateway (Direct)"]
  Primary -.->|Timeout / Error| Router
  ]]></ac:plain-text-body>
</ac:structured-macro>
<h2>3. Gateway SLA & Benchmarks</h2>
<table>
  <thead>
    <tr><th>Partner Gateway</th><th>Target Latency</th><th>SLA</th><th>Fallback Trigger</th></tr>
  </thead>
  <tbody>
    <tr><td>WinPay Virtual Account</td><td>42ms</td><td>99.99%</td><td>3 consecutive 5xx errors</td></tr>
    <tr><td>Direct Banking Core</td><td>38ms</td><td>99.95%</td><td>5 consecutive 5xx errors</td></tr>
    <tr><td>E-Wallet Aggregator</td><td>65ms</td><td>99.90%</td><td>Error rate &gt; 2.5%</td></tr>
  </tbody>
</table>
`;

fake.addPage({
  id: '201',
  title: '[ARCH-202] Payment Routing Engine & Circuit Breaker',
  parentId: '200',
  body: arch202Body,
  version: 3,
});

fake.addPage({
  id: '202',
  title: '[ARCH-201] Multi-Tenant Token Vault & SafeStorage',
  parentId: '200',
  body: '<p>Encryption architecture for client API credentials.</p>',
  version: 2,
});

fake.addPage({
  id: '301',
  title: 'Kubernetes Cluster Autoscaling & Ingress Specs',
  parentId: '300',
  body: '<p>HPA configuration guidelines.</p>',
  version: 1,
});

// Import sync and server
const { pull } = await import('../src/sync.js');
const { startServer } = await import('../src/server.js');

console.log('Pulling sample space...');
await pull({});

console.log('Starting in-process server...');
const { server } = await startServer({ port: 0 });
const port = server.address().port;
console.log(`Server listening on port ${port}`);

// Launch Puppeteer with Chrome
console.log('Launching headless Chrome...');
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2, // Retina high resolution
  },
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();

// Set dark mode preferred
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);

const url = `http://localhost:${port}/`;
console.log(`Navigating to ${url}...`);
await page.goto(url, { waitUntil: 'domcontentloaded' });

// Wait for app and tree to load
await page.waitForSelector('.tree-row', { timeout: 10000 });

// Find the ARCH-202 page in the tree or open any child page
console.log('Opening [ARCH-202] document...');
const opened = await page.evaluate(() => {
  // First expand any collapsed folders
  const expanders = document.querySelectorAll('.tree-row[aria-expanded="false"]');
  for (const exp of expanders) exp.click();

  const rows = Array.from(document.querySelectorAll('.tree-row'));
  const target = rows.find((r) => r.textContent.includes('ARCH-202')) || rows[rows.length - 1];
  if (target) {
    target.click();
    return true;
  }
  return false;
});

if (opened) {
  // Wait for editor, preview, and mermaid to settle
  await new Promise((r) => setTimeout(r, 2500));
}

// Ensure docs/assets directory exists
const assetsDir = path.resolve('docs', 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

// Screenshot 1: Document View with Tree & TOC Outline
const mainScreenshotPath = path.join(assetsDir, 'app-screenshot.png');
console.log(`Saving document view screenshot to ${mainScreenshotPath}...`);
await page.screenshot({ path: mainScreenshotPath, type: 'png' });

// Screenshot 2: Click "Edit as draft" to capture Dual Split Markdown Editor
console.log('Clicking "Edit as draft" to open split Markdown editor...');
await page.evaluate(() => {
  const btn = document.querySelector('[data-act="to-draft"]');
  if (btn) btn.click();
});
await new Promise((r) => setTimeout(r, 2000));

const editorScreenshotPath = path.join(assetsDir, 'editor-screenshot.png');
console.log(`Saving dual editor screenshot to ${editorScreenshotPath}...`);
await page.screenshot({ path: editorScreenshotPath, type: 'png' });

// Screenshot 2b: Switch to Split Markdown Editor
console.log('Switching to Split Markdown Editor mode...');
await page.evaluate(() => {
  const splitBtn = document.querySelector('[data-mode="split"]');
  if (splitBtn) splitBtn.click();
});
await new Promise((r) => setTimeout(r, 1200));

const splitScreenshotPath = path.join(assetsDir, 'markdown-split-screenshot.png');
console.log(`Saving markdown split screenshot to ${splitScreenshotPath}...`);
await page.screenshot({ path: splitScreenshotPath, type: 'png' });

// Screenshot 3: Click Settings Dialog to capture Multi-space management
console.log('Opening Settings Dialog for modal screenshot...');
await page.evaluate(() => {
  const btn = document.querySelector('[data-action="settings"]');
  if (btn) btn.click();
});

await new Promise((r) => setTimeout(r, 800));
const settingsScreenshotPath = path.join(assetsDir, 'settings-screenshot.png');
console.log(`Saving settings screenshot to ${settingsScreenshotPath}...`);
await page.screenshot({ path: settingsScreenshotPath, type: 'png' });

// Screenshot 4: Click "+ Add Space" to capture Onboarding & Connection Wizard
console.log('Clicking "+ Add Space" to capture Connection Wizard...');
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Add Space'));
  if (btn) btn.click();
});
await new Promise((r) => setTimeout(r, 800));
const onboardingScreenshotPath = path.join(assetsDir, 'onboarding-screenshot.png');
console.log(`Saving onboarding screenshot to ${onboardingScreenshotPath}...`);
await page.screenshot({ path: onboardingScreenshotPath, type: 'png' });

console.log('Closing browser and server...');
await browser.close();
server.close();
server.closeAllConnections?.();
cleanup();
console.log('All real screenshots captured successfully!');
