#!/usr/bin/env node
// cn — Confluence Notebook CLI
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

// Mermaid/docx probe globals that Node 26 flags as experimental; keep CLI output clean.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.warn(w);
});

const argv = process.argv.slice(2);
let cmd = null;
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('-')) flags[k] = argv[++i];
    else flags[k] = true;
  } else if (a.startsWith('-') && a.length === 2) {
    flags[a.slice(1)] = argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : true;
  } else if (!cmd) {
    cmd = a;
  } else positional.push(a);
}

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

const HELP = `${c.bold('conote')} (or ${c.bold('cn')}) — CoNote for Confluence

${c.bold('Run the app')}
  cn open                               Start the web app in the background (if needed) and open it
  cn stop                               Stop the background server started by \`cn open\`
  cn service install|uninstall|status|restart|logs
                                        macOS: start the web app automatically at login
  cn serve [--port 4777] [--host 0.0.0.0] [--open]   Run in the foreground (Ctrl+C to stop)

${c.bold('Spaces')}
  cn space [list]                       List configured spaces and show active space
  cn space switch <name>                Switch active space (e.g. engineering, product)
  cn use <name>                         Shortcut to switch active space
  --space=<name>                        Global flag: target a specific space for any command

${c.bold('Space Operations')}
  cn pull [--full] [--reconvert]        Pull space into workspace/ (incremental)
  cn templates                          Pull Confluence page templates into workspace/_templates
  cn find <text>                        Search pulled pages by title
  cn move <pageId> <append|before|after> <targetId>   Move a page in Confluence
  cn status

${c.bold('Drafts')}
  cn new "<title>" [--template local:prd.md] [--parent <pageId>] [--owner <name>] [--tribe <TRIBE>]
  cn import <file.md|file.html…> [--parent <pageId>] [--keep-numbers]  Import existing PRDs as drafts
  cn check <draft.md>                   Check PRD standard + Confluence validity before publishing
  cn drafts                             List drafts
  cn diff <draft.md>                    What changed in Confluence (and locally) since the last publish
  cn publish <draft.md> [--force] [--as-new] [--dry-run] [-m "message"]
  cn history <draft.md>                 List saved versions of a draft
  cn restore <draft.md> <versionId>     Restore a saved version (current text is kept in history)
  cn trash [restore <id>]               List or restore deleted drafts
  cn export <file.md> [--docx] [--html] [-o <dir>]

${c.dim('Drafts live in drafts/, pulled pages in workspace/ (read-only mirror).')}
`;

