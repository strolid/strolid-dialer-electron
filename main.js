const { app, BrowserWindow, Tray, nativeImage, ipcMain, shell, dialog, Menu, MenuItem, globalShortcut } = require('electron')
const path = require('path');
const fs = require('fs');
const dns = require('dns').promises;
const os = require('os');
const tcpPing = require('tcp-ping');
const { startServer } = require('./httpServer');
const Store = require('electron-store');
const contextMenu = require('electron-context-menu');

const store = new Store();
const env = process.env.ELECTRON_ENV || 'prod';

// Network monitoring configuration
let networkMonitorInterval = null;
let speedTestInterval = null;
let isSpeedTestRunning = false; // Flag to prevent latency checks during speed test
const DEFAULT_MONITOR_INTERVAL_MS = 30000; // 30 seconds
const SPEED_TEST_INTERVAL_MS = 300000; // 5 minutes
const DISCOVERY_INTERVAL_MS = 3600000; // Re-discover best endpoint every hour
const MAX_ACCEPTABLE_PACKET_LOSS = 50; // Endpoints with >50% packet loss are considered "down"

// Crexendo SIP WebSocket endpoints for latency testing
const CREXENDO_ENDPOINTS = [
    { host: 'usw.crexendovip.com', port: 9002, region: 'US West', location: 'Phoenix' },
    { host: 'usw2.crexendovip.com', port: 9002, region: 'US West 2', location: 'Phoenix' },
    { host: 'usc.crexendovip.com', port: 9002, region: 'US Central', location: 'Chicago' },
    { host: 'usc2.crexendovip.com', port: 9002, region: 'US Central 2', location: 'Chicago' },
    { host: 'use.crexendovip.com', port: 9002, region: 'US East', location: 'Washington DC' },
    { host: 'use2.crexendovip.com', port: 9002, region: 'US East 2', location: 'Washington DC' },
];

// Best endpoint discovered for this user (cached after initial discovery)
let bestEndpoint = null;
let lastDiscoveryTime = null;

// Sentry Integration
const Sentry = require('@sentry/electron');
if (env === 'prod') {
    Sentry.init({
        dsn: "https://0a8a5d577a01a0e5416ba64f82258edb@o293567.ingest.sentry.io/4506631877689344",
        environment: env
    });
}

let tray = null;
let win = null;
let appUrl = "";

contextMenu({
    showLearnSpelling: false,
    showLookUpSelection: false,
    showServices: false,
    showInspectElement: false,
});

if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('strolid-dialer', process.execPath, [path.resolve(process.argv[1])])
    }
} else {
    app.setAsDefaultProtocolClient('strolid-dialer')
}

function extractParameters(url) {
    const dealerIdMatch = /dealerId=([^&]+)/.exec(url);
    const phoneNumberMatch = /phoneNumber=([^&]+)/.exec(url);
    const makeCallMatch = /makeCall=([^&]+)/.exec(url);

    const dealerId = dealerIdMatch ? dealerIdMatch[1] : null;
    const phoneNumber = phoneNumberMatch ? decodeURIComponent(phoneNumberMatch[1]) : null;
    const makeCallStr = makeCallMatch ? makeCallMatch[1] : 'false';

    const makeCall = makeCallStr === 'true';

    console.log("deep link url:", url);

    return { dealerId, phoneNumber, makeCall };
}

if (process.platform !== 'darwin') {
    console.log("========= WINDOWS / LINUX =========")
    // For Windows and Linux
    const gotTheLock = app.requestSingleInstanceLock()

    if (!gotTheLock) {
        app.quit()
    } else {
        app.on('second-instance', (event, commandLine, workingDirectory) => {
            // Someone tried to run a second instance, we should focus our window.
            if (win) {
                if (win.isMinimized()) win.restore()
                win.focus()
                // the commandLine is array of strings in which last element is deep link url
                showWindow();
                const deepLinkUrl = commandLine.find(arg => arg.startsWith('strolid-dialer://'));
                console.log("deep link url (windows):", deepLinkUrl);
                const { dealerId, phoneNumber, makeCall } = extractParameters(deepLinkUrl)
                if (!dealerId || !phoneNumber) {
                    console.error("No dealerId or phoneNumber found in deep link")
                }
                win.webContents.send('start-call-from-link', { dealerId, phoneNumber, makeCall })
            }
        })
    }

} else {
    console.log("========= MAC =========")

    app.on('open-url', (event, url) => {
        showWindow();
        console.log("deep link url (mac):", url);
        const { dealerId, phoneNumber, makeCall } = extractParameters(url)
        if (!dealerId || !phoneNumber) {
            console.error("No dealerId or phoneNumber found in deep link")
        }
        win.webContents.send('start-call-from-link', { dealerId, phoneNumber, makeCall })
    })
}

