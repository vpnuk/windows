const { app, dialog, ipcMain, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
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
    disableIPv6,
    disableAllIPv6,
    enableAllIPv6,
} = require('./utils/routing');
const { connectionStates, settingsPath, settingsFolder, VpnType } = require('../modules/constants');
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

// ─── Kill-switch crash-recovery state file ────────────────────────────────────
// Written to disk whenever the kill switch is active so that if the app is
// force-killed or crashes we can restore the default route on next startup.
const ksStatePath = path.join(settingsFolder, 'ks.json');

const writeKsState = (active, gateway = null) => {
    try {
        fsSync.writeFileSync(ksStatePath, JSON.stringify({ active, gateway }), 'utf-8');
    } catch { /* best-effort */ }
};

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
    // Disconnect if connected OR still connecting — the tunnel service is already
    // installed in both states and must be torn down, otherwise it stays running
    // as an orphan in Network Adapters after the app exits.
    const needsDisconnect = status === connectionStates.connected ||
                            status === connectionStates.connecting;
    if (!vpnConnection || !needsDisconnect) {
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

    appendToLog(pid, `=== Connection Start ===`);
    appendToLog(pid, `profileName  : ${profile.name || '(unnamed)'}`);
    appendToLog(pid, `vpnType      : ${profile.vpnType}`);
    appendToLog(pid, `serverType   : ${profile.serverType}`);
    appendToLog(pid, `server.label : ${profile.server?.label || '(none)'}`);
    appendToLog(pid, `server.host  : ${profile.server?.host  || '(none)'}`);
    appendToLog(pid, `server.dns   : ${profile.server?.dns   || '(none)'}`);
    appendToLog(pid, `killSwitch   : ${profile.killSwitchEnabled ? 'ON' : 'off'}`);
    appendToLog(pid, `gateway      : ${gateway || '(unknown)'}`);

    // ── IKEv2: auto-install the root certificate if not already present ────────
    if (profile.vpnType === VpnType.IKEv2.label) {
        try {
            const certPresent = await checkRootCert();
            if (!certPresent) {
                appendToLog(pid, `IKEv2: root cert not found — importing...`);
                await importRootCert(settingsPath.ikev2Cert);
                appendToLog(pid, `IKEv2: root cert imported OK`);
            } else {
                appendToLog(pid, `IKEv2: root cert already in store`);
            }
        } catch (err) {
            appendToLog(pid, `IKEv2: cert import FAILED — ${err.message}`);
            sendNotification(event.sender, {
                type: 'error',
                title: 'IKEv2 Certificate Error',
                message: `Could not install the IKEv2 certificate: ${err.message}. Try Settings → Connection → Install Certificate first.`
            });
            return;
        }
    }

    vpnConnection = createVpn(profile, {
        connectedHook: async () => {
            appendToLog(pid, `Hook: connected to ${profile.server?.label}`);
            if (profile.killSwitchEnabled) {
                // Remove the ISP default route — all traffic must now flow through
                // the VPN tunnel. If the tunnel drops unexpectedly the system has no
                // fallback route so internet is blocked (kill switch is active).
                deleteRouteSync(defaultRoute, gateway);
                appendToLog(pid, `Kill-switch: default route removed`);

                // Block IPv6 on every adapter so there is no IPv6 leak path.
                disableAllIPv6();
                appendToLog(pid, `Kill-switch: IPv6 disabled on all adapters`);

                // Persist state so startup recovery can restore the route if the
                // app is force-killed or crashes while the kill switch is active.
                writeKsState(true, gateway);
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

        // intentional = true  → user clicked Disconnect (restore internet)
        // intentional = false → tunnel dropped unexpectedly (keep internet blocked)
        disconnectedHook: (intentional = true) => {
            appendToLog(pid, `Hook: disconnected (intentional=${intentional})`);
            try {
                event.sender.send('connection-changed', connectionStates.disconnected);
            } catch (error) {
                if (error.message !== 'Object has been destroyed') throw error;
            }
            tray.setDisconnectedState('Disconnected');

            if (profile.killSwitchEnabled) {
                if (intentional) {
                    // User chose to disconnect — restore full internet access.
                    addRouteSync(defaultRoute, gateway, defaultRoute);
                    appendToLog(pid, `Kill-switch: default route restored`);
                    enableAllIPv6();
                    appendToLog(pid, `Kill-switch: IPv6 re-enabled on all adapters`);
                    writeKsState(false);
                } else {
                    // Unexpected drop — keep internet blocked and tell the user.
                    appendToLog(pid, `Kill-switch: tunnel dropped — internet remains blocked`);
                    sendNotification(event.sender, {
                        type: 'warning',
                        title: 'VPN Dropped — Kill Switch Active',
                        message: 'The VPN dropped unexpectedly. Internet access is blocked to protect your IP. Reconnect or disable the kill switch to restore access.'
                    });
                }
            }

            deleteRouteSync(profile.server.host, gateway);
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

ipcMain.handle('get-version', () => app.getVersion());

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
// app.setLoginItemSettings() silently fails for admin-elevated apps because
// Windows will not auto-launch a requireAdministrator process at login
// without a UAC prompt (which no one sees at boot time).
// Instead we register an ONLOGON scheduled task at HIGHEST privilege —
// the same mechanism used by the desktop shortcut — so the app starts
// elevated without any UAC prompt.

ipcMain.on('auto-run-toggle', (_, enable) => {
    isDev && console.log('auto-run-toggle', enable);
    const cp  = require('child_process');
    const fs  = require('fs');
    const os  = require('os');
    const path = require('path');

    if (enable) {
        // Use PowerShell Register-ScheduledTask via a temp .ps1 file to avoid
        // quoting issues with schtasks CLI.  Mirrors the installer's customInstall
        // approach so auto-start uses the same Administrators/Highest privilege model
        // as the desktop shortcut — no UAC prompt at login.
        const exePath = app.getPath('exe').replace(/'/g, "''"); // escape PS single-quotes
        const psLines = [
            `$action    = New-ScheduledTaskAction -Execute '${exePath}'`,
            `$trigger   = New-ScheduledTaskTrigger -AtLogon`,
            `$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Highest`,
            `$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan)`,
            `Register-ScheduledTask -TaskName 'VPNUK-Startup' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null`,
        ].join('\r\n');
        const tmp = path.join(os.tmpdir(), 'vpnuk_startup.ps1');
        try { fs.writeFileSync(tmp, psLines, 'utf8'); } catch (_) {}
        cp.exec(
            `powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`,
            err => {
                try { fs.unlinkSync(tmp); } catch (_) {}
                isDev && err && console.error('auto-run enable:', err.message);
            }
        );
    } else {
        cp.exec('schtasks /Delete /TN "VPNUK-Startup" /F', () => {});
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

// ── Live Help — open Tawk.to chat in a detached floating window ───────────────
const TAWK_URL = 'https://tawk.to/chat/56bae5de496019e65d794d8f/default';
let liveHelpWindow = null;

let wgManageWindow = null;
ipcMain.on('open-wg-manage', () => {
    if (wgManageWindow && !wgManageWindow.isDestroyed()) {
        wgManageWindow.focus();
        return;
    }
    wgManageWindow = new BrowserWindow({
        width:  800,
        height: 600,
        title:  'WireGuard Config Manager',
        icon:   path.join(__dirname, '../../app/assets/icon.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
        resizable: true,
        minimizable: true,
        maximizable: true,
    });
    wgManageWindow.loadURL('https://clientcp.vpnuk.info/vpnuk/clients/wireguard_v2.php');
    wgManageWindow.setMenuBarVisibility(false);
    wgManageWindow.on('closed', () => { wgManageWindow = null; });
});

ipcMain.on('open-live-help', () => {
    if (liveHelpWindow && !liveHelpWindow.isDestroyed()) {
        liveHelpWindow.focus();
        return;
    }
    liveHelpWindow = new BrowserWindow({
        width:  420,
        height: 600,
        title:  'VPNUK Live Help',
        icon:   path.join(__dirname, '../../app/assets/icon.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
        resizable: true,
        minimizable: true,
        maximizable: false,
    });
    liveHelpWindow.loadURL(TAWK_URL);
    liveHelpWindow.setMenuBarVisibility(false);
    liveHelpWindow.on('closed', () => { liveHelpWindow = null; });
});
