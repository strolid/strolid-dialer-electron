const { app, BrowserWindow, Tray, nativeImage, ipcMain, shell, dialog, Menu } = require('electron')
const path = require('path');
const fs = require('fs');
const { startServer } = require('./httpServer');
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

    const dealerId = dealerIdMatch ? dealerIdMatch[1] : null;
    const phoneNumber = phoneNumberMatch ? decodeURIComponent(phoneNumberMatch[1]) : null;

    return { dealerId, phoneNumber };
}

if (process.platform !== 'darwin') {
    console.log("========= WINDOWS / LINUX =========")
    console.log("#####################V2###################")
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
            }
            // the commandLine is array of strings in which last element is deep link url
            showWindow();
            const deepLinkUrl = commandLine.find(arg => arg.startsWith('strolid-dialer://'));
            const { dealerId, phoneNumber } = extractParameters(deepLinkUrl)
            win.webContents.send('start-call-from-link', { dealerId, phoneNumber })
        })

        // Create mainWindow, load the rest of the app, etc...
        // app.whenReady().then(() => {
        //     createWindow()
        // })
    }

} else {
    console.log("========= MAC =========")
    console.log("#####################V2###################")
    // For MAC
    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    // app.whenReady().then(() => {
    //     createWindow()
    // })

    // Handle the protocol. In this case, we choose to show an Error Box.
    app.on('open-url', (event, url) => {
        const { dealerId, phoneNumber } = extractParameters(url)
        win.webContents.send('start-call-from-link', { dealerId, phoneNumber })
        showWindow();
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
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: true

    })
    // ENABLE THIS TO OPEN DEV TOOLS ON START

    // Set window title with version
    const packageJsonPath = path.join(__dirname, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const appVersion = packageJson.version;

    win.setTitle(`Strolid Dialer v${appVersion} - ${env}`)


    if (env != 'prod') {
        win.webContents.openDevTools();
        win.loadURL('http://localhost:3005/dialer')
    } else {
        win.loadURL('https://strolid-dialer.strolidcxm.com/dialer')
    }


    win.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url); // Open URL in user's browser.
        return { action: "deny" }; // Prevent the app from opening the URL.
    })

    win.on('close', function (e) {

        const iconPath = path.join(__dirname, 'icons/exit_image.jpeg');
        let response = dialog.showMessageBoxSync(win, {
            type: 'question',
            buttons: ['Yes', 'No'],
            title: 'Confirm',
            icon: iconPath,
            message: 'Please remember to log out of the queue (*45) in Bria before you quit.\n\nAre you sure you want to quit?'
        });

        if (response == 1) {
            e.preventDefault()
        }


    });

    const iconPath = path.join(__dirname, 'icons/tray-icon-red.png');
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
    ipcMain.on('bria-status-changed', (event, status) => {
        console.log(`BRIA status changed to ${status}`);
        let iconFile = "";
        if (status === 'connected') {
            iconFile = path.join(__dirname, 'icons/tray-icon-blue.png');
        } else {
            iconFile = path.join(__dirname, 'icons/tray-icon-red.png');
        }

        let icon = nativeImage.createFromPath(iconFile);
        icon = icon.resize({
            height: 16,
            width: 16
        });
        tray.setImage(icon);
    })

    ipcMain.on('set-user', (event, user) => {
        win.setTitle(`${env != 'prod' ? env + " - " : ""}Strolid Dialer v${appVersion} - ${user.name} (${user.extension})`)
        Sentry.setUser(user);
        startServer();
    })
}

app.whenReady().then(() => {
    createWindow()
})


