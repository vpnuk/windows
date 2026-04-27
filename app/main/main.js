const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const AppTray = require('./tray');
const { enableAutoUpdate } = require("./updater");
const ElectronStore = require('electron-store');
ElectronStore.initRenderer();

const isDev = process.env.ELECTRON_ENV === 'Dev';
exports.isDev = isDev;
const isIde = process.env.ELECTRON_IDE && true;

let window, tray;

function createWindow() {
    window = new BrowserWindow({
        width: isDev ? 1280 : 720,
        height: 960,
        icon: path.join(__dirname, '../../public/favicon.ico'),
        webPreferences: {
            webSecurity: false,
            nodeIntegration: true,
            nodeIntegrationInWorker: true
        }
    });
    window.connectionIsOk = false;
    window.webContents.on('context-menu', (_, props) => {
        const { selectionText, isEditable, x, y } = props;
        let menuList = isDev ? [
            {
                label: 'Inspect Element',
                click: () => { window.inspectElement(x, y) }
            },
            { type: 'separator' }
        ] : [];
        if (isEditable) {
            menuList = [
                ...menuList,
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'delete' },
            ];
        } else if (selectionText && selectionText.trim() !== '') {
            menuList = [...menuList, { role: 'copy' }];
        }
        menuList = [...menuList, { type: 'separator' }, { role: 'selectall' }];
        const menu = Menu.buildFromTemplate(menuList);
        menu.popup(window);
    });
    exports.window = window;

    !isDev && window.removeMenu()
    isDev && window.webContents.openDevTools();
    window.loadURL(isIde
        ? 'http://localhost:3000/'
        : 'file:///' + path.join(__dirname, '../../build/index.html'));

    window.on('close', event => {
        isDev && console.log('window-close event', window.connectionIsOk);
        if (!window.connectionIsOk) {
            event.preventDefault();
            const { closeConnection } = require('./handlers');
            closeConnection(() => { window.hide(); }).then(result => {
                isDev && console.log('closeConnection ', result);
                window.connectionIsOk = result;
                if (result) {
                    window.close();
                }
            });
        }
    });

    window.on('closed', () => {
        isDev && console.log('window-closed event');
        window = null;
    });
}

const gotTheLock = app.requestSingleInstanceLock()

if (gotTheLock) {
    isIde && app.commandLine.appendSwitch('remote-debugging-port', '9223');
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (window) {
            if (window.isMinimized()) window.restore()
            window.focus()
        }
    })

    app.on('ready', () => {
        createWindow();
        tray = new AppTray(() => window.focus());
        exports.tray = tray;
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    app.on('activate', () => {
        if (window === null) {
            createWindow();
        }
    });
}
else {
    app.quit();
}

isDev && process.on('uncaughtException', error => {
    console.log('uncaughtException', error);
});

require('./handlers');