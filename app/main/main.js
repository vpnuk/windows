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

const gotTheLock = app.requestSingleInstanceLock();

if (gotTheLock) {
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
            const { cleanupOrphanedTunnels, checkWireGuardInstalled } = require('./vpn/WireGuard');
            if (checkWireGuardInstalled()) {
                const cp = require('child_process');
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
                disconnectVpn();
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

require('./handlers');
