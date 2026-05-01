const cp = require('child_process');
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

// How often (ms) to poll the Windows VPN connection status for an unexpected drop.
const DROP_POLL_INTERVAL = 5000;

class WindowsVpn extends VpnBase {
    #ipseckey;
    #connectionStatus;
    #dropWatcher = null;

    constructor(profile, hooks, wVpnOptions) {
        super(profile, hooks);
        this.#ipseckey = wVpnOptions.ipseckey;
        this.#connectionStatus = connectionStates.disconnected;
    }

    // ── Drop watcher ──────────────────────────────────────────────────────────
    // Polls Get-VpnConnection every DROP_POLL_INTERVAL ms.
    // If the connection status is no longer "Connected" while we believe we are
    // connected, we fire disconnectedHook(false) so the kill switch stays active
    // and the UI reflects the real state.
    #startDropWatcher() {
        this.#dropWatcher = setInterval(() => {
            if (this.#connectionStatus !== connectionStates.connected) {
                this.#stopDropWatcher();
                return;
            }
            const result = cp.spawnSync(
                'powershell',
                [
                    '-Command',
                    `(Get-VpnConnection -Name '${this._name}' -ErrorAction SilentlyContinue).ConnectionStatus`
                ],
                { shell: false, timeout: 6000 }
            );
            const status = ('' + result.stdout).trim();
            // If we get a non-empty result and it is not "Connected", treat as
            // an unexpected drop. An empty result (command error) is ignored to
            // avoid false positives when the system is busy.
            if (status && status !== connectionStates.connected) {
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
        this._connectingHook?.();
        if (await this.getConnectionStatus() === connectionStates.connected) {
            await this.#rasdialDisconnect();
        }
        if (await this.getConnectionStatus() === connectionStates.disconnected) {
            await this.#removeConnection();
        }
        // L2TP/IPSec requires specific registry settings and the Policy Agent
        // service to be running.  Set them now, before creating the connection.
        if (this.type === VpnType.L2TP.label) {
            this.#prepareL2tp();
        }
        // PPTP requires firewall rules for TCP 1723 and GRE (protocol 47).
        if (this.type === VpnType.PPTP.label) {
            this.#preparePptp();
        }
        await this.#addConnection();
        await this.#setDns();
        await this.#vpnConnect();
        if (await this.getConnectionStatus() === connectionStates.connected) {
            this.#connectionStatus = connectionStates.connected;
            this._connectedHook?.();
            // Start watching for unexpected drops.
            this.#startDropWatcher();
        }
        else {
            await this.#removeConnection();
            this.#connectionStatus = connectionStates.disconnected;
            // intentional = true — connection never established, treat as expected failure
            this._disconnectedHook?.(true);
            this._logStream.end();
            this._errorHook?.(new Error(`${this._name} connection error.`));
        }
    }

    async disconnect() {
        // Stop the drop watcher FIRST so it does not fire a false unexpected-drop
        // event while we are tearing the connection down intentionally.
        this.#stopDropWatcher();

        if (await this.getConnectionStatus() === connectionStates.connected) {
            await this.#rasdialDisconnect();
        }
        if (await this.getConnectionStatus() === connectionStates.disconnected) {
            await this.#removeConnection();
        }
        this.#connectionStatus = connectionStates.disconnected;
        // intentional = true — user initiated this disconnect
        this._disconnectedHook?.(true);
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

    // ── L2TP/IPSec pre-flight ─────────────────────────────────────────────────
    // L2TP/IPSec with a pre-shared key fails silently from behind NAT unless
    // the AssumeUDPEncapsulationContextOnSendRule registry value is set to 2.
    // This is one of the most common reasons L2TP won't connect on Windows.
    // We also ensure the IPSec Policy Agent service is running — without it the
    // IKE handshake cannot complete.
    #prepareL2tp() {
        // Set NAT-T registry key (no reboot required — effective on next dial)
        cp.spawnSync('reg', [
            'add',
            'HKLM\\SYSTEM\\CurrentControlSet\\Services\\PolicyAgent',
            '/v', 'AssumeUDPEncapsulationContextOnSendRule',
            '/t', 'REG_DWORD',
            '/d', '2',
            '/f'
        ], { shell: true });

        // Ensure L2TP is not blocked by RasMan IPSec prohibition flag
        cp.spawnSync('reg', [
            'add',
            'HKLM\\SYSTEM\\CurrentControlSet\\Services\\RasMan\\Parameters',
            '/v', 'ProhibitIpSec',
            '/t', 'REG_DWORD',
            '/d', '0',
            '/f'
        ], { shell: true });

        // Start the IPSec Policy Agent service if it is not already running
        cp.spawnSync('sc', ['start', 'PolicyAgent'], { shell: true, timeout: 8000 });
    }

    // ── PPTP pre-flight ───────────────────────────────────────────────────────
    // PPTP uses TCP 1723 for the control channel AND GRE (IP protocol 47) for
    // the data channel.  Machines with strict Windows Firewall outbound rules
    // silently block GRE, so the user sees a connection attempt that hangs and
    // eventually times out.  We add outbound allow rules for both before dialling.
    // These are idempotent — deleting before adding means no duplicate rules pile up.
    #preparePptp() {
        const rules = [
            // name                  protocol  remoteport
            ['VPNUK-PPTP-TCP-1723', 'TCP',    '1723'],
            ['VPNUK-PPTP-GRE-47',   '47',      null ],   // GRE has no port concept
        ];
        for (const [name, proto, port] of rules) {
            cp.spawnSync('netsh', [
                'advfirewall', 'firewall', 'delete', 'rule', `name=${name}`
            ], { shell: true });
            const add = [
                'advfirewall', 'firewall', 'add', 'rule',
                `name=${name}`, 'dir=out', 'action=allow', `protocol=${proto}`,
            ];
            if (port) add.push(`remoteport=${port}`);
            cp.spawnSync('netsh', add, { shell: true });
        }
    }

    async #addConnection() {
        // IKEv2 MUST use the DNS hostname — never the raw IP address.
        // The certificate CN/SAN is validated against the hostname; an IP address
        // fails the TLS handshake.  Fall back to host if no DNS is configured so
        // the connection is still attempted (it will fail cert validation, but at
        // least it gets that far rather than erroring out here).
        const serverAddress = this.type === VpnType.IKEv2.label
            ? (this._server.dns || this._server.host)
            : this._server.host;

        // Keep the same argument format as the original working code.
        // PowerShell's implicit command mode concatenates all argv elements with
        // spaces into one command string, so multi-word elements like
        // '-Force -RememberCredential -PassThru' expand correctly.
        return await this.#logSpawn('powershell', [
            'Add-VpnConnection',
            '-Name', this._name,
            '-TunnelType', this.type,
            '-ServerAddress', serverAddress,
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
}

module.exports = WindowsVpn;
