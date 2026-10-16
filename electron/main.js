import { app, BrowserWindow, Menu, Tray, dialog, shell, safeStorage, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.js';
import { ROOT, config, listSpaces, getActiveSpace, setActiveSpace } from '../src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isMac = process.platform === 'darwin';
let mainWindow = null;
let tray = null;
let serverInstance = null;
let serverPort = null;

// Enforce single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

async function bootServer() {
  if (serverInstance) return serverPort;
  const { server } = await startServer({ port: 0, host: '127.0.0.1' });
  serverInstance = server;
  serverPort = server.address().port;
  return serverPort;
}

function buildMenu() {
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: 'Preferences…',
                accelerator: 'Cmd+,',
                click: () => mainWindow?.webContents.executeJavaScript(`document.querySelector('[data-action="settings"]')?.click()`),
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Draft…',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.executeJavaScript(`document.querySelector('[data-action="new-draft"]')?.click()`),
        },
        {
          label: 'Quick Search / Command Palette',
          accelerator: 'CmdOrCtrl+K',
          click: () => mainWindow?.webContents.executeJavaScript(`document.querySelector('[data-action="palette"]')?.click()`),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(process.env.NODE_ENV === 'development' || !app.isPackaged
          ? [{ type: 'separator' }, { role: 'toggleDevTools' }]
          : []),
      ],
    },
    {
      label: 'Space',
      submenu: [
        {
          label: 'Fetch Space Now',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => mainWindow?.webContents.executeJavaScript(`document.querySelector('[data-action="pull"]')?.click()`),
        },
        {
          label: 'Manage Spaces…',
          click: () => mainWindow?.webContents.executeJavaScript(`document.querySelector('[data-action="settings"]')?.click()`),
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }]
          : [{ role: 'close' }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'CoNote Documentation',
          click: () => shell.openExternal('https://github.com/muhakmal/conote-for-confluence'),
        },
        {
          label: 'Report an Issue',
          click: () => shell.openExternal('https://github.com/muhakmal/conote-for-confluence/issues'),
        },
        {
          label: 'Atlassian API Tokens Portal',
          click: () => shell.openExternal('https://id.atlassian.com/manage-profile/security/api-tokens'),
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

function createTray(iconPath) {
  if (tray) return;
  try {
    tray = new Tray(iconPath);
    tray.setToolTip('CoNote for Confluence');
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open CoNote',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: 'Fetch Active Space',
        click: () => mainWindow?.webContents.executeJavaScript(`document.querySelector('[data-action="pull"]')?.click()`),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => app.quit(),
      },
    ]);
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) mainWindow.focus();
        else mainWindow.show();
      }
    });
  } catch {}
}

async function createWindow() {
  const port = await bootServer();

  const iconPath = path.join(ROOT, 'web', 'icon-512.png');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 860,
    minHeight: 580,
    title: 'CoNote for Confluence',
    icon: iconPath,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const appUrl = `http://127.0.0.1:${port}/`;
  await mainWindow.loadURL(appUrl);

  Menu.setApplicationMenu(buildMenu());
  createTray(path.join(ROOT, 'web', 'icon-192.png'));

  // Open external links in user's default browser instead of Electron webview
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('dialog:chooseDirectory', async (_event, { defaultPath, title = 'Select Workspace Directory' } = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    defaultPath: defaultPath || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('shell:openExternal', async (_event, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

ipcMain.handle('safeStorage:isAvailable', () => {
  return safeStorage.isEncryptionAvailable();
});

ipcMain.handle('safeStorage:encrypt', (_event, plainText) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is not available on this platform.');
  }
  return safeStorage.encryptString(String(plainText || '')).toString('base64');
});

ipcMain.handle('safeStorage:decrypt', (_event, base64Cipher) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is not available on this platform.');
  }
  return safeStorage.decryptString(Buffer.from(String(base64Cipher || ''), 'base64'));
});

ipcMain.handle('app:getLoginItem', () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('app:setLoginItem', (_event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
  return app.getLoginItemSettings().openAtLogin;
});

// App Lifecycle
app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
});
