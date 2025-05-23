const { app, BrowserWindow, Tray, nativeImage, ipcMain, shell, dialog, Menu, MenuItem, globalShortcut } = require('electron')
const path = require('path');
const fs = require('fs');
const { startServer } = require('./httpServer');
const Store = require('electron-store');
const contextMenu = require('electron-context-menu');
const axios = require('axios');
const wavFileInfo = require('wav-file-info');

const store = new Store();
const env = process.env.ELECTRON_ENV || 'prod';

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
let idToken = null;

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

    let appUrl = 'https://strolid-dialer.strolidcxm.com/dialer'
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
        if (idToken) {
            const statusUrl = appUrl.replace('/dialer', '/api/crexendo/user/my/status');
            const response = await fetch(statusUrl, {
                method: 'POST',
                body: JSON.stringify({ status: 'unavailable' }),
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                }
            });
            if (response.ok) {
                console.log('Set status to unavailable successfully');
            } else {
                Sentry.captureException(new Error(`Failed to set status to unavailable on close of dialer app: ${response.statusText}`));
                console.error('Failed to set status to unavailable');
            }
        }
        app.quit()
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
        idToken = user.idToken;
        delete user.idToken;
        Sentry.setUser(user);

        startServer();
    })
}

app.whenReady().then(() => {
    globalShortcut.register('Control+Shift+H', () => {
        win.webContents.send('hangup-call-hotkey-pressed')
    })
    globalShortcut.register('Control+Shift+A', () => {
        win.webContents.send('answer-call-hotkey-pressed')
    })
    globalShortcut.register('Control+Shift+M', () => {
        win.webContents.send('mute-call-hotkey-pressed')
    })
}).then(createWindow)


