'use strict';
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { connectionStates } = require('../../modules/constants');
const VpnBase = require('./VpnBase');
const { createConfig, releaseConfig, removeLocalConfig, confPath } = require('../../modules/wg-config');
const { serviceState, stopAndRemoveTunnel, cleanupOwnedTunnels } = require('../utils/wg-tunnels');
const { cleanupBypassRoutes } = require('../utils/bypass-routes');

function getWireGuardExePath() {
    if (process.env.WG_EXT_PATH && process.env.ELECTRON_ENV === 'Dev') return process.env.WG_EXT_PATH;
    const query = cp.spawnSync('reg.exe', ['query', 'HKLM\\SOFTWARE\\WireGuard', '/v', 'InstallationDirectory'],
        { shell: false, windowsHide: true, encoding: 'utf8', timeout: 5000 });
    const directory = String(query.stdout || '').match(/InstallationDirectory\s+REG_SZ\s+(.+)/)?.[1]?.trim();
    const candidates = [
        directory && path.join(directory, 'wireguard.exe'),
        path.join(process.env.ProgramW6432 || 'C:\\Program Files', 'WireGuard', 'wireguard.exe'),
        'C:\\Program Files\\WireGuard\\wireguard.exe',
    ];
    const exe = candidates.find(candidate => candidate && fs.existsSync(candidate));
    if (!exe) throw new Error('WireGuard is not installed. Install WireGuard from Settings and try again.');
    return exe;
}

class WireGuard extends VpnBase {
    #profile; #tunnelName; #status = connectionStates.disconnected;
    #watcher = null; #queue = Promise.resolve(); #server = null; #pending = 0; #logClosed = false;

    constructor(profile, hooks) {
        super(profile, hooks);
        this.#profile = profile;
        this.#tunnelName = path.basename(confPath(profile), '.conf');
    }

    #serialize(operation) {
        this.#pending++;
        const next = this.#queue.then(operation);
        this.#queue = next.catch(() => {}).then(() => { this.#pending--; });
        return next;
    }

    #stopWatcher() {
        if (this.#watcher) clearInterval(this.#watcher);
        this.#watcher = null;
    }

    #log(message) { if (!this.#logClosed) this._logStream.write(message); }
    #closeLog() {
        if (!this.#logClosed) this._logStream.end();
        this.#logClosed = true;
    }

    #exeOrNull() {
        try { return getWireGuardExePath(); } catch { return null; }
    }

    async #removeSession(intentional) {
        this.#stopWatcher();
        // No early return if the external WireGuard application was uninstalled.
        stopAndRemoveTunnel(this.#tunnelName, this.#exeOrNull());
        removeLocalConfig(this.#profile);
        cleanupBypassRoutes();
        this.#status = connectionStates.disconnected;
        // Restore the intentional-disconnect kill-switch route before API deletion.
        this._disconnectedHook?.(intentional);
        // Remote cleanup runs after connectivity is restored on an intentional
        // disconnect. It cannot complete through an active drop kill switch.
        if (!intentional && this.#profile.killSwitchEnabled) {
            this.#log('Remote peer cleanup deferred while the kill switch blocks internet access.\n');
            this.#closeLog();
            return;
        }
        try {
            await releaseConfig(this.#profile, this.#server === null ? undefined : this.#server);
        } catch (error) {
            // Local keys/service are already gone. Offline remote deletion must not
            // pretend it succeeded; the next connect releases this device slot again.
            this.#log(`WireGuard remote config cleanup failed: ${error.message}\n`);
            this._errorHook?.(new Error('Local WireGuard config removed. Server-side cleanup could not finish; it will be retried before the next connection.'));
        } finally {
            this.#closeLog();
        }
    }

    connect() {
        return this.#serialize(async () => {
            try {
                const exe = getWireGuardExePath();
                this.#status = connectionStates.connecting;
                this._connectingHook?.();
                cleanupOrphanedTunnels();
                stopAndRemoveTunnel(this.#tunnelName, exe);
                this.#log('Requesting a new WireGuard config for this connection.\n');
                const config = await createConfig(this.#profile);
                this.#server = config.server;
                const result = cp.spawnSync(exe, ['/installtunnelservice', config.file],
                    { shell: false, windowsHide: true, timeout: 20000 });
                if (result.error || result.status !== 0) throw new Error('WireGuard tunnel could not start.');
                const manual = cp.spawnSync('sc.exe', ['config', `WireGuardTunnel$${this.#tunnelName}`, 'start=', 'demand'],
                    { shell: false, windowsHide: true, timeout: 10000 });
                if (manual.status !== 0) throw new Error('Could not disable automatic WireGuard startup.');
                let state = serviceState(this.#tunnelName);
                for (let attempt = 0; state !== 4 && state !== null && attempt < 10; attempt++) {
                    cp.spawnSync('ping.exe', ['-n', '2', '127.0.0.1'], { shell: false, windowsHide: true, timeout: 3000 });
                    state = serviceState(this.#tunnelName);
                }
                if (state !== 4) throw new Error('WireGuard tunnel service is not running.');
                this.#status = connectionStates.connected;
                this._connectedHook?.();
                this.#watcher = setInterval(() => {
                    try {
                        if (this.#exeOrNull() && serviceState(this.#tunnelName) === 4) return;
                        this.#stopWatcher();
                        this.#serialize(() => this.#removeSession(false)).catch(error => this._errorHook?.(error));
                    } catch (error) {
                        this.#stopWatcher();
                        this._errorHook?.(error);
                    }
                }, 5000);
            } catch (error) {
                // Do not delete keys or report a clean disconnect unless the driver
                // really stopped. Retain a failed service for a safe retry.
                try { await this.#removeSession(true); }
                catch (cleanupError) { this._errorHook?.(cleanupError); }
                this._errorHook?.(error);
                throw error;
            }
        });
    }

    disconnect() { return this.#serialize(() => this.#removeSession(true)); }
    getConnectionStatus() { return this.#status; }
    isBusy() { return this.#pending > 0; }
}

function cleanupOrphanedTunnels() {
    let exe = null;
    try { exe = getWireGuardExePath(); } catch {}
    cleanupOwnedTunnels(exe);
}

function checkWireGuardInstalled() {
    try { getWireGuardExePath(); return true; } catch { return false; }
}

function installWireGuard(installerPath) {
    return cp.spawnSync(installerPath, ['/quiet'], { shell: false, windowsHide: true }).status;
}

module.exports = { WireGuard, checkWireGuardInstalled, installWireGuard, cleanupOrphanedTunnels };
