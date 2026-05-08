const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fsSync = require('fs');
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
        width: isDev ? 1280 : 580,
        height: isDev ? 960 : 735,
        minWidth: 580,
        minHeight: 615,
        icon: path.join(__dirname, '../../app/assets/icon.ico'),
        webPreferences: {
            webSecurity: false,
            nodeIntegration: true,
            nodeIntegrationInWorker: true,
            webviewTag: true
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
            try {
                const { closeConnection } = require('./handlers');
                closeConnection(() => { window.hide(); }).then(result => {
                    isDev && console.log('closeConnection ', result);
                    window.connectionIsOk = result;
                    if (result) {
                        window.close();
                    }
                }).catch(() => {
                    window.connectionIsOk = true;
                    window.close();
                });
            } catch (e) {
                window.connectionIsOk = true;
                window.close();
            }
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
            window.show()
            window.focus()
        }
    })

    app.on('ready', () => {
        // ── Kill-switch crash recovery ────────────────────────────────────────
        // If the app was killed or crashed while the kill switch was active the
        // default route was left deleted and the user has no internet access.
        // Check the persisted state file and restore the route before doing
        // anything else, then re-enable IPv6.
        try {
            const { settingsFolder } = require('../modules/constants');
            const { addRouteSync, defaultRoute, enableAllIPv6 } = require('./utils/routing');
            const ksPath = path.join(settingsFolder, 'ks.json');
            if (fsSync.existsSync(ksPath)) {
                const ks = JSON.parse(fsSync.readFileSync(ksPath, 'utf-8'));
                if (ks.active && ks.gateway) {
                    addRouteSync(defaultRoute, ks.gateway, defaultRoute);
                    enableAllIPv6();
                }
                // Clear the active flag — we are starting fresh.
                fsSync.writeFileSync(ksPath, JSON.stringify({ active: false }), 'utf-8');
            }
        } catch { /* best-effort — file may not exist on first run */ }

        // ── WireGuard orphan cleanup ──────────────────────────────────────────
        // Clean up any WireGuard tunnel services left over from a previous
        // session (crash, force-close, etc.) before the UI loads.
        try {
            const { cleanupOrphanedTunnels } = require('./vpn/WireGuard');
            const { checkWireGuardInstalled } = require('./vpn/WireGuard');
            if (checkWireGuardInstalled()) {
                const cp   = require('child_process');
                const regResult = cp.spawnSync(
                    'cmd',
                    ['/c', 'reg', 'query', 'HKLM\\SOFTWARE\\WireGuard', '/v', 'InstallationDirectory'],
                    { shell: true }
                );
                const out   = '' + regResult.stdout;
                const match = out.match(/InstallationDirectory\s+REG_SZ\s+(.+)/);
                const wgExe = match
                    ? path.join(match[1].trim(), 'wireguard.exe')
                    : 'C:\\Program Files\\WireGuard\\wireguard.exe';
                cleanupOrphanedTunnels(wgExe);
            }
        } catch { /* best-effort */ }

        createWindow();
        tray = new AppTray(() => { window.show(); window.focus(); });
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
