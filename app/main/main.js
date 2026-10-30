const { app, BrowserWindow, Menu, shell } = require('electron');

// Required for Windows Jump List (setUserTasks) to work.
app.setAppUserModelId('vpnuk.windows');
const path = require('path');
const fsSync = require('fs');
const AppTray = require('./tray');
const { enableAutoUpdate } = require("./updater");
const { rebuildJumpList } = require('./utils/jumplist');
const ElectronStore = require('electron-store');
ElectronStore.initRenderer();

const isDev = process.env.ELECTRON_ENV === 'Dev';
exports.isDev = isDev;
const isIde = process.env.ELECTRON_IDE && true;

const TAWK_URL  = 'https://tawk.to/chat/56bae5de496019e65d794d8f/default';
const VPNUK_URL = 'https://www.vpnuk.net';

let window, tray;
let taskbarVisible = true;

function showWindow() {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
}

function toggleTaskbar() {
    taskbarVisible = !taskbarVisible;
    window?.setSkipTaskbar(!taskbarVisible);
    tray?.setInTaskbar(taskbarVisible);
}

// ── Handle command-line args from the Windows Jump List ──────────────────────
// Jump List tasks launch a new process; second-instance event forwards the
// argv to the already-running instance, which calls this function again.
function handleJumpListArgs(argv) {
    if (argv.includes('--show')) {
        showWindow();
        return;
    }
    if (argv.includes('--live-help')) {
        shell.openExternal(TAWK_URL);
        return;
    }
    if (argv.includes('--visit-vpnuk')) {
        shell.openExternal(VPNUK_URL);
        return;
    }
    const connectArg = argv.find(a => a.startsWith('--connect-profile='));
    if (connectArg) {
        const profileId = connectArg.slice('--connect-profile='.length);
        showWindow();
        window?.webContents?.send('tray-connect', { profileId });
    }
}

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

    !isDev && window.removeMenu();
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
                }).catch(error => {
                    window.show();
                    require('electron').dialog.showErrorBox('Disconnect failed — VPNUK is still open', error.message);
                });
            } catch (e) {
                require('electron').dialog.showErrorBox('Could not safely close VPNUK', e.message);
            }
        }
    });

    window.on('closed', () => {
        isDev && console.log('window-closed event');
        window = null;
    });
}

const cleanupOnly = process.argv.includes('--cleanup-wireguard');
const gotTheLock = !cleanupOnly && app.requestSingleInstanceLock();

if (cleanupOnly) {
    // Called before NSIS removes the executable or saved profiles. The
    // uninstaller has already stopped owned tunnels. Never show a window or
    // forward this command to an ordinary running app.
    const deadline = setTimeout(() => app.exit(2), 60000);
    app.whenReady().then(() => require('./utils/wg-uninstall')())
        .then(complete => { clearTimeout(deadline); app.exit(complete ? 0 : 2); })
        .catch(() => { clearTimeout(deadline); app.exit(2); });
} else if (gotTheLock) {
    isIde && app.commandLine.appendSwitch('remote-debugging-port', '9223');

    app.on('second-instance', (event, commandLine) => {
        handleJumpListArgs(commandLine);
        showWindow();
    });

    app.on('ready', () => {
        // ── Kill-switch crash recovery ────────────────────────────────────────
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
                fsSync.writeFileSync(ksPath, JSON.stringify({ active: false }), 'utf-8');
            }
        } catch { /* best-effort */ }

        // ── WireGuard orphan cleanup ──────────────────────────────────────────
        try {
            require('./vpn/WireGuard').cleanupOrphanedTunnels();
            require('./utils/bypass-routes').cleanupBypassRoutes();
        } catch (error) {
            require('electron').dialog.showErrorBox('VPNUK cleanup needs attention', error.message);
        }

        // Handle Jump List args passed directly on first launch.
        handleJumpListArgs(process.argv);

        createWindow();

        // ── System tray ───────────────────────────────────────────────────────
        tray = new AppTray({
            onShow:          () => showWindow(),
            onConnect:       (profileId) => {
                showWindow();
                window?.webContents?.send('tray-connect', { profileId });
            },
            onDisconnect:    () => {
                const { disconnectVpn } = require('./handlers');
                disconnectVpn().catch(error => require('electron').dialog.showErrorBox('Disconnect failed', error.message));
            },
            onToggleTaskbar: () => toggleTaskbar(),
        });
        exports.tray = tray;

        // Initial empty Jump List — rebuilt when renderer sends tray-state-update.
        rebuildJumpList([]);
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

if (!cleanupOnly) require('./handlers');
