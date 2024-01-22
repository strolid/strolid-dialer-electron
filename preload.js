const { contextBridge, ipcRenderer } = require('electron/renderer')

contextBridge.exposeInMainWorld('electronAPI', {
    openApp: () => ipcRenderer.send('open-app'),
    briaStatusChanged: (status) => ipcRenderer.send('bria-status-changed', status),
    setUser: (user) => ipcRenderer.send('set-user', user),
    startCallFromLink: (callback) => ipcRenderer.on('start-call-from-link', (_event, value) => callback(value))
});
