const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { connectionStates, settingsPath, wgConfSlug } = require('../../modules/constants');
const VpnBase = require('./VpnBase');

const isDev = process.env.ELECTRON_ENV === 'Dev';

// How often (ms) to poll the WireGuard tunnel service for an unexpected drop.
const DROP_POLL_INTERVAL = 5000;

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

// Stop a WireGuard tunnel service by name using `sc stop`, then poll
// `sc query` until the service actually reaches STOPPED state.
//
// IMPORTANT: sc stop sends the stop signal and returns immediately — the
// service (and its kernel driver) may still be active for several seconds
// afterwards.  Calling /uninstalltunnelservice while the kernel driver is
// still running has been observed to cause BSODs on some Windows versions.
// We must wait for STATE : 1  STOPPED before proceeding.
const stopTunnelService = (tunnelName) => {
    const svcName = `WireGuardTunnel$${tunnelName}`;

    // Send the stop signal
    cp.spawnSync('sc', ['stop', svcName], { shell: true, timeout: 8000 });

    // Poll until STOPPED (or timeout after 15 s)
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const q = cp.spawnSync('sc', ['query', svcName], { shell: true, timeout: 5000 });
        const out = '' + q.stdout;
        // Service is gone or stopped — safe to proceed
        if (q.status !== 0 || out.includes('STATE              : 1  STOPPED') ||
            out.includes('does not exist')) break;
        // Brief busy-wait — spawnSync blocks the event loop so we use a tight loop
        cp.spawnSync('cmd', ['/c', 'ping', '-n', '2', '127.0.0.1'], { shell: true });
    }
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
// NOTE: This runs synchronously — createWindow() must not be called until
// cleanup is complete, otherwise a new connection attempt can race the uninstall.
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
        if (tunnelNames.length === 0) return;

        // Step 1 — stop all found services first
        for (const name of tunnelNames) {
            stopTunnelService(name);
        }

        // Step 2 — give the kernel driver a moment to release resources
        // then uninstall synchronously so cleanup is done before createWindow().
        // spawnSync (not spawn) ensures the adapter is gone before we continue.
        if (wgExe) {
            cp.spawnSync('cmd', ['/c', 'ping', '-n', '3', '127.0.0.1'], { shell: true });
            for (const name of tunnelNames) {
                cp.spawnSync(wgExe, ['/uninstalltunnelservice', name],
                    { shell: false, timeout: 10000 });
            }
        }
    } catch {
        // best-effort
    }
};

class WireGuard extends VpnBase {
    #tunnelName;
    #confPath;
    #connectionStatus;
    #dropWatcher = null;
    // Mutex flag — prevents connect() and disconnect() running concurrently.
    // Concurrent access to the WireGuard kernel driver during teardown can BSOD.
    #operationInProgress = false;

    constructor(profile, hooks) {
        super(profile, hooks);
        // Use the shared slug rule: dedicated/1:1 → dedicated.conf, shared → <server>.conf
        this.#confPath         = settingsPath.wgConf(profile.serverType, profile.server?.dns);
        this.#tunnelName       = path.basename(this.#confPath, '.conf');
        this.#connectionStatus = connectionStates.disconnected;
    }

