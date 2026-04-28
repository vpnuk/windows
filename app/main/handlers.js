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
const { openLogFileExternal, appendToLog } = require('./utils/logs');
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
        icon: path.join(__dirname, '../assets/icon.png'),
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
    const pid = profile.id || 'default';
    const ts  = () => new Date().toISOString();

    appendToLog(pid, `=== Connection Start ===`);
    appendToLog(pid, `profileName  : ${profile.name || '(unnamed)'}`);
    appendToLog(pid, `vpnType      : ${profile.vpnType}`);
    appendToLog(pid, `serverType   : ${profile.serverType}`);
    appendToLog(pid, `server.label : ${profile.server?.label || '(none)'}`);
    appendToLog(pid, `server.host  : ${profile.server?.host  || '(none)'}`);
    appendToLog(pid, `server.dns   : ${profile.server?.dns   || '(none)'}`);
    appendToLog(pid, `killSwitch   : ${profile.killSwitchEnabled ? 'ON' : 'off'}`);
    appendToLog(pid, `gateway      : ${gateway || '(unknown)'}`);

    vpnConnection = createVpn(profile, {
        connectedHook: async () => {
            appendToLog(pid, `Hook: connected to ${profile.server?.label}`);
            if (profile.killSwitchEnabled) {
                deleteRouteSync(defaultRoute, gateway).trim();
                appendToLog(pid, `Kill-switch: default route removed`);
            }
            // Mark connected immediately so the UI responds without waiting for the IP lookup.
            event.sender.send('connection-changed', connectionStates.connected);
            tray.setConnectedState(`Connected to ${profile.server.label}`);
            // WireGuard: the tunnel service starts before the kernel completes its
            // handshake and applies the new routing table.  Fetching the public IP
            // too early returns the ISP address instead of the VPN exit IP.
            // Wait 3 s for routing to stabilise, then do the lookup through the tunnel.
            await new Promise(r => setTimeout(r, 3000));
            const ip = await publicIp.v4({ timeout: 10000 }).catch(() => null);
            appendToLog(pid, `Public IP after connect: ${ip || '(lookup failed)'}`);
            if (ip) {
                tray.setConnectedState(`Connected to ${profile.server.label}\nYour IP: ${ip}`);
                event.sender.send('vpn-ip-update', ip);
            }
        },
        disconnectedHook: () => {
            appendToLog(pid, `Hook: disconnected`);
            try {
                event.sender.send('connection-changed', connectionStates.disconnected);
            } catch (error) {
                if (error.message !== 'Object has been destroyed') throw error;
            }
            tray.setDisconnectedState('Disconnected');
            if (profile.killSwitchEnabled) {
                addRouteSync(defaultRoute, gateway, defaultRoute).trim();
                appendToLog(pid, `Kill-switch: default route restored`);
            }
            deleteRouteSync(profile.server.host, gateway).trim();
        },
        connectingHook: () => {
            appendToLog(pid, `Hook: connecting...`);
            event.sender.send('connection-changed', connectionStates.connecting);
            tray.setConnectingState(`Connecting to ${profile.server.label}...`);
        },
        errorHook: error => {
            appendToLog(pid, `Hook: ERROR — ${error.message}`);
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

// Allow the renderer process (wgApi, ConnectionButton) to append diagnostic
// lines into the same log file that WireGuard / OpenVPN write to.
ipcMain.on('log-append', (_, { profileId, line }) => {
    if (!profileId || !line) return;
    try { appendToLog(profileId, line); } catch { /* best-effort */ }
});

ipcMain.on('log-open', (event, profileId) => {
    try {
        openLogFileExternal(profileId);
    } catch (error) {
        isDev && console.error('log-open error', error);
        event.sender.send('log-open-error', error.message || 'Could not open log file.');
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
        icon: path.join(__dirname, '../assets/icon.png'),
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
            icon: path.join(__dirname, '../assets/icon.png'),
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
        icon: path.join(__dirname, '../assets/icon.png'),
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
