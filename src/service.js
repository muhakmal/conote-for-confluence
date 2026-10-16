// Run the notebook without typing `node bin/cn.js serve`:
//   cn open              start the server in the background if needed, then open the browser
//   cn stop              stop a server started by `cn open`
//   cn service install   macOS LaunchAgent: server starts at login and restarts if it crashes
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { ROOT, config } from './config.js';

export const LABEL = 'com.conote.server';
const PID_FILE = () => path.join(config.cacheDir, 'server.pid');
export const LOG_FILE = () => path.join(config.cacheDir, 'server.log');
export const plistPath = (home = os.homedir()) => path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
export const localUrl = (port = config.port) => `http://127.0.0.1:${port}/`;

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** LaunchAgent definition. PATH is captured so plantuml/java/Chrome resolve like in the terminal. */
export function plist({ node = process.execPath, port = config.port, pathEnv = process.env.PATH || '', log = LOG_FILE() } = {}) {
  const args = [node, path.join(ROOT, 'bin', 'cn.js'), 'serve', '--port', String(port)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(pathEnv)}</string>
    <key>CN_SERVICE</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

/** Is something listening on this port? (a busy server may be slow to answer HTTP) */
function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    sock.setTimeout(1000);
    sock.once('connect', () => (sock.destroy(), resolve(true)));
    sock.once('timeout', () => (sock.destroy(), resolve(false)));
    sock.once('error', () => resolve(false));
  });
}

/** Is a notebook server answering on this port? */
export async function isRunning(port = config.port) {
  if (!(await portOpen(port))) return false;
  try {
    const res = await fetch(`${localUrl(port)}api/status`, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Called by `cn serve` in background mode so `cn stop` knows which process to end. */
export function writePidFile() {
  fs.mkdirSync(config.cacheDir, { recursive: true });
  fs.writeFileSync(PID_FILE(), String(process.pid));
  process.on('exit', () => {
    try {
      if (Number(fs.readFileSync(PID_FILE(), 'utf8')) === process.pid) fs.rmSync(PID_FILE());
    } catch {}
  });
}

async function waitUntil(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function rotateLog() {
  const log = LOG_FILE();
  try {
    if (fs.statSync(log).size > 2 * 1024 * 1024) fs.renameSync(log, `${log}.1`);
  } catch {}
}

/** Start the server detached from the terminal (no-op when it is already up). */
export async function startBackground(port = config.port) {
  if (await portOpen(port)) {
    if (await isRunning(port)) return { started: false };
    throw new Error(`Port ${port} is used by another program. Use --port, or set CN_PORT in .env`);
  }
  fs.mkdirSync(config.cacheDir, { recursive: true });
  rotateLog();
  const out = fs.openSync(LOG_FILE(), 'a');
  const child = spawn(process.execPath, [path.join(ROOT, 'bin', 'cn.js'), 'serve', '--port', String(port)], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, CN_BACKGROUND: '1' },
  });
  child.unref();
  if (!(await waitUntil(() => isRunning(port), 20_000))) {
    throw new Error(`Server did not start. See ${path.relative(process.cwd(), LOG_FILE())}`);
  }
  return { started: true, pid: child.pid };
}

export function stopBackground() {
  let pid;
  try {
    pid = Number(fs.readFileSync(PID_FILE(), 'utf8'));
  } catch {
    return false;
  }
  fs.rmSync(PID_FILE(), { force: true });
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false; // already gone
  }
}

const uid = () => process.getuid?.() ?? 501;
const launchctl = (...args) => execFileSync('launchctl', args, { stdio: 'pipe' }).toString();

export function serviceLoaded() {
  try {
    launchctl('print', `gui/${uid()}/${LABEL}`);
    return true;
  } catch {
    return false;
  }
}

export async function installService(port = config.port) {
  if (process.platform !== 'darwin') throw new Error('The login service uses macOS launchd. On other systems run `cn open` instead.');
  stopBackground();
  const file = plistPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(config.cacheDir, { recursive: true });
  if (serviceLoaded()) launchctl('bootout', `gui/${uid()}/${LABEL}`);
  fs.writeFileSync(file, plist({ port }));
  launchctl('bootstrap', `gui/${uid()}`, file);
  const up = await waitUntil(() => isRunning(port), 15_000);
  return { file, up };
}

export function uninstallService() {
  const file = plistPath();
  if (serviceLoaded()) launchctl('bootout', `gui/${uid()}/${LABEL}`);
  const existed = fs.existsSync(file);
  fs.rmSync(file, { force: true });
  return existed;
}

export function restartService() {
  launchctl('kickstart', '-k', `gui/${uid()}/${LABEL}`);
}