function logToServer({ message, level = "info", extra = null, screenshot = undefined }) {
    win.webContents.send('log-to-server', { message, level, extra, screenshot })
}

function sendMetrics(metrics) {
    win.webContents.send('metrics', metrics)
}

function showWindow() {
    if (!win) return;
    if (win.isMinimized()) {
        win.restore();
    }
    win.setAlwaysOnTop(true);
    win.show();
    win.setAlwaysOnTop(false);
}

function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        minWidth: 932,
        height: 1000,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            sandbox: false
        },
        autoHideMenuBar: true

    })
    win.webContents.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    // ENABLE THIS TO OPEN DEV TOOLS ON START

    // Set window title with version
    const packageJsonPath = path.join(__dirname, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const appVersion = packageJson.version;

    win.setTitle(`Strolid Dialer v${appVersion} - ${env}`)

    appUrl = 'https://strolid-dialer.strolidcxm.com/dialer'
    const edgeUrl = 'https://strolid-dialer-edge.strolidcxm.com/dialer';
    if (env == 'dev') {
        appUrl = 'http://localhost:3005/dialer'
    }
    if (store.get('onEdgeVersion')) {
        win.loadURL(edgeUrl)
    } else {
        win.loadURL(appUrl)
    }

    const appMenu = Menu.getApplicationMenu();
    const viewMenu = appMenu.items.find(item => item.label === 'View');

    // Helper function to take screenshot and log with it
    async function takeScreenshotAndLog(message) {
        if (win && win.webContents) {
            try {
                const screenshot = await win.webContents.capturePage();
                const screenshotBuffer = screenshot.toPNG();
                const screenshotBase64 = screenshotBuffer.toString('base64');
                logToServer({ 
                    message: message,
                    screenshot: screenshotBase64
                });
            } catch (error) {
                console.error('Failed to capture screenshot:', error);
                logToServer({ 
                    message: message,
                    extra: { screenshotError: error.message }
                });
            }
        }
    }

    // Intercept the Reload menu item
    const reloadMenuItem = viewMenu.submenu.items.find(item => item.label === 'Reload');
    if (reloadMenuItem) {
        reloadMenuItem.click = async (menuItem, browserWindow, event) => {
            console.log('Reload menu item clicked - intercepted');
            await takeScreenshotAndLog('User clicked Reload from View menu');
            
            if (win && win.webContents) {
                win.webContents.reload();
            }
        };
    }

    // Intercept the Force Reload menu item
    const forceReloadMenuItem = viewMenu.submenu.items.find(item => item.label === 'Force Reload');
    if (forceReloadMenuItem) {
        forceReloadMenuItem.click = async (menuItem, browserWindow, event) => {
            console.log('Force Reload menu item clicked - intercepted');
            await takeScreenshotAndLog('User clicked Force Reload from View menu');
            
            if (win && win.webContents) {
                win.webContents.reloadIgnoringCache();
            }
        };
    }

    let switchedToEdge = !!store.get('onEdgeVersion');
    const switchToEdge = new MenuItem({
        label: 'Switch to Edge',
        // accelerator: 'CmdOrCtrl+E',
        checked: switchedToEdge,
        type: 'checkbox',
        click: async () => {
            const checked = switchToEdge.checked;
            if (checked) {
                // load https://google.com
                console.log(`switching to ${edgeUrl}`)
                const title = win.getTitle();
                win.setTitle(`Redirecting to Edge...`)
                await win.loadURL(edgeUrl);
                win.setTitle(title + ' (Edge)');
                switchedToEdge = true;
                console.log(`switched to Edge successfully`)
                store.set('onEdgeVersion', true);
            } else {
                console.log(`switching to ${appUrl}`)
                const title = win.getTitle();
                win.setTitle(`Redirecting to Production...`)
                await win.loadURL(appUrl);
                win.setTitle(title.replace(' (Edge)', ''));
                switchedToEdge = false;
                console.log(`switched to Prod/dev successfully`)
                store.set('onEdgeVersion', false);
            }
        }
    })

    viewMenu.submenu.append(switchToEdge);

    Menu.setApplicationMenu(appMenu);


    win.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url); // Open URL in user's browser.
        return { action: "deny" }; // Prevent the app from opening the URL.
    })

    let isClosing = false;
    win.on('close', async function (e) {
        if (isClosing) return;
        e.preventDefault()
        const iconPath = path.join(__dirname, 'icons/exit_image.jpeg');

        // Send a request to the sveltekit app to log that the user is closing the dialer
        
        let response = dialog.showMessageBoxSync(win, {
            type: 'question',
            buttons: ['Yes', 'No'],
            title: 'Confirm',
            icon: iconPath,
            message: 'Are you sure you want to close the dialer?'
        });
        
        if (response == 1) {
            return;
        }
        isClosing = true;
        win.webContents.send('change-status', 'unavailable');
        // logToServer({ message: 'User closed the dialer app' });
        // app.quit()
    });

    const iconPath = path.join(__dirname, 'icons/tray-icon-unavailable.png');
    let icon = nativeImage.createFromPath(iconPath);
    icon = icon.resize({
        height: 16,
        width: 16
    });
    tray = new Tray(icon);
    tray.setToolTip('Strolid Dialer')
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Quit', type: 'normal', click: app.quit },
        { label: 'Log Out', type: 'normal', click: () => win.webContents.send('logout') }
    ])
    tray.setContextMenu(contextMenu)
    // Bring app to front when tray icon is clicked
    tray.addListener("click", () => {
        showWindow();
    });
    tray.addListener("right-click", () => {
        tray.popUpContextMenu()
    });

    // Maximize app when incoming call is detected
    ipcMain.on('open-app', () => {
        showWindow();
    })
    ipcMain.on('destroy-window-delayed', () => {
        setTimeout(() => { win.destroy() }, 10000)
    })

    ipcMain.on('ready-to-close', () => {
        logToServer({ message: 'User closed the dialer app' });
        app.quit()
    })

    // ===== Network Monitoring =====
    
    // Helper function to ping a single endpoint
    function pingEndpoint(host, port, attempts = 5) {
        return new Promise((resolve) => {
            tcpPing.ping({ address: host, port, attempts }, (err, data) => {
                if (err) {
                    resolve({ 
                        success: false, 
                        error: err.message,
                        host,
                        port,
                        timestamp: Date.now() 
                    });
                } else {
                    const results = data.results.filter(r => r.time !== undefined);
                    const times = results.map(r => r.time);
                    const packetLoss = ((attempts - results.length) / attempts) * 100;
                    
                    // If all pings failed (100% packet loss), mark as unsuccessful
                    if (results.length === 0) {
                        resolve({
                            success: false,
                            error: 'All ping attempts timed out',
                            host,
                            port,
                            packetLoss,
                            attempts,
                            successful: 0,
                            timestamp: Date.now()
                        });
                        return;
                    }
                    
                    // Calculate jitter (standard deviation of latency)
                    let jitter = 0;
                    if (times.length > 1) {
                        const mean = times.reduce((a, b) => a + b, 0) / times.length;
                        const squaredDiffs = times.map(t => Math.pow(t - mean, 2));
                        jitter = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / times.length);
                    }
                    
                    resolve({
                        success: true,
                        host,
                        port,
                        latency: {
                            // Use != null to properly handle 0 values (0 is falsy but valid)
                            avg: data.avg != null ? Math.round(data.avg * 100) / 100 : null,
                            min: data.min != null ? Math.round(data.min * 100) / 100 : null,
                            max: data.max != null ? Math.round(data.max * 100) / 100 : null,
                        },
                        jitter: Math.round(jitter * 100) / 100,
                        packetLoss,
                        attempts,
                        successful: results.length,
                        timestamp: Date.now()
                    });
                }
            });
        });
    }

    // Check network quality - runs discovery and returns best endpoint only
    ipcMain.handle('check-network-quality', async (event, options = {}) => {
        const { host, port, attempts = 5 } = options;
        
        // If specific host provided, test just that one
        if (host && port) {
            return pingEndpoint(host, port, attempts);
        }
        
        // Otherwise run discovery and return best endpoint data only
        const { bestEndpoint: best } = await runEndpointDiscovery();
        
        if (best) {
            return {
                success: true,
                host: best.host,
                port: best.port,
                region: best.region,
                location: best.location,
                latency: best.latency,
                jitter: best.jitter,
                packetLoss: best.packetLoss,
                timestamp: Date.now()
            };
        } else {
            return {
                success: false,
                error: 'No reachable endpoints',
                timestamp: Date.now()
            };
        }
    });

    // Get basic network information
    ipcMain.handle('get-network-info', async () => {
        const interfaces = os.networkInterfaces();
        const activeInterfaces = [];
        
        for (const [name, nets] of Object.entries(interfaces)) {
            for (const net of nets) {
                // Skip internal/loopback interfaces
                if (!net.internal && net.family === 'IPv4') {
                    activeInterfaces.push({
                        name,
                        address: net.address,
                        mac: net.mac,
                    });
                }
            }
        }
        
        // Quick DNS check to verify internet connectivity
        let dnsReachable = false;
        let dnsLatency = null;
        try {
            const start = Date.now();
            await dns.lookup('strolid-dialer.strolidcxm.com');
            dnsLatency = Date.now() - start;
            dnsReachable = true;
        } catch (e) {
            dnsReachable = false;
        }
        
        return {
            interfaces: activeInterfaces,
            dnsReachable,
            dnsLatency,
            timestamp: Date.now()
        };
    });

    // Start periodic network monitoring
    ipcMain.on('start-network-monitor', async (event, options = {}) => {
        const { intervalMs = DEFAULT_MONITOR_INTERVAL_MS } = options;
        
        // Clear any existing monitor
        if (networkMonitorInterval) {
            clearInterval(networkMonitorInterval);
        }
        
        // Run initial discovery to find the best endpoint
        console.log(`[Discovery] Testing ${CREXENDO_ENDPOINTS.length} Crexendo endpoints to find the best one...`);
        await runEndpointDiscovery();
        
        if (bestEndpoint) {
            console.log(`[Monitor] Starting periodic monitoring of ${bestEndpoint.region} (${bestEndpoint.host}) every ${intervalMs}ms`);
            console.log(`[Monitor] Will re-discover best endpoint every ${DISCOVERY_INTERVAL_MS / 60000} minutes`);
            
            // Send best endpoint to renderer for SIP connection
            win.webContents.send('best-endpoint-discovered', bestEndpoint.host);
            
            // Start periodic monitoring of the best endpoint
            networkMonitorInterval = setInterval(() => runNetworkCheck(), intervalMs);
        } else {
            console.log('[Monitor] Warning: No endpoints reachable, will retry discovery on next interval');
            win.webContents.send('best-endpoint-discovered', null);
            networkMonitorInterval = setInterval(() => runNetworkCheck(), intervalMs);
        }
    });

    // Stop periodic network monitoring
    ipcMain.on('stop-network-monitor', () => {
        if (networkMonitorInterval) {
            clearInterval(networkMonitorInterval);
            networkMonitorInterval = null;
            console.log('Network monitor stopped');
        }
    });

    // Get the current best endpoint (for renderer to request on demand)
    ipcMain.handle('get-best-endpoint', async () => {
        // If no best endpoint yet, run discovery
        if (!bestEndpoint) {
            await runEndpointDiscovery();
        }
        
        return bestEndpoint ? bestEndpoint.host : null;
    });

    // Helper function to detect connection type from interface name
    function getConnectionType() {
        const interfaces = os.networkInterfaces();
        const types = [];
        
        for (const [name, nets] of Object.entries(interfaces)) {
            for (const net of nets) {
                if (!net.internal && net.family === 'IPv4') {
                    const nameLower = name.toLowerCase();
                    // Common interface naming patterns
                    if (nameLower.includes('wi-fi') || nameLower.includes('wifi') || 
                        nameLower.includes('wlan') || nameLower.includes('airport') ||
                        nameLower.startsWith('en0')) {
                        types.push({ name, type: 'wifi', address: net.address });
                    } else if (nameLower.includes('ethernet') || nameLower.includes('eth') ||
                               nameLower.startsWith('en1') || nameLower.startsWith('en2')) {
                        types.push({ name, type: 'ethernet', address: net.address });
                    } else if (nameLower.includes('thunderbolt')) {
                        types.push({ name, type: 'thunderbolt', address: net.address });
                    } else if (nameLower.includes('usb')) {
                        types.push({ name, type: 'usb', address: net.address });
                    } else {
                        types.push({ name, type: 'unknown', address: net.address });
                    }
                }
            }
        }
        
        // Return primary connection type (prefer ethernet over wifi)
        const ethernet = types.find(t => t.type === 'ethernet' || t.type === 'thunderbolt');
        if (ethernet) return { primary: 'ethernet', interfaces: types };
        
        const wifi = types.find(t => t.type === 'wifi');
        if (wifi) return { primary: 'wifi', interfaces: types };
        
        return { primary: types[0]?.type || 'unknown', interfaces: types };
    }

    // Helper function to get system resource usage
    function getSystemResources() {
        const cpus = os.cpus();
        
        // Calculate CPU usage (average across all cores)
        let totalIdle = 0;
        let totalTick = 0;
        for (const cpu of cpus) {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        }
        const cpuUsage = Math.round((1 - totalIdle / totalTick) * 100);
        
        // Memory usage
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memoryUsage = Math.round((usedMem / totalMem) * 100);
        
        return {
            cpu: {
                usage: cpuUsage,
                cores: cpus.length
            },
            memory: {
                usage: memoryUsage,
                total: Math.round(totalMem / (1024 * 1024 * 1024) * 100) / 100, // GB
                free: Math.round(freeMem / (1024 * 1024 * 1024) * 100) / 100,   // GB
                used: Math.round(usedMem / (1024 * 1024 * 1024) * 100) / 100    // GB
            }
        };
    }

    // Discovery function: tests all endpoints and finds the best one
    async function runEndpointDiscovery() {
        console.log('[Discovery] Warming up connections to all endpoints...');
        
        // Warmup phase: single ping to each endpoint to prime DNS and connection caches
        // Run in parallel since we don't care about these measurements
        await Promise.all(
            CREXENDO_ENDPOINTS.map(endpoint => pingEndpoint(endpoint.host, endpoint.port, 1))
        );
        
        console.log('[Discovery] Measuring latency to all Crexendo endpoints...');
        
        // Test all Crexendo endpoints sequentially for accurate measurements
        const endpointResults = [];
        for (const endpoint of CREXENDO_ENDPOINTS) {
            const result = await pingEndpoint(endpoint.host, endpoint.port, 5);
            const endpointResult = {
                ...result,
                region: endpoint.region,
                location: endpoint.location
            };
            endpointResults.push(endpointResult);
            
            // Log each result as we go
            if (endpointResult.success) {
                console.log(`[Discovery] ${endpointResult.region} (${endpointResult.host}): ${endpointResult.latency.avg}ms avg, ${endpointResult.jitter}ms jitter, ${endpointResult.packetLoss}% loss`);
            } else {
                console.log(`[Discovery] ${endpointResult.region} (${endpointResult.host}): FAILED - ${endpointResult.error}`);
            }
        }
        
        // Find the best (lowest latency) successful endpoint
        // Filter out endpoints that are "down":
        // - success must be true
        // - latency.avg must be a valid number (not null, undefined, or NaN)
        // - packet loss must be acceptable (not above threshold)
        const successfulResults = endpointResults.filter(r => {
            // Must have success flag
            if (!r.success) {
                return false;
            }
            
            // Latency must be a valid finite number
            if (r.latency?.avg == null || !Number.isFinite(r.latency.avg)) {
                console.log(`[Discovery] Excluding ${r.region} (${r.host}): invalid latency value`);
                return false;
            }
            
            // Packet loss must be acceptable
            if (r.packetLoss > MAX_ACCEPTABLE_PACKET_LOSS) {
                console.log(`[Discovery] Excluding ${r.region} (${r.host}): high packet loss (${r.packetLoss}%)`);
                return false;
            }
            
            return true;
        });
        
        if (successfulResults.length > 0) {
            bestEndpoint = successfulResults.reduce((best, current) => 
                current.latency.avg < best.latency.avg ? current : best
            );
            lastDiscoveryTime = Date.now();
            console.log(`[Discovery] Best endpoint: ${bestEndpoint.region} (${bestEndpoint.host}) at ${bestEndpoint.latency.avg}ms (${bestEndpoint.packetLoss}% packet loss)`);
        } else {
            console.log('[Discovery] Warning: No endpoints were reachable or all had unacceptable packet loss');
            bestEndpoint = null;
        }
        
        return { endpoints: endpointResults, bestEndpoint };
    }

    // Helper function to run network check - monitors best endpoint only
    async function runNetworkCheck() {
        // Skip latency check if speed test is running to avoid interference
        if (isSpeedTestRunning) {
            console.log('[Monitor] Skipping latency check - speed test in progress');
            return null;
        }
        
        const connectionType = getConnectionType();
        const systemResources = getSystemResources();
        
        // Check if we need to re-run discovery (every hour or if no best endpoint)
        const needsDiscovery = !bestEndpoint || 
            !lastDiscoveryTime || 
            (Date.now() - lastDiscoveryTime > DISCOVERY_INTERVAL_MS);
        
        if (needsDiscovery) {
            console.log('[Monitor] Re-running endpoint discovery...');
            await runEndpointDiscovery();
        }
        
        // If still no best endpoint after discovery, report failure
        if (!bestEndpoint) {
            const result = {
                success: false,
                error: 'No reachable endpoints',
                connectionType: connectionType.primary,
                interfaces: connectionType.interfaces,
                system: systemResources,
                timestamp: Date.now()
            };
            sendMetrics({ type: 'network_quality', ...result });
            win.webContents.send('network-quality-update', result);
            return result;
        }
        
        // Monitor only the best endpoint
        const pingResult = await pingEndpoint(bestEndpoint.host, bestEndpoint.port, 5);
        
        console.log(`[Monitor] ${bestEndpoint.region} (${bestEndpoint.host}): ${pingResult.latency?.avg ?? 'FAILED'}ms avg, ${pingResult.jitter ?? '-'}ms jitter, ${pingResult.packetLoss ?? '-'}% loss`);
        
        const result = {
            success: pingResult.success,
            host: bestEndpoint.host,
            port: bestEndpoint.port,
            region: bestEndpoint.region,
            location: bestEndpoint.location,
            latency: pingResult.latency,
            jitter: pingResult.jitter,
            packetLoss: pingResult.packetLoss,
            connectionType: connectionType.primary,
            interfaces: connectionType.interfaces,
            system: systemResources,
            timestamp: Date.now()
        };
        
        // Send metrics
        sendMetrics({ type: 'network_quality', ...result });
        win.webContents.send('network-quality-update', result);
        
        return result;
    }

    // Speed test function using HTTP download from public CDN
    // Uses parallel connections to match browser-based speed tests (like fast.com)
    async function runSpeedTest() {
        const https = require('https');
        
        // Set flag to prevent latency checks during speed test
        isSpeedTestRunning = true;
        
        // Use 4 parallel connections of 5MB each (20MB total) - similar to fast.com approach
        const PARALLEL_CONNECTIONS = 4;
        const BYTES_PER_CONNECTION = 5000000; // 5MB each
        const TOTAL_EXPECTED_BYTES = PARALLEL_CONNECTIONS * BYTES_PER_CONNECTION;
        const MIN_VALID_BYTES = TOTAL_EXPECTED_BYTES * 0.5; // At least 50% of expected data
        
        console.log(`[SpeedTest] Starting with ${PARALLEL_CONNECTIONS} parallel connections...`);
        
        try {
            const result = await new Promise((resolve, reject) => {
                let firstChunkTime = null;
                let lastChunkTime = null;
                let totalBytes = 0;
                let completedConnections = 0;
                let hasError = false;
                const requests = [];
                
                // Start all connections in parallel
                for (let i = 0; i < PARALLEL_CONNECTIONS; i++) {
                    const testUrl = `https://speed.cloudflare.com/__down?bytes=${BYTES_PER_CONNECTION}&_=${Date.now()}_${i}`;
                    
                    const req = https.get(testUrl, { timeout: 30000 }, (res) => {
                        // Check for valid HTTP status
                        if (res.statusCode !== 200) {
                            if (!hasError) {
                                hasError = true;
                                requests.forEach(r => r.destroy());
                                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                            }
                            return;
                        }
                        
                        res.on('data', (chunk) => {
                            if (hasError) return;
                            
                            const now = Date.now();
                            totalBytes += chunk.length;
                            lastChunkTime = now;
                            
                            // Start timer on first chunk from any connection
                            if (firstChunkTime === null) {
                                firstChunkTime = now;
                                console.log('[SpeedTest] First chunk received, measuring...');
                            }
                        });
                        
                        res.on('end', () => {
                            if (hasError) return;
                            
                            completedConnections++;
                            
                            // When all connections complete, calculate result
                            if (completedConnections === PARALLEL_CONNECTIONS) {
                                const elapsed = lastChunkTime - firstChunkTime;
                                
                                // Validate we received enough data
                                if (totalBytes < MIN_VALID_BYTES) {
                                    reject(new Error(`Incomplete download: only ${totalBytes} bytes received (expected ~${TOTAL_EXPECTED_BYTES})`));
                                    return;
                                }
                                
                                // Guard against division by zero
                                if (elapsed <= 0) {
                                    reject(new Error('Invalid measurement: elapsed time is zero'));
                                    return;
                                }
                                
                                const speedMbps = (totalBytes * 8) / (elapsed / 1000) / 1000000;
                                console.log(`[SpeedTest] Downloaded ${(totalBytes / 1000000).toFixed(1)}MB in ${elapsed}ms using ${PARALLEL_CONNECTIONS} connections`);
                                
                                resolve({
                                    bytes: totalBytes,
                                    elapsed,
                                    speedMbps: Math.round(speedMbps * 100) / 100,
                                    connections: PARALLEL_CONNECTIONS
                                });
                            }
                        });
                        
                        res.on('error', (err) => {
                            if (!hasError) {
                                hasError = true;
                                requests.forEach(r => r.destroy());
                                reject(err);
                            }
                        });
                    });
                    
                    req.on('error', (err) => {
                        if (!hasError) {
                            hasError = true;
                            requests.forEach(r => r.destroy());
                            reject(err);
                        }
                    });
                    
                    req.on('timeout', () => {
                        if (!hasError) {
                            hasError = true;
                            requests.forEach(r => r.destroy());
                            reject(new Error('Request timeout'));
                        }
                    });
                    
                    requests.push(req);
                }
            });
            
            const speedResult = {
                success: true,
                download: {
                    speedMbps: result.speedMbps,
                    totalBytes: result.bytes,
                    elapsed: result.elapsed,
                    connections: result.connections
                },
                testServer: 'speed.cloudflare.com',
                timestamp: Date.now()
            };
            
            sendMetrics({ type: 'speed_test', ...speedResult });
            win.webContents.send('speed-test-update', speedResult);
            console.log(`Speed test complete: ${speedResult.download.speedMbps} Mbps download (${PARALLEL_CONNECTIONS} connections)`);
            
            isSpeedTestRunning = false;
            return speedResult;
        } catch (error) {
            const errorResult = {
                success: false,
                error: error.message,
                timestamp: Date.now()
            };
            
            sendMetrics({ type: 'speed_test', ...errorResult });
            win.webContents.send('speed-test-update', errorResult);
            console.error('Speed test failed:', error.message);
            
            isSpeedTestRunning = false;
            return errorResult;
        }
    }

    // IPC handler for on-demand speed test
    ipcMain.handle('run-speed-test', async () => {
        return await runSpeedTest();
    });

    // Change tray icon when bria connects
    ipcMain.on('status-changed', (event, status) => {
        let iconFile = "";
        if (status === 'available') {
            iconFile = path.join(__dirname, 'icons/tray-icon-available.png');
        } else if (status === 'unavailable') {
            iconFile = path.join(__dirname, 'icons/tray-icon-unavailable.png');
        } else if (status === 'break') {
            iconFile = path.join(__dirname, 'icons/tray-icon-break.png');
        } else if (status === 'transfers_only') {
            iconFile = path.join(__dirname, 'icons/tray-icon-transfers_only.png');
        } else if (status === 'lunch') {
            iconFile = path.join(__dirname, 'icons/tray-icon-lunch.png');
        }

        let icon = nativeImage.createFromPath(iconFile);
        icon = icon.resize({
            height: 16,
            width: 16
        });
        tray.setImage(icon);
    })

    ipcMain.on('set-user', (event, user) => {
        win.setTitle(`${env !== 'prod' ? env + " - " : ""}Strolid Dialer v${appVersion} - ${user.name} (${user.extension}) ${switchedToEdge ? " (Edge)" : ""}`)
        Sentry.setUser(user);

        startServer();

        logToServer({ message: `User logged into dialer`, extra: { appVersion } });
    })

    // Log system information at startup
    async function getSystemInfo() {
        const checkDiskSpace = require('check-disk-space').default;
        const platform = os.platform(); // 'darwin', 'win32', 'linux'
        const platformNames = {
            darwin: 'macOS',
            win32: 'Windows',
            linux: 'Linux'
        };
        
        const cpus = os.cpus();
        const cpuModel = cpus[0]?.model || 'Unknown';
        const cpuSpeed = cpus[0]?.speed || 0; // MHz
        
        // Get disk space for root drive
        let disk = { total: null, free: null, used: null };
        try {
            const diskPath = platform === 'win32' ? 'C:/' : '/';
            const diskInfo = await checkDiskSpace(diskPath);
            disk = {
                total: Math.round(diskInfo.size / (1024 * 1024 * 1024)),           // GB
                free: Math.round(diskInfo.free / (1024 * 1024 * 1024)),            // GB
                used: Math.round((diskInfo.size - diskInfo.free) / (1024 * 1024 * 1024))   // GB
            };
        } catch (e) {
            console.error('Failed to get disk space:', e.message);
        }
        
        return {
            platform: platformNames[platform] || platform,
            osVersion: os.release(),
            osArch: os.arch(),                    // 'x64', 'arm64', etc.
            cpu: {
                model: cpuModel.trim(),
                speed: cpuSpeed,
                cores: cpus.length
            },
            memory: {
                total: Math.round(os.totalmem() / (1024 * 1024 * 1024) * 100) / 100,  // GB
            },
            disk,
            app: {
                version: appVersion,
                env: env
            },
            systemUptime: Math.round(os.uptime() / 3600 * 100) / 100,  // hours
            timestamp: Date.now()
        };
    }

    // Wait for page to load before sending system info log
    // Delay to ensure SvelteKit app has initialized its listeners
    win.webContents.on('did-finish-load', () => {
        setTimeout(async () => {
            const systemInfo = await getSystemInfo();
            console.log('System info:', JSON.stringify(systemInfo, null, 2));
            logToServer({
                message: 'Dialer app started',
                level: 'info',
                extra: systemInfo
            });
        }, 10000);
    });

    // Auto-start speed test
    console.log('Starting automatic speed test (interval: 5m)');
    setTimeout(() => {
        runSpeedTest();
        speedTestInterval = setInterval(() => runSpeedTest(), SPEED_TEST_INTERVAL_MS);
    }, 10000);
}

