const {
    connectionStates,
    VpnType,
    phoneBookPath
} = require('../../modules/constants');
const { spawnChild } = require('../utils/async');
const { readFile } = require('fs').promises;
const { writeFileSync } = require('fs');
const { encode, decode } = require('ini');
const VpnBase = require('./VpnBase');

class WindowsVpn extends VpnBase {
    #ipseckey;

    constructor(profile, hooks, wVpnOptions) {
        super(profile, hooks);
        this.#ipseckey = wVpnOptions.ipseckey;
    }

    async connect() {
        this._connectingHook?.();
        if (await this.getConnectionStatus() === connectionStates.connected) {
            await this.#rasdialDisconnect();
        }
        if (await this.getConnectionStatus() === connectionStates.disconnected) {
            await this.#removeConnection();
        }
        await this.#addConnection();
        await this.#setDns();
        await this.#vpnConnect();
        if (await this.getConnectionStatus() === connectionStates.connected) {
            this._connectedHook?.();
        }
        else {
            await this.#removeConnection();
            this._disconnectedHook?.();
            this._logStream.end();
            this._errorHook?.(new Error(`${this._name} connection error.`));
        }
    }

    async disconnect() {
        if (await this.getConnectionStatus() === connectionStates.connected) {
            await this.#rasdialDisconnect();
        }
        if (await this.getConnectionStatus() === connectionStates.disconnected) {
            await this.#removeConnection();
        }
        this._disconnectedHook?.();
        this._logStream.end();
    }

    async getConnectionStatus() {
        try {
            return (await this.#logSpawn('powershell', [
                'Get-VpnConnection -Name', this._name,
                '| Select -ExpandProperty ConnectionStatus'
            ])).trim();
        }
        catch { // error if there are no connection, ok with that
            return null;
        }
    }

    async #removeConnection() {
        return await this.#logSpawn('powershell', [
            'Remove-VpnConnection -Name', this._name, '-Force'
        ]);
    }

    async #addConnection() {
        return await this.#logSpawn('powershell', [
            'Add-VpnConnection',
            '-Name', this._name,
            '-TunnelType', this.type,
            '-ServerAddress', this.type === VpnType.IKEv2.label
                ? this._server.dns : this._server.host,
            this.type === VpnType.L2TP.label
                ? `-L2tpPsk ${this.#ipseckey}` : '',
            this.type !== VpnType.IKEv2.label
                ? '-AuthenticationMethod Chap, MsChapv2' : '',
            '-Force -RememberCredential -PassThru'
        ]);
    }

    async #vpnConnect() {
        return await this.#logSpawn('powershell', [
            'Connect-Vpn',
            this._name,
            this._credentials.login,
            this._credentials.password
        ]);
    }

    async #rasdialDisconnect() {
        return await this.#logSpawn('powershell',
            ['rasdial', this._name, '/d']);
    }

    async #setDns() {
        if (!this._dns.value) {
            return;
        }
        // todo: ? try-catch phoneBookPath file exists
        let phoneBook = decode(await readFile(phoneBookPath, 'utf-8'));
        phoneBook[this._name].IpPrioritizeRemote = '1';
        phoneBook[this._name].IpDnsAddress = this._dns.value[0];
        phoneBook[this._name].IpDns2Address = this._dns.value[1];
        phoneBook[this._name].IpNameAssign = '2';
        let result = encode(phoneBook);
        writeFileSync(phoneBookPath, result, 'utf-8');
    }

    async #logSpawn(cmd, args) {
        let result = await spawnChild(cmd, args);
        this._logStream.write(result);
        return result;
    }
};

module.exports = WindowsVpn;