const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { connectionStates, settingsPath, wgConfSlug } = require('../../modules/constants');
const VpnBase = require('./VpnBase');

const isDev = process.env.ELECTRON_ENV === 'Dev';

const getWireGuardExePath = () => {
    if (process.env.WG_EXT_PATH && isDev) {
        return process.env.WG_EXT_PATH;
    }
    const regResult = cp.spawnSync(
        'cmd',
        ['/c', 'reg', 'query', 'HKLM\\SOFTWARE\\WireGuard', '/v', 'InstallationDirectory'],
        { shell: true }
    );
    const out = '' + regResult.stdout;
    const match = out.match(/InstallationDirectory\s+REG_SZ\s+(.+)/);
    if (match) {
        const dir = match[1].trim();
        const exe = path.join(dir, 'wireguard.exe');
        if (fs.existsSync(exe)) return exe;
    }
    const defaultPath = 'C:\\Program Files\\WireGuard\\wireguard.exe';
    if (fs.existsSync(defaultPath)) return defaultPath;
    throw new Error('WireGuard is not installed. Please install it from wireguard.com or restart the app to trigger auto-install.');
};

// Stop a WireGuard tunnel service by name using `sc stop`.
// This brings the adapter down cleanly before we uninstall.
const stopTunnelService = (tunnelName) => {
    const svcName = `WireGuardTunnel$${tunnelName}`;
    cp.spawnSync('sc', ['stop', svcName], { shell: true, timeout: 8000 });
};

// Set a WireGuard tunnel service start-type to DEMAND (manual).
// By default wireguard.exe /installtunnelservice registers AUTO — which means
// the tunnel reconnects automatically after a reboot without the app's knowledge.
const setServiceDemandStart = (tunnelName) => {
    const svcName = `WireGuardTunnel$${tunnelName}`;
    cp.spawnSync('sc', ['config', svcName, 'start=', 'demand'], { shell: true, timeout: 5000 });
};

// Uninstall a WireGuard tunnel service.
// NOTE: we do NOT pipe proc.stdout/stderr to logStream here.
// Piping streams into Electron's log stream during kernel driver teardown
// can trigger a race condition that causes a BSOD on some Windows versions.
const uninstallTunnelService = (wgExe, tunnelName) => {
    return new Promise(resolve => {
        const proc = cp.spawn(wgExe, ['/uninstalltunnelservice', tunnelName], { shell: false });
        proc.on('close', code => resolve(code));
        proc.on('error', () => resolve(-1));
        // Safety timeout: if wireguard.exe hangs, resolve after 10 s
        setTimeout(() => resolve(-99), 10000);
    });
};

// On app startup: find and clean up any VPNUK WireGuard tunnel services that
// were left running from a previous session (crash, forced close, etc.).
// Lists all services whose name starts with "WireGuardTunnel$", stops and
// uninstalls any that were created by us (conf file lives in APPDATA\VPNUK).
const cleanupOrphanedTunnels = (wgExe) => {
    try {
        const result = cp.spawnSync(
            'cmd',
            ['/c', 'sc', 'query', 'type=', 'all', 'state=', 'all'],
            { shell: true, timeout: 10000 }
        );
        const output = '' + result.stdout;
        const tunnelNames = [];
        const re = /SERVICE_NAME:\s+(WireGuardTunnel\$\S+)/g;
        let m;
        while ((m = re.exec(output)) !== null) {
            tunnelNames.push(m[1].replace('WireGuardTunnel$', ''));
        }
        for (const name of tunnelNames) {
            stopTunnelService(name);
        }
        if (wgExe && tunnelNames.length > 0) {
            // Give services a moment to stop before uninstalling
            setTimeout(() => {
                for (const name of tunnelNames) {
                    cp.spawn(wgExe, ['/uninstalltunnelservice', name], { shell: false });
                }
            }, 2000);
        }
    } catch {
        // best-effort
    }
};

class WireGuard extends VpnBase {
    #tunnelName;
    #confPath;
    #connectionStatus;

    constructor(profile, hooks) {
        super(profile, hooks);
        // Use the shared slug rule: dedicated/1:1 → dedicated.conf, shared → <server>.conf
        this.#confPath         = settingsPath.wgConf(profile.serverType, profile.server?.dns);
        this.#tunnelName       = path.basename(this.#confPath, '.conf');
        this.#connectionStatus = connectionStates.disconnected;
    }