app.whenReady().then(() => {
    globalShortcut.register('Control+Shift+H', () => {
        win.webContents.send('hangup-call-hotkey-pressed')
        logToServer({ message: 'Hangup call hotkey pressed'});
    })
    globalShortcut.register('Control+Shift+A', () => {
        win.webContents.send('answer-call-hotkey-pressed')
        logToServer({ message: 'Answer call hotkey pressed'});
    })
    globalShortcut.register('Control+Shift+M', () => {
        win.webContents.send('mute-call-hotkey-pressed')
        logToServer({ message: 'Mute call hotkey pressed'});
    })
}).then(createWindow)


app.on('browser-window-focus', function () {
    globalShortcut.register("CommandOrControl+R", () => {
        console.log("CommandOrControl+R is pressed: Shortcut Disabled");
    });
    globalShortcut.register("CommandOrControl+Shift+R", () => {
        console.log("CommandOrControl+Shift+R is pressed: Shortcut Disabled");
    });
    globalShortcut.register("F5", () => {
        console.log("F5 is pressed: Shortcut Disabled");
    });
});

app.on('browser-window-blur', function () {
    globalShortcut.unregister('CommandOrControl+R');
    globalShortcut.unregister('CommandOrControl+Shift+R');
    globalShortcut.unregister('F5');
});