const { contextBridge, ipcRenderer } = require('electron/renderer');
const { WSS_CERT_BRIDGE_VERSION } = require('./wssCertBridge');

contextBridge.exposeInMainWorld('electronAPI', {
    // From Svelte to Electron
    openApp: () => ipcRenderer.send('open-app'),
    statusChanged: (status) => ipcRenderer.send('status-changed', status),
    setUser: (user) => ipcRenderer.send('set-user', user),
    readyToClose: () => ipcRenderer.send('ready-to-close'),
    restartApp: () => ipcRenderer.send('restart-app'),

    // From Electron to Svelte
    startCallFromLink: (callback) => ipcRenderer.on('start-call-from-link', (_event, value) => callback(value)),
    logout: (callback) => ipcRenderer.on('logout', (_event) => callback()),
    answerCallHotkeyPressed: (callback) => ipcRenderer.on('answer-call-hotkey-pressed', (_event) => callback()),
    hangupCallHotkeyPressed: (callback) => ipcRenderer.on('hangup-call-hotkey-pressed', (_event) => callback()),
    muteCallHotkeyPressed: (callback) => ipcRenderer.on('mute-call-hotkey-pressed', (_event) => callback()),
    logToServer: (callback) => ipcRenderer.on('log-to-server', (_event, value) => callback(value)),
    changeStatus: (callback) => ipcRenderer.on('change-status', (_event, value) => callback(value)),

    // Network & Metrics
    getBestEndpoint: () => ipcRenderer.invoke('get-best-endpoint'),
    onMetrics: (callback) => ipcRenderer.on('metrics', (_event, value) => callback(value)),

    setCallInProgress: (inProgress) => ipcRenderer.send('set-call-in-progress', inProgress),

    // Force-v4 WSS bridge for the ICE probe. The renderer (wsEndpoint.ts)
    // reads wssCertBridgeVersion to confirm the cert verifier is installed,
    // then calls registerWssV4({ ip, hostname }) before opening a WSS to
    // wss://<ip>:9002/. See wssCertBridge.js.
    wssCertBridgeVersion: WSS_CERT_BRIDGE_VERSION,
    registerWssV4: (entry) => ipcRenderer.invoke('register-wss-v4', entry),
});
