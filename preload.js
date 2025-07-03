const { contextBridge, ipcRenderer } = require('electron/renderer');

contextBridge.exposeInMainWorld('electronAPI', {
    // From Svelte to Electron
    openApp: () => ipcRenderer.send('open-app'),
    statusChanged: (status) => ipcRenderer.send('status-changed', status),
    setUser: (user) => ipcRenderer.send('set-user', user),

    // From Electron to Svelte
    startCallFromLink: (callback) => ipcRenderer.on('start-call-from-link', (_event, value) => callback(value)),
    logout: (callback) => ipcRenderer.on('logout', (_event) => callback()),
    answerCallHotkeyPressed: (callback) => ipcRenderer.on('answer-call-hotkey-pressed', (_event) => callback()),
    hangupCallHotkeyPressed: (callback) => ipcRenderer.on('hangup-call-hotkey-pressed', (_event) => callback()),
    muteCallHotkeyPressed: (callback) => ipcRenderer.on('mute-call-hotkey-pressed', (_event) => callback()),
    logToServer: (callback) => ipcRenderer.on('log-to-server', (_event, value) => callback(value)),
});
