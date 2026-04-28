const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { connectionStates, settingsPath } = require('../../modules/constants');
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

class WireGuard extends VpnBase {
    #tunnelName;
    #confPath;
    #connectionStatus;

    constructor(profile, hooks) {
        super(profile, hooks);
        // Use server DNS name (shared32.vpnuk.net → shared32.conf) to match fetch path
        this.#confPath      = settingsPath.wgConf(profile.id, profile.server?.dns);
        this.#tunnelName    = path.basename(this.#confPath, '.conf');
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

        await this.#uninstallTunnel(wgExe).catch(() => {});

        const result = cp.spawnSync(
            wgExe,
            ['/installtunnelservice', this.#confPath],
            { shell: false }
        );

        this._logStream.write(`[${ts()}] wireguard /installtunnelservice exit: ${result.status}\n`);
        if (result.stdout) this._logStream.write(`[stdout] ${result.stdout}\n`);
        if (result.stderr) this._logStream.write(`[stderr] ${result.stderr}\n`);

        if (result.status === 0) {
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
        let wgExe;
        try {
            wgExe = getWireGuardExePath();
        } catch {
            this._disconnectedHook?.();
            this._logStream.end();
            return;
        }
        await this.#uninstallTunnel(wgExe);
        this.#connectionStatus = connectionStates.disconnected;
        this._disconnectedHook?.();
        this._logStream.end();
    }

    getConnectionStatus() {
        return this.#connectionStatus;
    }

    #uninstallTunnel(wgExe) {
        return new Promise(resolve => {
            const proc = cp.spawn(wgExe, ['/uninstalltunnelservice', this.#tunnelName], { shell: false });
            proc.stdout?.pipe(this._logStream, { end: false });
            proc.stderr?.pipe(this._logStream, { end: false });
            proc.on('close', code => {
                this._logStream.write(`wireguard /uninstalltunnelservice exit: ${code}\n`);
                resolve(code);
            });
            proc.on('error', () => resolve(-1));
        });
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

module.exports = { WireGuard, checkWireGuardInstalled, installWireGuard };