    // ── Drop watcher ──────────────────────────────────────────────────────────
    // Polls the WireGuard tunnel service every DROP_POLL_INTERVAL ms.
    // If the service stops running while we think we are connected (i.e. not a
    // user-initiated disconnect) we fire disconnectedHook(false) so the kill
    // switch stays active and the UI shows the correct state.
    #startDropWatcher() {
        const svcName = `WireGuardTunnel$${this.#tunnelName}`;
        this.#dropWatcher = setInterval(() => {
            if (this.#connectionStatus !== connectionStates.connected) {
                this.#stopDropWatcher();
                return;
            }
            const result = cp.spawnSync('sc', ['query', svcName], { shell: true, timeout: 5000 });
            const out = '' + result.stdout;
            if (!out.includes('RUNNING')) {
                this.#stopDropWatcher();
                this.#connectionStatus = connectionStates.disconnected;
                // intentional = false — tunnel dropped on its own
                this._disconnectedHook?.(false);
            }
        }, DROP_POLL_INTERVAL);
    }

    #stopDropWatcher() {
        if (this.#dropWatcher) {
            clearInterval(this.#dropWatcher);
            this.#dropWatcher = null;
        }
    }

    async connect() {
        const ts = () => new Date().toISOString();

        // Guard against concurrent connect/disconnect — both touch the WireGuard
        // kernel driver and running them simultaneously can cause a BSOD.
        if (this.#operationInProgress) {
            this._logStream.write(`[${ts()}] connect() ignored — operation already in progress\n`);
            return;
        }
        this.#operationInProgress = true;

        try {
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

            // Clean up any existing tunnel for this name before installing a fresh one.
            // stopTunnelService now polls until the service is truly STOPPED before returning,
            // so it is safe to call uninstall immediately afterwards.
            this._logStream.write(`[${ts()}] Stopping any existing tunnel service...\n`);
            stopTunnelService(this.#tunnelName);
            const unCode = await uninstallTunnelService(wgExe, this.#tunnelName);
            this._logStream.write(`[${ts()}] Pre-connect uninstall exit: ${unCode}\n`);

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
                // Start watching for unexpected drops.
                this.#startDropWatcher();
            } else {
                this.#connectionStatus = connectionStates.disconnected;
                // intentional = true — connection never established, treat as expected failure
                this._disconnectedHook?.(true);
                this._errorHook?.(new Error(
                    'WireGuard tunnel failed to start. Check the LOG tab for details.'
                ));
            }
        } finally {
            this.#operationInProgress = false;
        }
    }

    async disconnect() {
        const ts = () => new Date().toISOString();

        // Guard against concurrent connect/disconnect — both touch the WireGuard
        // kernel driver and running them simultaneously can cause a BSOD.
        if (this.#operationInProgress) {
            this._logStream.write(`[${ts()}] disconnect() — waiting for in-progress operation...\n`);
            // Wait for connect() to finish (it holds the flag), then proceed.
            const waited = Date.now();
            while (this.#operationInProgress && Date.now() - waited < 20000) {
                await new Promise(r => setTimeout(r, 200));
            }
        }
        this.#operationInProgress = true;

        try {
            // Stop the drop watcher FIRST so it does not fire a false unexpected-drop
            // event while we are tearing the tunnel down intentionally.
            this.#stopDropWatcher();

            let wgExe;
            try {
                wgExe = getWireGuardExePath();
            } catch {
                this.#connectionStatus = connectionStates.disconnected;
                // intentional = true
                this._disconnectedHook?.(true);
                this._logStream.end();
                return;
            }

            this._logStream.write(`\n[${ts()}] === WireGuard Disconnect ===\n`);

            // Step 1 — Stop the service and WAIT until the kernel driver confirms
            // STOPPED state before proceeding.  stopTunnelService() polls sc query
            // so the driver is fully idle before we call uninstall.
            // Calling /uninstalltunnelservice while the driver is still active has
            // been observed to cause BSODs on some Windows versions.
            this._logStream.write(`[${ts()}] Stopping tunnel service (sc stop + poll)...\n`);
            stopTunnelService(this.#tunnelName);

            // Step 2 — Uninstall the tunnel (removes the adapter entry entirely).
            // No extra sleep needed — stopTunnelService already confirmed STOPPED.
            this._logStream.write(`[${ts()}] Uninstalling tunnel service...\n`);
            const code = await uninstallTunnelService(wgExe, this.#tunnelName);
            this._logStream.write(`[${ts()}] Uninstall exit: ${code}\n`);

            this.#connectionStatus = connectionStates.disconnected;
            // intentional = true — user initiated this disconnect
            this._disconnectedHook?.(true);
            this._logStream.end();
        } finally {
            this.#operationInProgress = false;
        }
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
