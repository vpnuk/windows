const cp = require('child_process');
const fs = require('fs');
const { settingsPath, connectionStates } = require('../../modules/constants');
const { spawnChild } = require('../utils/async');
const { escapeSpaces } = require('../utils/cmd');
const VpnBase = require('./VpnBase');

const isDev = process.env.ELECTRON_ENV === 'Dev';

const getOpenVpnExePathSync = (obfuscate = false) => {
    if (process.env.OVPN_EXT_PATH && isDev) {
        return escapeSpaces(process.env.OVPN_EXT_PATH);
    }

    if (obfuscate && fs.existsSync(settingsPath.ovpnBinExe)) {
        return escapeSpaces(settingsPath.ovpnBinExe);
    }

    let exeKey = '' + cp
        .spawnSync('cmd', ['/c\ reg\ query\ HKLM\\SOFTWARE\\OpenVPN\\\ /v\ exe_path'],
            { shell: true })
        .stdout;
    let exePath = exeKey.substring(exeKey.indexOf('REG_SZ') + 6).trim();

    if (fs.existsSync(exePath)) {
        return escapeSpaces(exePath);
    }

    throw new Error('No OpenVPN found.');
};

// const killWindowsProcess = (pid, callback) => {
//     let proc = cp.spawn('taskkill', [`/PID\ ${pid}\ /T\ /F`], { shell: true });
//     proc.on('close', code => {
//         callback(code);
//     });
// };

const killWindowsProcessSync = pid => {
    let code = cp.spawnSync('taskkill', [`/PID\ ${pid}\ /T\ /F`], { shell: true })
        .status;
    isDev && console.log(`kill process PID=${pid} result=${code}`);
    return code;
};

const getOvpnAdapterNames = async () =>
    (await spawnChild(getOpenVpnExePathSync(),
        ['--show-adapters'], { shell: true }))
        .split('\r\n')
        .filter(_ => _)
        .slice(1)
        .map(line => line.substring(1, line.indexOf('\'', 1)));

const installOvpnUpdate = file =>
    cp.spawnSync('cmd', [`/c\ \"${file}\"`,
        'ADDLOCAL=OpenVPN,OpenVPN.Service,Drivers,Drivers.TAPWindows6',
        'SELECT_ASSOCIATIONS=0', '/passive'], { shell: true })
        .status;

class OpenVpn extends VpnBase {
    #obfuscate; #port; #protocol; #connectionStatus;
    #connection;

    constructor(profile, hooks) {
        super(profile, hooks);
        this.#obfuscate = profile.details.protocol.toLowerCase() === 'obfuscation';
        this.#port = profile.details.port;
        this.#protocol = profile.details.protocol.toLowerCase() === 'tcp' ? 'tcp' : 'udp';
        this.#connectionStatus = connectionStates.disconnected;
    }

    connect() {
        this.#connection = null;
        try {
            this.#connection = this.#runOpenVpn(
                code => { // on close
                    this._logStream.end();
                    isDev && console.log(`ovpn exited with code ${code}`);
                    this.#connectionStatus = connectionStates.disconnected;
                    this._disconnectedHook?.();
                },
                data => { // on data
                    isDev && console.log(`ovpn-out:\n${data}`);
                    if (data.includes('End ipconfig commands for register-dns')) {
                        // connection succeeded
                        this.#connectionStatus = connectionStates.connected;
                        this._connectedHook?.();
                    }
                }
            );
            isDev && console.log('ovpn connecting:', this.#connection.pid, this.#connection.exitCode);
            this.#connectionStatus = connectionStates.connecting;
            this._connectingHook?.();
        }
        catch (error) {
            this.#connection = null;
            this.#connectionStatus = connectionStates.disconnected;
            this._errorHook?.(error);
        }
    }

    disconnect() {
        this.#connection?.pid && killWindowsProcessSync(this.#connection.pid);
        //  && killWindowsProcess(this.#connection.pid, code => {
        //     isDev && console.log(`killed process PID=${this.#connection.pid} result=${code}`);
        // });
    }

    getConnectionStatus() {
        return this.#connectionStatus;
    }

    #runOpenVpn = (
        onCloseHandler = _ => { },
        onDataHandler = _ => { },
        onErrorHandler = errData => {
            isDev && console.log(`ovpn-error: ${errData}`);
        }
    ) => {
        fs.writeFileSync(
            settingsPath.profile,
            `${this._credentials.login}\n${this._credentials.password}`);

        let proc = cp.execFile(
            getOpenVpnExePathSync(this.#obfuscate),
            [
                `--config\ ${this.#obfuscate
                    ? escapeSpaces(settingsPath.ovpnObfucation)
                    : escapeSpaces(settingsPath.ovpn)}`,
                `--remote\ ${this._server.host}\ ${this.#port}`,
                `--proto\ ${this.#protocol}`,
                `--auth-user-pass\ ${escapeSpaces(settingsPath.profile)}`,
                this._dns.value?.length ? '--redirect-gateway\ def1' : '',
                this._dns.value?.length ? Array.from(this._dns.value,
                    addr => `--dhcp-option\ DNS\ ${addr}`).join(' ') : '',
                this._mtu?.value && `--mssfix\n ${'' + this._mtu.value}`
            ],
            { shell: true });

        isDev && console.log(proc.spawnargs);

        proc.stdout.pipe(this._logStream);
        proc.stderr.pipe(this._logStream);
        proc.stdout.on('data', onDataHandler);
        proc.stderr.on('data', onErrorHandler);
        proc.on('close', onCloseHandler);

        return proc;
    };
}

module.exports = { OpenVpn, getOvpnAdapterNames, installOvpnUpdate };