    async connect() {
        const ts = () => new Date().toISOString();

        this._logStream.write(`\n[${ts()}] === WireGuard Connect ===\n`);
        this._logStream.write(`[${ts()}] server.label : ${this._server?.label || '(none)'}\n`);
        this._logStream.write(`[${ts()}] server.dns   : ${this._server?.dns  || '(none)'}\n`);
        this._logStream.write(`[${ts()}] server.host  : ${this._server?.host || '(none)'}\n`);
        this._logStream.write(`[${ts()}] confPath     : ${this.#confPath}\n`);
        this._logStream.write(`[${ts()}] tunnelName   : ${this.#tunnelName}\n`);
        this._logStream.write(`[${ts()}] confExists   : ${fs.existsSync(this.#confPath)}\n`);

        if (!fs.existsSync(this.#confPath)) {
            this._logStream.write(`[${ts()}] ERROR: conf file not found\n`);
            this._errorHook?.(new Error(
                'WireGuard config not found. Open Settings → Connection tab and click "Fetch WireGuard Config" first.'
            ));
            return;
        }

        let wgExe;
        try {
            wgExe = getWireGuardExePath();
        } catch (err) {
            this._logStream.write(`[${ts()}] ERROR: WireGuard exe not found: ${err.message}\n`);
            this._errorHook?.(err);
            return;
        }

        this._logStream.write(`[${ts()}] wgExe        : ${wgExe}\n`);
        this._connectingHook?.();
        this.#connectionStatus = connectionStates.connecting;

        // Clean up any existing tunnel for this name before installing a fresh one
        this._logStream.write(`[${ts()}] Stopping any existing tunnel service...\n`);
        stopTunnelService(this.#tunnelName);
        await new Promise(r => setTimeout(r, 1000));
        const unCode = await uninstallTunnelService(wgExe, this.#tunnelName);
        this._logStream.write(`[${ts()}] Pre-connect uninstall exit: ${unCode}\n`);
        await new Promise(r => setTimeout(r, 500));

        const result = cp.spawnSync(
            wgExe,
            ['/installtunnelservice', this.#confPath],
            { shell: false, timeout: 15000 }
        );

        this._logStream.write(`[${ts()}] wireguard /installtunnelservice exit: ${result.status}\n`);
        if (result.stdout) this._logStream.write(`[stdout] ${result.stdout}\n`);
        if (result.stderr) this._logStream.write(`[stderr] ${result.stderr}\n`);

        if (result.status === 0) {
            // Immediately change service start-type from AUTO to DEMAND.
            // AUTO start means the tunnel auto-reconnects on reboot, which we never want.
            setServiceDemandStart(this.#tunnelName);
            this._logStream.write(`[${ts()}] Service start-type set to DEMAND (manual)\n`);
            this.#connectionStatus = connectionStates.connected;
            this._connectedHook?.();
        } else {
            this.#connectionStatus = connectionStates.disconnected;
            this._disconnectedHook?.();
            this._errorHook?.(new Error(
                'WireGuard tunnel failed to start. Check the LOG tab for details.'
            ));
        }
    }

    async disconnect() {
        const ts = () => new Date().toISOString();
        let wgExe;
        try {
            wgExe = getWireGuardExePath();
        } catch {
            this.#connectionStatus = connectionStates.disconnected;
            this._disconnectedHook?.();
            this._logStream.end();
            return;
        }

        this._logStream.write(`\n[${ts()}] === WireGuard Disconnect ===\n`);

        // Step 1 — Stop the service so Windows tears down the adapter cleanly.
        // This must happen BEFORE uninstalltunnelservice.
        // Skipping this step and calling uninstall directly while traffic is
        // still flowing through the WireGuard kernel driver has been observed
        // to cause BSODs on some Windows versions.
        this._logStream.write(`[${ts()}] Stopping tunnel service (sc stop)...\n`);
        stopTunnelService(this.#tunnelName);

        // Step 2 — Wait for the kernel driver to release resources
        await new Promise(r => setTimeout(r, 1500));

        // Step 3 — Uninstall the tunnel (removes the adapter entry entirely)
        this._logStream.write(`[${ts()}] Uninstalling tunnel service...\n`);
        const code = await uninstallTunnelService(wgExe, this.#tunnelName);
        this._logStream.write(`[${ts()}] Uninstall exit: ${code}\n`);

        this.#connectionStatus = connectionStates.disconnected;
        this._disconnectedHook?.();
        this._logStream.end();
    }

    getConnectionStatus() {
        return this.#connectionStatus;
    }
}

const checkWireGuardInstalled = () => {
    try {
        getWireGuardExePath();
        return true;
    } catch {
        return false;
    }
};

const installWireGuard = installerPath => {
    const result = cp.spawnSync(
        'cmd',
        ['/c', `"${installerPath}"`, '/quiet'],
        { shell: true }
    );
    return result.status;
};

module.exports = { WireGuard, checkWireGuardInstalled, installWireGuard, cleanupOrphanedTunnels };
