const { app, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const publicIp = require('public-ip');
const {
    createVpn,
    getOvpnAdapterNames,
    installOvpnUpdate,
    checkWireGuardInstalled,
    installWireGuard
} = require('./vpn');
const { openLogFileExternal } = require('./utils/logs');
const {
    getDefaultGateway,
    defaultRoute,
    addRouteSync,
    deleteRouteSync,
    getIPv6Adapters,
    disableIPv6
} = require('./utils/routing');
const { connectionStates, settingsPath } = require('../modules/constants');
const { replaceVersionsEntry } = require('./utils/versions');
const {
    checkRootCert,
    removeRootCert,
    importRootCert
} = require('./utils/certs');
const { enableAutoUpdate } = require('./updater');
const { downloadWireGuardInstaller } = require('../modules/catalogs');

const isDev = process.env.ELECTRON_ENV === 'Dev';

let vpnConnection = null;

// ─── Friendly notification helper ─────────────────────────────────────────────
const sendNotification = (sender, { type = 'error', title, message }) => {
    try {
        sender.send('app-notification', { type, title, message });
    } catch {}
};

const showMessageBoxOnError = (error, title = 'Error', sender = null) => {
    isDev && console.error(error);
    if (sender) {
        sendNotification(sender, {
            type: 'error',
            title,
            message: error.message || String(error)
        });
    } else {
        dialog.showMessageBoxSync({
            type: 'error',
            title,
            message: error.message || String(error)
        });
    }
};

const closeConnection = async (beforeDisconnectCb = () => { }) => {
    let status = await vpnConnection?.getConnectionStatus();
    isDev && console.log(`closeConnection. status=${status}`);
    if (!vpnConnection || status !== connectionStates.connected) {
        return true;
    }
    if (dialog.showMessageBoxSync({
        type: 'warning',
        icon: path.join(__dirname, '../assets/icon.ico'),
        title: 'VPNUK',
        message: 'VPN is active. Disconnect and exit?',
        buttons: ['Disconnect & Exit', 'Cancel'],
        cancelId: 1
    }) !== 1) {
        beforeDisconnectCb();
        await vpnConnection.disconnect();
        return true;
    }
    return false;
};
exports.closeConnection = closeConnection;

// ─── Connection ───────────────────────────────────────────────────────────────

ipcMain.on('connection-start', async (event, args) => {
    isDev && console.log('connection-start', args);
    const { profile, gateway, wVpnOptions } = args;
    const { tray } = require('./main');

    vpnConnection = createVpn(profile, {
        connectedHook: async () => {
            if (profile.killSwitchEnabled) {
                deleteRouteSync(defaultRoute, gateway).trim();
            }
            const ip = await publicIp.v4().catch(() => 'unknown');
            event.sender.send('connection-changed', connectionStates.connected);
            tray.setConnectedState(`Connected to ${profile.server.label}\nYour IP: ${ip}`);
        },
        disconnectedHook: () => {
            try {
                event.sender.send('connection-changed', connectionStates.disconnected);
            } catch (error) {
                if (error.message !== 'Object has been destroyed') throw error;
            }
            tray.setDisconnectedState('Disconnected');
            if (profile.killSwitchEnabled) {
                addRouteSync(defaultRoute, gateway, defaultRoute).trim();
            }
            deleteRouteSync(profile.server.host, gateway).trim();
        },
        connectingHook: () => {
            event.sender.send('connection-changed', connectionStates.connecting);
            tray.setConnectingState(`Connecting to ${profile.server.label}...`);
        },
        errorHook: error => {
            sendNotification(event.sender, {
                type: 'error',
                title: 'Connection Error',
                message: error.message
            });
        }
    }, wVpnOptions);

    await vpnConnection.connect();
});

ipcMain.on('connection-stop', async () => {
    isDev && console.log('connection-stop');
    await vpnConnection?.disconnect();
});

// ─── Misc ─────────────────────────────────────────────────────────────────────

ipcMain.on('is-dev-request', event => {
    event.sender.send('is-dev-response', isDev);
});

ipcMain.on('log-open', (_, profileId) => {
    try {
        openLogFileExternal(profileId);
    } catch (error) {
        isDev && console.error('log-open error', error);
    }
});

ipcMain.on('default-gateway-request', async event => {
    event.sender.send('default-gateway-response', await getDefaultGateway());
});

ipcMain.on('ipv6-fix', async (event) => {
    isDev && console.log('ipv6-fix');
    try {
        const ovpnAdapters = await getOvpnAdapterNames();
        (await getIPv6Adapters()).forEach(async adapter => {
            if (adapter.ipv6Enabled && ovpnAdapters.some(_ => _ === adapter.name)) {
                await disableIPv6(adapter.name);
            }
        });
    } catch (error) {
        if (error.message !== 'No OpenVPN found.') {
            isDev && console.error('ipv6-fix error', error.message);
        }
    }
});

// ─── OpenVPN update ───────────────────────────────────────────────────────────

ipcMain.on('ovpn-update-request', async (event, arg) => {
    if (dialog.showMessageBoxSync({
        type: 'question',
        icon: path.join(__dirname, '../assets/icon.ico'),
        title: 'VPNUK Update',
        message: `OpenVPN ${arg.version} update available.\nInstall now?`,
        buttons: ['Install', 'Later'],
        cancelId: 1
    }) !== 1) {
        vpnConnection?.type === 'OpenVPN' && (await vpnConnection?.disconnect());
        event.sender.send('ovpn-update-response', arg);
    }
});

ipcMain.on('ovpn-update-install', (event, arg) => {
    if (installOvpnUpdate(arg.file) === 0) {
        dialog.showMessageBoxSync({
            type: 'info',
            icon: path.join(__dirname, '../assets/icon.ico'),
            title: 'VPNUK Update',
            message: 'OpenVPN updated successfully.',
            buttons: ['OK']
        });
        replaceVersionsEntry('openvpn', arg.info);
        event.sender.send('ovpn-update-installed', true);
    } else {
        if (dialog.showMessageBoxSync({
            type: 'warning',
            title: 'VPNUK Update',
            message: 'OpenVPN update failed. Try again?',
            buttons: ['Retry', 'Skip'],
            cancelId: 1
        }) !== 1) {
            event.sender.send('ovpn-update-response', arg.info);
        }
    }
});

// ─── WireGuard install ────────────────────────────────────────────────────────

ipcMain.on('wg-update-request', async (event, arg) => {
    if (checkWireGuardInstalled()) return;
    if (dialog.showMessageBoxSync({
        type: 'question',
        icon: path.join(__dirname, '../assets/icon.ico'),
        title: 'VPNUK — WireGuard',
        message: 'WireGuard is not installed.\nInstall it now to use WireGuard connections?',
        buttons: ['Install WireGuard', 'Skip'],
        cancelId: 1
    }) !== 1) {
        try {
            sendNotification(event.sender, {
                type: 'info',
                title: 'Installing WireGuard',
                message: 'Downloading WireGuard installer...'
            });
            const installerPath = await downloadWireGuardInstaller(arg.installer);
            const code = installWireGuard(installerPath);
            if (code === 0) {
                sendNotification(event.sender, {
                    type: 'info',
                    title: 'WireGuard Installed',
                    message: 'WireGuard installed successfully. You can now create WireGuard profiles.'
                });
            } else {
                sendNotification(event.sender, {
                    type: 'warning',
                    title: 'WireGuard Install',
                    message: 'WireGuard installation may have failed. Please install manually from wireguard.com.'
                });
            }
        } catch (err) {
            sendNotification(event.sender, {
                type: 'error',
                title: 'WireGuard Install Error',
                message: err.message || 'Installation failed. Please install WireGuard manually.'
            });
        }
    }
});

// ─── Auto-run (Windows startup) ───────────────────────────────────────────────

ipcMain.on('auto-run-toggle', (_, enable) => {
    isDev && console.log('auto-run-toggle', enable);
    const exePath = app.getPath('exe');
    if (enable) {
        app.setLoginItemSettings({ openAtLogin: true, path: exePath });
    } else {
        app.setLoginItemSettings({ openAtLogin: false });
    }
});

// ─── Auto-update ──────────────────────────────────────────────────────────────

ipcMain.on('auto-update-enable', event => {
    enableAutoUpdate(event.sender);
});

// ─── IKEv2 cert ───────────────────────────────────────────────────────────────

ipcMain.on('ikev2-cert-install', async (event, arg) => {
    if (arg || !(await checkRootCert())) {
        await removeRootCert();
        try {
            await fs.access(settingsPath.ikev2Cert);
            await importRootCert(settingsPath.ikev2Cert);
        } catch (err) {
            isDev && console.log('ikev2-cert-install error', err);
            event.sender.send('ikev2-cert-installed', false);
            return;
        }
    }
    event.sender.send('ikev2-cert-installed', true);
});
