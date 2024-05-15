const { contextBridge, ipcRenderer } = require('electron/renderer');
const path = require('path');
const env = process.env.ELECTRON_ENV || 'prod';
// __dirname = path.resolve();
const recordingsDirectory = path.join(__dirname, env === 'prod' ? 'Recordings' : 'Recordings - dev') + path.sep;


contextBridge.exposeInMainWorld('electronAPI', {
    openApp: () => ipcRenderer.send('open-app'),
    briaStatusChanged: (status) => ipcRenderer.send('bria-status-changed', status),
    setUser: (user) => ipcRenderer.send('set-user', user),
    triggerUpload: (filename) => ipcRenderer.send('trigger-upload', filename),
    startCallFromLink: (callback) => ipcRenderer.on('start-call-from-link', (_event, value) => callback(value)),
    recordingUploaded: (callback) => ipcRenderer.on('recording-uploaded', (_event, value) => callback(value)),
    logout: (callback) => ipcRenderer.on('logout', (_event) => callback()),
    recordingsDirectory: recordingsDirectory,
});
