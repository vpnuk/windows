'use strict';
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { connectionStates } = require('../../modules/constants');
const VpnBase = require('./VpnBase');
const { createConfig, removeLocalConfig, confPath } = require('../../modules/wg-config');
const { serviceState, stopSessionTunnel, cleanupOwnedTunnels } = require('../utils/wg-tunnels');
const { cleanupBypassRoutes } = require('../utils/bypass-routes');
const { createDiagnostics, startupFailure } = require('../utils/wg-diagnostics');
const { appendToLog } = require('../utils/logs');

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
    #diagnostics = null;
    #nativeFailure = null;

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
        await this.refreshDiagnostics(this.#profile.id);
        // No early return if the external WireGuard application was uninstalled.
        await stopSessionTunnel(this.#tunnelName, this.#exeOrNull());
        await this.refreshDiagnostics(this.#profile.id);
        removeLocalConfig(this.#profile);
        cleanupBypassRoutes();
        this.#status = connectionStates.disconnected;
        this._disconnectedHook?.(intentional);
        // Restore 1.3.8's reusable server peer. Local keys are removed, but
        // get_config can return the same registered keys on the next connect.
        // Uninstall has its own confirmed remote cleanup and recovery journal.
        this.#log('Local WireGuard config removed; server config retained for reconnect.\n');
        this.#closeLog();
    }

    connect() {
        return this.#serialize(async () => {
            try {
                const exe = getWireGuardExePath();
                this.#diagnostics = createDiagnostics(exe, this.#tunnelName,
                    line => {
                        appendToLog(this.#profile.id, line.trimEnd());
                        this.#nativeFailure = startupFailure([line]) || this.#nativeFailure;
                    });
                this.#status = connectionStates.connecting;
                this._connectingHook?.();
                // Startup recovery handles owned orphaned services once.
                // Normal reconnect must not sweep every profile/config again.
                await stopSessionTunnel(this.#tunnelName, exe);
                this.#log('Loading this device’s WireGuard config without replacing its registered keys.\n');
                const config = await createConfig(this.#profile);
                this.#server = config.server;
                // Import existing history for this profile but don't classify a
                // previous connection's error as this connection's failure.
                await this.refreshDiagnostics(this.#profile.id);
                this.#nativeFailure = null;
                const result = cp.spawnSync(exe, ['/installtunnelservice', config.file],
                    { shell: false, windowsHide: true, timeout: 20000 });
                if (result.error || result.status !== 0) {
                    // Do not dump service output/config contents: they can
                    // contain private keys. Keep safe failure codes in the log.
                    const reason = result.error ? (result.error.code || 'launch failed') : `exit code ${result.status}`;
                    throw new Error(`WireGuard tunnel could not start (${reason}).`);
                }
                const manual = cp.spawnSync('sc.exe', ['config', `WireGuardTunnel$${this.#tunnelName}`, 'start=', 'demand'],
                    { shell: false, windowsHide: true, timeout: 10000 });
                if (manual.status !== 0) throw new Error('Could not disable automatic WireGuard startup.');
                let state = serviceState(this.#tunnelName);
                for (let attempt = 0; state !== 4 && state !== 1 && state !== null && attempt < 45; attempt++) {
                    // Adapter installation can outlast the old 10-second wait.
                    // Don't freeze the main process while Windows initializes it.
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    state = serviceState(this.#tunnelName);
                }
                await this.refreshDiagnostics(this.#profile.id);
                if (state !== 4 && this.#nativeFailure) throw new Error(this.#nativeFailure);
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
    refreshDiagnostics(profileId) {
        if (profileId !== this.#profile.id || !this.#diagnostics) return Promise.resolve([]);
        return this.#diagnostics();
    }
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
