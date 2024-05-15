const { contextBridge, ipcRenderer } = require('electron/renderer');

contextBridge.exposeInMainWorld('electronAPI', {
    // From Svelte to Electron
    openApp: () => ipcRenderer.send('open-app'),
    briaStatusChanged: (status) => ipcRenderer.send('bria-status-changed', status),
    setUser: (user) => ipcRenderer.send('set-user', user),
    // triggerUpload: (filename) => ipcRenderer.send('trigger-upload', filename),
    // From Electron to Svelte
    startCallFromLink: (callback) => ipcRenderer.on('start-call-from-link', (_event, value) => callback(value)),
    // recordingUploaded: (callback) => ipcRenderer.on('recording-uploaded', (_event, value) => callback(value)),
    logout: (callback) => ipcRenderer.on('logout', (_event) => callback()),
    getConfig: () => ipcRenderer.invoke('get-config'),
    uploadRecording: (fileName, preSignedUrl) => ipcRenderer.send('upload-recording', fileName, preSignedUrl),
});


