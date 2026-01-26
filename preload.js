const { contextBridge, ipcRenderer } = require('electron/renderer');

contextBridge.exposeInMainWorld('electronAPI', {
    // From Svelte to Electron
    openApp: () => ipcRenderer.send('open-app'),
    statusChanged: (status) => ipcRenderer.send('status-changed', status),
    setUser: (user) => ipcRenderer.send('set-user', user),
    readyToClose: () => ipcRenderer.send('ready-to-close'),

    // From Electron to Svelte
    startCallFromLink: (callback) => ipcRenderer.on('start-call-from-link', (_event, value) => callback(value)),
    logout: (callback) => ipcRenderer.on('logout', (_event) => callback()),
    answerCallHotkeyPressed: (callback) => ipcRenderer.on('answer-call-hotkey-pressed', (_event) => callback()),
    hangupCallHotkeyPressed: (callback) => ipcRenderer.on('hangup-call-hotkey-pressed', (_event) => callback()),
    muteCallHotkeyPressed: (callback) => ipcRenderer.on('mute-call-hotkey-pressed', (_event) => callback()),
    logToServer: (callback) => ipcRenderer.on('log-to-server', (_event, value) => callback(value)),
    changeStatus: (callback) => ipcRenderer.on('change-status', (_event, value) => callback(value)),

    // Network Monitoring APIs
    // On-demand network quality check (returns Promise with results)
    checkNetworkQuality: (options) => ipcRenderer.invoke('check-network-quality', options),
    
    // Get current network interface info (returns Promise)
    getNetworkInfo: () => ipcRenderer.invoke('get-network-info'),
    
    // Start periodic network monitoring (results sent via onNetworkQualityUpdate)
    startNetworkMonitor: (options) => ipcRenderer.send('start-network-monitor', options),
    
    // Stop periodic network monitoring
    stopNetworkMonitor: () => ipcRenderer.send('stop-network-monitor'),
    
    // Callback for periodic network quality updates
    onNetworkQualityUpdate: (callback) => ipcRenderer.on('network-quality-update', (_event, value) => callback(value)),

    // Get best Crexendo endpoint for SIP connection (returns Promise)
    getBestEndpoint: () => ipcRenderer.invoke('get-best-endpoint'),
    
    // Callback for when best endpoint is discovered on startup
    onBestEndpointDiscovered: (callback) => ipcRenderer.on('best-endpoint-discovered', (_event, value) => callback(value)),

    // Speed test (on-demand, returns Promise)
    runSpeedTest: () => ipcRenderer.invoke('run-speed-test'),
    
    // Callback for speed test updates
    onSpeedTestUpdate: (callback) => ipcRenderer.on('speed-test-update', (_event, value) => callback(value)),

    // Metrics callback - for time-series data to send to DataDog as metrics
    onMetrics: (callback) => ipcRenderer.on('metrics', (_event, value) => callback(value)),
});