/** Accept "drafts/x/y.md", "x/y.md" or an absolute path inside drafts/. */
function draftArg(config, file) {
  if (!file) return null;
  const abs = path.resolve(file);
  if (abs.startsWith(config.draftsDir + path.sep)) return path.relative(config.draftsDir, abs).split(path.sep).join('/');
  return String(file).replace(/^\.?\/?drafts\//, '');
}

async function main() {
  const { config, setActiveSpace } = await import('../src/config.js');
  if (flags.space || flags.s) {
    try {
      setActiveSpace(flags.space || flags.s, { persist: false });
    } catch (e) {
      console.error(c.red(`✗ ${e.message}`));
      process.exit(1);
    }
  }
  switch (cmd) {
    case 'pull': {
      const { pull, pullTemplates } = await import('../src/sync.js');
      let last = '';
      const summary = await pull({
        full: !!flags.full,
        reconvert: !!flags.reconvert,
        onProgress: (e) => {
          if (e.phase === 'fetch' && e.total) {
            const line = `  ${c.cyan('↓')} ${e.done}/${e.total} ${c.dim(String(e.message).slice(0, 60))}`;
            if (process.stdout.isTTY) process.stdout.write(`\r\x1b[K${line}`);
            else if (e.done === e.total) console.log(line);
          } else if (e.phase !== last || e.phase === 'done') {
            if (process.stdout.isTTY) process.stdout.write('\r\x1b[K');
            console.log(`${c.dim(e.phase.padEnd(8))} ${e.message || ''}`);
          }
          last = e.phase;
        },
      });
      if (!fs.existsSync(path.join(config.workspaceDir, '_templates'))) {
        await pullTemplates().catch((e) => console.log(c.dim(`  templates: ${e.message}`)));
      }
      console.log(c.green(`✓ ${summary.pages} pages · ${summary.fetched} fetched · ${summary.removed} removed · ${summary.seconds}s`));
      console.log(c.dim(`  overview: ${path.relative(process.cwd(), path.join(config.workspaceDir, '_OVERVIEW.md'))}`));
      break;
    }
    case 'templates': {
      const { pullTemplates } = await import('../src/sync.js');
      const names = await pullTemplates();
      console.log(c.green(`✓ ${names.length} templates: ${names.join(', ')}`));
      break;
    }
    case 'new': {
      const { createDraft } = await import('../src/drafts.js');
      const title = positional.join(' ');
      const name = createDraft({ title, template: flags.template || 'local:prd.md', parentId: flags.parent, owner: flags.owner, tribe: flags.tribe });
      console.log(c.green(`✓ drafts/${name}`));
      break;
    }
    case 'import': {
      const { importMarkdown } = await import('../src/importer.js');
      if (!positional.length) throw new Error('Usage: cn import <file.md> [more.md] [--parent <pageId>]');
      for (const file of positional) {
        const abs = path.resolve(file);
        const r = importMarkdown({ filename: path.basename(abs), text: fs.readFileSync(abs, 'utf8'), parentId: flags.parent, sourceDir: path.dirname(abs), stripNumbers: !flags['keep-numbers'] });
        console.log(`${r.publishable ? c.green('✓') : c.yellow('!')} drafts/${r.name}  ${c.dim(`${r.title} · ${r.images} image(s)`)}`);
        for (const w of r.warnings) console.log(c.yellow(`    ${w}`));
      }
      break;
    }
    case 'check': {
      const { parseDoc } = await import('../src/frontmatter.js');
      const { reviewPrd } = await import('../src/prd-standard.js');
      const { validateStorage } = await import('../src/render.js');
      const file = positional[0];
      if (!file) throw new Error('Usage: cn check <draft.md>');
      const abs = fs.existsSync(path.resolve(file)) ? path.resolve(file) : path.resolve(config.draftsDir, file);
      const { meta, body } = parseDoc(fs.readFileSync(abs, 'utf8'));
      const notes = reviewPrd(meta, body);
      const v = validateStorage(meta, body, { baseDir: path.dirname(abs) });
      console.log(`${c.bold(meta.title || path.basename(abs))}`);
      console.log(v.ok ? c.green('  ✓ Confluence storage is valid') : c.red(`  ✗ Would not publish: ${v.error}`));
      for (const n of notes) console.log(`  ${n.level === 'warn' ? c.yellow('!') : c.dim('i')} ${n.text}`);
      if (!notes.length) console.log(c.green('  ✓ Matches the PRD standard'));
      if (!v.ok) process.exitCode = 1;
      break;
    }
    case 'drafts': {
      const { listDrafts } = await import('../src/drafts.js');
      for (const d of listDrafts()) {
        const state = d.confluence_id ? (d.dirty ? c.yellow('● changed') : c.green('● published')) : c.dim('○ local');
        console.log(`${state}  ${d.name}  ${c.dim(d.title)}`);
      }
      break;
    }
    case 'publish': {
      const { publishDraft, PublishConflict } = await import('../src/publish.js');
      const { prefetchAttachments } = await import('../src/attachments.js');
      const { parseDoc } = await import('../src/frontmatter.js');
      const { closeBrowser } = await import('../src/diagrams.js');
      const file = positional[0];
      if (!file) throw new Error('Usage: cn publish <draft.md>');
      const abs = path.resolve(file);
      const rel = abs.startsWith(config.draftsDir + path.sep) || !fs.existsSync(abs) ? draftArg(config, file) : abs;
      try {
        await prefetchAttachments(parseDoc(fs.readFileSync(path.resolve(config.draftsDir, rel), 'utf8')).body);
        const r = await publishDraft(rel, {
          force: !!flags.force,
          asNew: !!flags['as-new'],
          dryRun: !!flags['dry-run'],
          message: flags.m || flags.message,
          onProgress: (e) => console.log(`${c.dim((e.phase || '').padEnd(8))} ${e.message || ''}`),
        });
        if (r.dryRun) {
          console.log(r.storage);
          console.log(c.dim(`attachments: ${r.attachments.join(', ') || '—'}`));
        } else console.log(c.green(`✓ v${r.version} → ${r.url}`));
      } catch (e) {
        if (e.code === 'PAGE_GONE') {
          console.error(c.red(`✗ ${e.message}`));
          console.error(c.dim('  Re-run with --as-new to create a new page from this draft.'));
          process.exitCode = 2;
        } else if (e instanceof PublishConflict) {
          console.error(c.red(`✗ ${e.message}`));
          process.exitCode = 2;
        } else throw e;
      } finally {
        await closeBrowser();
      }
      break;
    }
    case 'export': {
      const { parseDoc } = await import('../src/frontmatter.js');
      const { toDocx } = await import('../src/docx.js');
      const { toStandaloneHtml } = await import('../src/render.js');
      const { prefetchAttachments } = await import('../src/attachments.js');
      const { closeBrowser } = await import('../src/diagrams.js');
      const { slugify } = await import('../src/classify.js');
      const file = positional[0];
      if (!file) throw new Error('Usage: cn export <file.md> [--docx] [--html]');
      const abs = fs.existsSync(path.resolve(file)) ? path.resolve(file) : path.resolve(config.draftsDir, file);
      const { meta, body } = parseDoc(fs.readFileSync(abs, 'utf8'));
      await prefetchAttachments(body);
      const outDir = path.resolve(flags.o || config.exportsDir);
      fs.mkdirSync(outDir, { recursive: true });
      const base = slugify(meta.title || path.basename(abs, '.md'), 80);
      const both = !flags.docx && !flags.html;
      try {
        if (flags.docx || both) {
          const f = path.join(outDir, `${base}.docx`);
          fs.writeFileSync(f, await toDocx(meta, body, { baseDir: path.dirname(abs) }));
          console.log(c.green(`✓ ${path.relative(process.cwd(), f)}`));
        }
        if (flags.html || both) {
          const f = path.join(outDir, `${base}.html`);
          fs.writeFileSync(f, await toStandaloneHtml(meta, body, { baseDir: path.dirname(abs) }));
          console.log(c.green(`✓ ${path.relative(process.cwd(), f)}`));
        }
      } finally {
        await closeBrowser();
      }
      break;
    }
    case 'find': {
      const { readIndex } = await import('../src/sync.js');
      const term = positional.join(' ').toLowerCase();
      const index = readIndex();
      if (!index) throw new Error('Nothing pulled yet — run `cn pull`');
      const hits = Object.values(index.nodes).filter((n) => n.title.toLowerCase().includes(term)).slice(0, 40);
      for (const n of hits) console.log(`${c.dim(n.id.padEnd(11))} ${n.title}  ${c.dim(`${n.docType}${n.lifecycle ? ' · ' + n.lifecycle : ''}`)}\n${c.dim('            workspace/' + n.path)}`);
      if (!hits.length) console.log(c.dim('no matches'));
      break;
    }
    case 'use':
    case 'space': {
      const { listSpaces, getActiveSpace, setActiveSpace, getSpaceConfig } = await import('../src/config.js');
      const sub = positional[0];
      const target = cmd === 'use' ? sub : (sub === 'switch' || sub === 'use' ? positional[1] : (sub && !['list', 'status'].includes(sub) ? sub : null));
      if (target) {
        try {
          const switched = setActiveSpace(target, { persist: true });
          const conf = getSpaceConfig(switched);
          console.log(c.green(`✓ Active space set to ${conf.name} (${conf.key}) [${switched}]`));
          console.log(c.dim(`  workspace: ${path.relative(process.cwd(), conf.workspaceDir) || conf.workspaceDir}`));
          console.log(c.dim(`  drafts:    ${path.relative(process.cwd(), conf.draftsDir) || conf.draftsDir}`));
        } catch (e) {
          console.error(c.red(`✗ ${e.message}`));
          process.exitCode = 1;
        }
        break;
      }
      const active = getActiveSpace();
      console.log(c.bold('Confluence Spaces:'));
      for (const s of listSpaces()) {
        const marker = s.id === active ? c.green('●') : c.dim('○');
        const activeLabel = s.id === active ? c.green(' [ACTIVE]') : '';
        console.log(`  ${marker} ${c.bold(s.id.padEnd(10))} ${s.name} (${s.key}) · ${c.dim(s.baseUrl)}${activeLabel}`);
      }
      console.log(c.dim(`\nSwitch space: cn space switch <name> (or cn use <name>)`));
      break;
    }
    case 'status': {
      const { readIndex } = await import('../src/sync.js');
      const { listDrafts } = await import('../src/drafts.js');
      const { getActiveSpace, listSpaces, getSpaceConfig } = await import('../src/config.js');
      const activeId = getActiveSpace();
      const curConf = getSpaceConfig(activeId);
      const index = readIndex();
      console.log(`${c.bold('Active Space')} ${curConf.name} (${config.spaceKey}) [${activeId}] ${c.dim(config.baseUrl)}`);
      console.log(`${c.bold('Account')}      ${config.email}`);
      console.log(`${c.bold('Workspace')}    ${path.relative(process.cwd(), config.workspaceDir) || config.workspaceDir}`);
      console.log(`${c.bold('Drafts')}       ${path.relative(process.cwd(), config.draftsDir) || config.draftsDir}`);
      console.log(`${c.bold('Pulled')}       ${index ? `${Object.keys(index.nodes).length} pages at ${index.pulledAt}` : c.yellow('never — run cn pull')}`);
      const drafts = listDrafts();
      console.log(`${c.bold('Drafts Count')} ${drafts.length} (${drafts.filter((d) => d.confluence_id).length} published, ${drafts.filter((d) => d.confluence_id && d.dirty).length} changed since publish)`);
      console.log(`${c.bold('All Spaces')}   ${listSpaces().map(s => s.active ? c.green(`● ${s.id}`) : c.dim(`○ ${s.id}`)).join('  ')}`);
      break;
    }
    case 'serve': {
      const { startServer } = await import('../src/server.js');
      const port = Number(flags.port || config.port);
      const host = flags.host === true ? '0.0.0.0' : flags.host || '127.0.0.1';
      let urls;
      try {
        ({ urls } = await startServer({ port, host }));
      } catch (e) {
        const { isRunning, localUrl } = await import('../src/service.js');
        if (e.code === 'EADDRINUSE' && (await isRunning(port))) {
          console.log(c.green(`✓ Already running at ${localUrl(port)}`));
          if (flags.open) spawn('open', [localUrl(port)], { stdio: 'ignore', detached: true }).unref();
          break;
        }
        throw e.code === 'EADDRINUSE' ? new Error(`Port ${port} is used by another program. Try --port ${port + 1}`) : e;
      }
      if (process.env.CN_BACKGROUND) (await import('../src/service.js')).writePidFile();
      const { closeBrowser } = await import('../src/diagrams.js');
      const shutdown = async () => {
        await closeBrowser().catch(() => {});
        process.exit(0);
      };
      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
      console.log(`${c.bold('Confluence Notebook')} ${c.dim(`· space ${config.spaceKey}`)}`);
      for (const u of urls) console.log(`  ${c.cyan('➜')} ${u}`);
      if (host !== '127.0.0.1') console.log(c.yellow('  LAN mode: share the key URL only with your own devices.'));
      if (flags.open) spawn('open', [urls[0]], { stdio: 'ignore', detached: true }).unref();
      break;
    }
    case 'open': {
      const { startBackground, localUrl, serviceLoaded } = await import('../src/service.js');
      const port = Number(flags.port || config.port);
      const r = await startBackground(port);
      if (r.started) console.log(c.green(`✓ Server started in the background (pid ${r.pid})`));
      else console.log(c.dim(serviceLoaded() ? 'Server is running (login service).' : 'Server is already running.'));
      console.log(`  ${c.cyan('➜')} ${localUrl(port)}`);
      if (!flags['no-browser']) spawn('open', [localUrl(port)], { stdio: 'ignore', detached: true }).unref();
      break;
    }
    case 'stop': {
      const { stopBackground, serviceLoaded } = await import('../src/service.js');
      if (stopBackground()) console.log(c.green('✓ Stopped'));
      else console.log(c.dim('No background server started by `cn open`.'));
      if (serviceLoaded()) console.log(c.yellow('  The login service is installed and keeps its own server running: `cn service uninstall` to remove it.'));
      break;
    }
    case 'service': {
      const svc = await import('../src/service.js');
      const sub = positional[0] || 'status';
      const port = Number(flags.port || config.port);
      if (sub === 'install') {
        const { file, up } = await svc.installService(port);
        console.log(c.green(`✓ Installed ${file.replace(process.env.HOME, '~')}`));
        console.log(up ? `  ${c.cyan('➜')} ${svc.localUrl(port)} ${c.dim('(starts automatically at login)')}` : c.yellow(`  Installed, but the server is not answering yet. See ${svc.LOG_FILE()}`));
        console.log(c.dim('  Tip: open it in Chrome and choose "Install page as app" to get a Dock icon.'));
      } else if (sub === 'uninstall') {
        console.log(svc.uninstallService() ? c.green('✓ Login service removed') : c.dim('Login service was not installed.'));
      } else if (sub === 'restart') {
        svc.restartService();
        console.log(c.green('✓ Restarted'));
      } else if (sub === 'logs') {
        const log = svc.LOG_FILE();
        console.log(fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').slice(-60).join('\n') : c.dim('No log yet.'));
      } else {
        const loaded = svc.serviceLoaded();
        const running = await svc.isRunning(port);
        console.log(`${c.bold('Login service')}  ${loaded ? c.green('installed') : c.dim('not installed')}`);
        console.log(`${c.bold('Server')}         ${running ? c.green(`running · ${svc.localUrl(port)}`) : c.dim('not running')}`);
      }
      break;
    }
    case 'diff': {
      const { compareWithRemote } = await import('../src/remote.js');
      const name = draftArg(config, positional[0]);
      if (!name) throw new Error('Usage: cn diff <draft.md>');
      const r = await compareWithRemote(name);
      const show = (label, part) => {
        if (!part) return console.log(c.dim(`${label}: no earlier publish recorded`));
        console.log(c.bold(`${label}: +${part.stats.added} -${part.stats.removed}`));
        for (const h of part.hunks) {
          console.log(c.cyan(`@@ line ${h.aStart} → ${h.bStart} @@`));
          for (const l of h.lines) console.log(l.op === '+' ? c.green(`+ ${l.line}`) : l.op === '-' ? c.red(`- ${l.line}`) : c.dim(`  ${l.line}`));
        }
      };
      console.log(`${c.bold(r.title)}  ${c.dim(`remote v${r.remoteVersion}${r.remoteAuthor ? ` by ${r.remoteAuthor}` : ''} · last published v${r.localVersion}`)}`);
      if (Number(r.remoteVersion) === Number(r.localVersion)) console.log(c.green('✓ Nobody changed the page in Confluence since your last publish'));
      show(r.approximate ? 'Draft vs Confluence (approximate: no publish baseline)' : 'Changed in Confluence', r.remote);
      show('Changed in your draft', r.local);
      break;
    }
    case 'history': {
      const { listHistory } = await import('../src/history.js');
      const name = draftArg(config, positional[0]);
      if (!name) throw new Error('Usage: cn history <draft.md>');
      const list = listHistory(name);
      for (const h of list) console.log(`${c.dim(h.id)}  ${new Date(h.at).toLocaleString()}  ${h.reason.padEnd(8)} ${c.dim(`${h.size} chars`)}`);
      if (!list.length) console.log(c.dim('No saved versions yet (they are made as you edit, publish and restore).'));
      break;
    }
    case 'restore': {
      const { restoreSnapshot } = await import('../src/drafts.js');
      const name = draftArg(config, positional[0]);
      if (!name || !positional[1]) throw new Error('Usage: cn restore <draft.md> <versionId>   (ids from `cn history`)');
      restoreSnapshot(name, positional[1]);
      console.log(c.green(`✓ drafts/${name} restored to ${positional[1]}`));
      break;
    }
    case 'trash': {
      const { listTrash, restoreFromTrash } = await import('../src/history.js');
      const { safeDraftPath } = await import('../src/drafts.js');
      if (positional[0] === 'restore') {
        if (!positional[1]) throw new Error('Usage: cn trash restore <id>');
        console.log(c.green(`✓ Restored as drafts/${restoreFromTrash(positional[1], safeDraftPath)}`));
      } else {
        const list = listTrash();
        for (const t of list) console.log(`${c.dim(t.id)}  ${t.title}  ${c.dim(`${t.name} · deleted ${new Date(t.deletedAt).toLocaleString()}`)}`);
        if (!list.length) console.log(c.dim('Trash is empty'));
      }
      break;
    }
    case 'move': {
      const { movePage } = await import('../src/move.js');
      const { pull } = await import('../src/sync.js');
      const [id, position, targetId] = positional;
      if (!id || !position || !targetId) throw new Error('Usage: cn move <pageId> <append|before|after> <targetId>');
      const r = await movePage(id, position, targetId);
      console.log(c.green(`✓ Moved ${id} (new parent ${r.parentId})`));
      await pull({});
      console.log(c.dim('  workspace refreshed'));
      break;
    }
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;
    default:
      console.error(c.red(`Unknown command: ${cmd}`));
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(c.red(`✗ ${e.message}`));
  if (process.env.CN_DEBUG) console.error(e);
  process.exitCode = 1;
});
