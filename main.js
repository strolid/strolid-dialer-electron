const { app, BrowserWindow, Tray, nativeImage, ipcMain, shell, dialog, Menu } = require('electron')
const path = require('path');

let tray = null;
let win = null;

if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('strolid-dialer', process.execPath, [path.resolve(process.argv[1])])
    }
} else {
    app.setAsDefaultProtocolClient('strolid-dialer')
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
        showWindow();
    })
}

const showWindow = () => {
    if (!win) return;
    if (win.isMinimized()) {
        win.restore();
    }
    win.show();
}

const createWindow = () => {
    win = new BrowserWindow({
        width: 1200,
        height: 1000,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    })
    // ENABLE THIS TO OPEN DEV TOOLS ON START
    win.webContents.openDevTools()

    win.loadURL('http://localhost:3005/dialer')

    win.on('close', function (e) {
        let response = dialog.showMessageBoxSync(this, {
            type: 'question',
            buttons: ['Yes', 'No'],
            title: 'Confirm',
            message: 'Are you sure you want to quit?'
        });

        if (response == 1) e.preventDefault();
    });

    let icon = nativeImage.createFromPath('tray-icon-red.png');
    icon = icon.resize({
        height: 18,
        width: 18
    });
    tray = new Tray(icon);
    tray.setToolTip('Strolid Dialer')
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Logout', type: 'normal', click: () => win.webContents.send('logout') }
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
        setTimeout(()=>{win.destroy()}, 10000)
    })

    // Change tray icon when bria connects
    ipcMain.on('bria-status-changed', (event, status) => {
        console.log(`BRIA status changed to ${status}`);
        let iconPath = "";
        if (status === 'connected') {
            iconPath = 'tray-icon-blue.png';
        } else if (status === 'disconnected') {
            iconPath = 'tray-icon-red.png';
        }
        let icon = nativeImage.createFromPath(iconPath);
        icon = icon.resize({
            height: 18,
            width: 18
        });
        tray.setImage(icon);
    })
}

app.whenReady().then(() => {
    createWindow()
})