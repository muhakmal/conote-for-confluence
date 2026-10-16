import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPACES_FILE = path.join(ROOT, 'spaces.json');
const ACTIVE_FILE = path.join(ROOT, '.active_space');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnvFile(path.join(ROOT, '.env')), ...process.env };
const abs = (p, def) => path.resolve(ROOT, p || def);

function defaultSpaceFromEnv() {
  const key = env.CONFLUENCE_SPACE_KEY || 'DEV';
  const id = (env.CN_SPACE_ID || key || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'default';
  return {
    [id]: {
      id,
      name: env.CONFLUENCE_SPACE_NAME || key || 'Default Space',
      key,
      baseUrl: (env.CONFLUENCE_BASE_URL || '').replace(/\/+$/, ''),
      email: env.CONFLUENCE_EMAIL || '',
      tokenFile: env.CONFLUENCE_TOKEN_FILE || 'confluence-token.txt',
      workspaceDir: env.CN_WORKSPACE_DIR || 'workspace',
      draftsDir: env.CN_DRAFTS_DIR || 'drafts',
      cacheDir: env.CN_CACHE_DIR || '.cache',
      templatesDir: env.CN_TEMPLATES_DIR || 'templates',
      exportsDir: env.CN_EXPORTS_DIR || 'exports',
    },
  };
}

function loadSpacesConfig() {
  let fileData = {};
  if (fs.existsSync(SPACES_FILE)) {
    try {
      fileData = JSON.parse(fs.readFileSync(SPACES_FILE, 'utf8'));
    } catch {}
  }
  const defaultSpaces = defaultSpaceFromEnv();
  const spaces = { ...defaultSpaces, ...(fileData.spaces || {}) };

  // Environment overrides for the active/default space
  const firstId = Object.keys(spaces)[0] || 'default';
  if (spaces[firstId]) {
    if (env.CONFLUENCE_BASE_URL) spaces[firstId].baseUrl = env.CONFLUENCE_BASE_URL.replace(/\/+$/, '');
    if (env.CONFLUENCE_EMAIL) spaces[firstId].email = env.CONFLUENCE_EMAIL;
    if (env.CONFLUENCE_TOKEN_FILE) spaces[firstId].tokenFile = env.CONFLUENCE_TOKEN_FILE;
    if (env.CONFLUENCE_SPACE_KEY) spaces[firstId].key = env.CONFLUENCE_SPACE_KEY;
    if (env.CN_WORKSPACE_DIR) spaces[firstId].workspaceDir = env.CN_WORKSPACE_DIR;
    if (env.CN_DRAFTS_DIR) spaces[firstId].draftsDir = env.CN_DRAFTS_DIR;
    if (env.CN_CACHE_DIR) spaces[firstId].cacheDir = env.CN_CACHE_DIR;
    if (env.CN_TEMPLATES_DIR) spaces[firstId].templatesDir = env.CN_TEMPLATES_DIR;
    if (env.CN_EXPORTS_DIR) spaces[firstId].exportsDir = env.CN_EXPORTS_DIR;
  }

  const active = fileData.active || Object.keys(spaces)[0] || 'default';
  return { active, spaces };
}

let spacesState = loadSpacesConfig();

export function reloadSpacesConfig() {
  spacesState = loadSpacesConfig();
  return spacesState;
}

export function saveSpacesConfig(data) {
  if (data?.spaces) spacesState.spaces = data.spaces;
  if (data?.active) spacesState.active = data.active;
  fs.writeFileSync(SPACES_FILE, JSON.stringify({ active: spacesState.active, spaces: spacesState.spaces }, null, 2), 'utf8');
}

export function getActiveSpace() {
  if (process.env.CN_ACTIVE_SPACE && spacesState.spaces[process.env.CN_ACTIVE_SPACE]) {
    return process.env.CN_ACTIVE_SPACE;
  }
  if (fs.existsSync(ACTIVE_FILE)) {
    try {
      const saved = fs.readFileSync(ACTIVE_FILE, 'utf8').trim();
      if (spacesState.spaces[saved]) return saved;
    } catch {}
  }
  return spacesState.active || Object.keys(spacesState.spaces)[0] || 'default';
}

export function setActiveSpace(id, { persist = true } = {}) {
  const norm = String(id || '').trim().toLowerCase();
  const matched = Object.keys(spacesState.spaces).find(
    (k) => k.toLowerCase() === norm || spacesState.spaces[k].key?.toLowerCase() === norm
  );
  if (!matched) {
    throw new Error(`Unknown space '${id}'. Available spaces: ${Object.keys(spacesState.spaces).join(', ')}`);
  }
  spacesState.active = matched;
  process.env.CN_ACTIVE_SPACE = matched;
  if (persist) {
    try {
      fs.writeFileSync(ACTIVE_FILE, matched, 'utf8');
      if (fs.existsSync(SPACES_FILE)) {
        const data = JSON.parse(fs.readFileSync(SPACES_FILE, 'utf8'));
        data.active = matched;
        fs.writeFileSync(SPACES_FILE, JSON.stringify(data, null, 2), 'utf8');
      }
    } catch {}
  }
  return matched;
}

export function listSpaces() {
  const active = getActiveSpace();
  return Object.values(spacesState.spaces).map((s) => ({
    id: s.id,
    name: s.name,
    key: s.key,
    baseUrl: s.baseUrl,
    email: s.email,
    active: s.id === active,
  }));
}

export function getSpaceConfig(spaceId = getActiveSpace()) {
  const s = spacesState.spaces[spaceId] || spacesState.spaces[Object.keys(spacesState.spaces)[0]] || {
    id: 'default',
    name: 'Default Space',
    key: '',
    baseUrl: '',
    email: '',
    tokenFile: 'confluence-token.txt',
    workspaceDir: 'workspace',
    draftsDir: 'drafts',
    templatesDir: 'templates',
    exportsDir: 'exports',
    cacheDir: '.cache',
  };
  const isDefault = s.id === 'default' || s.id === Object.keys(spacesState.spaces)[0];
  return {
    id: s.id,
    name: s.name,
    key: s.key,
    spaceKey: s.key,
    baseUrl: (s.baseUrl || '').replace(/\/+$/, ''),
    email: s.email || '',
    tokenFile: abs(s.tokenFile, 'confluence-token.txt'),
    workspaceDir: abs(s.workspaceDir, isDefault ? 'workspace' : `workspace_${s.id}`),
    draftsDir: abs(s.draftsDir, isDefault ? 'drafts' : `drafts_${s.id}`),
    templatesDir: abs(s.templatesDir, 'templates'),
    exportsDir: abs(s.exportsDir, isDefault ? 'exports' : `exports_${s.id}`),
    cacheDir: abs(s.cacheDir, isDefault ? '.cache' : `.cache_${s.id}`),
  };
}

const SHARED_CONFIG = {
  get chromePath() {
    if (env.CN_CHROME_PATH) return env.CN_CHROME_PATH;
    if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    return '/usr/bin/google-chrome';
  },
  get plantumlCmd() {
    return env.CN_PLANTUML_CMD || 'plantuml';
  },
  get autoFetchMinutes() {
    return Number(env.CN_AUTO_FETCH_MINUTES || 0);
  },
  get port() {
    return Number(env.CN_PORT || env.PORT || 4777);
  },
};

export const config = new Proxy({}, {
  get(target, prop) {
    if (prop in SHARED_CONFIG) return SHARED_CONFIG[prop];
    const cur = getSpaceConfig();
    if (prop in cur) return cur[prop];
    if (prop === 'spaceKey') return cur.key;
    return undefined;
  },
  set(target, prop, value) {
    const cur = spacesState.spaces[getActiveSpace()];
    if (cur) cur[prop] = value;
    return true;
  },
  ownKeys() {
    const cur = getSpaceConfig();
    return Array.from(new Set([...Object.keys(cur), ...Object.keys(SHARED_CONFIG), 'spaceKey']));
  },
  getOwnPropertyDescriptor(target, prop) {
    return {
      enumerable: true,
      configurable: true,
      value: this.get(target, prop),
    };
  },
});

/** Token is read lazily and never logged. */
export function readToken(spaceId = getActiveSpace()) {
  const envToken = env.CONFLUENCE_API_TOKEN;
  if (envToken) return envToken.trim();
  const cur = getSpaceConfig(spaceId);
  if (!fs.existsSync(cur.tokenFile)) {
    throw new Error(`Token file not found: ${path.relative(ROOT, cur.tokenFile)}`);
  }
  return fs.readFileSync(cur.tokenFile, 'utf8').trim();
}

export function assertConfigured(spaceId = getActiveSpace()) {
  const cur = getSpaceConfig(spaceId);
  const missing = ['baseUrl', 'email', 'spaceKey'].filter((k) => !cur[k]);
  if (missing.length) throw new Error(`Missing config for space '${cur.id}': ${missing.join(', ')}`);
}

export function ensureDirs(spaceId = getActiveSpace()) {
  const cur = getSpaceConfig(spaceId);
  for (const d of [cur.workspaceDir, cur.draftsDir, cur.templatesDir, cur.exportsDir, cur.cacheDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

export function ensureAllDirs() {
  for (const id of Object.keys(spacesState.spaces)) {
    ensureDirs(id);
  }
}
