import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  chooseDirectory: (opts) => ipcRenderer.invoke('dialog:chooseDirectory', opts),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  safeStorage: {
    isAvailable: () => ipcRenderer.invoke('safeStorage:isAvailable'),
    encrypt: (plain) => ipcRenderer.invoke('safeStorage:encrypt', plain),
    decrypt: (cipher) => ipcRenderer.invoke('safeStorage:decrypt', cipher),
  },
  loginItem: {
    get: () => ipcRenderer.invoke('app:getLoginItem'),
    set: (enabled) => ipcRenderer.invoke('app:setLoginItem', enabled),
  },
});
