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

// Timestamp prefix for every log line written by this module.
function ts() {
    return new Date().toISOString();
}

class WindowsVpn extends VpnBase {
    #ipseckey;
    #connectionStatus;
    #dropWatcher = null;

    constructor(profile, hooks, wVpnOptions) {
        super(profile, hooks);
        this.#ipseckey = wVpnOptions.ipseckey;
        this.#connectionStatus = connectionStates.disconnected;
    }

    // ── Logging ───────────────────────────────────────────────────────────────
    #log(msg) {
        this._logStream.write(`[${ts()}] ${msg}\n`);
    }

    // ── Drop watcher ──────────────────────────────────────────────────────────
    // Polls Get-VpnConnection every DROP_POLL_INTERVAL ms.
    // If the connection status is no longer "Connected" while we believe we are
    // connected, we fire disconnectedHook(false) so the kill switch stays active
    // and the UI reflects the real state.
    #startDropWatcher() {
        this.#log(`DROP-WATCHER start — polling every ${DROP_POLL_INTERVAL}ms`);
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
            const stderr = ('' + result.stderr).trim();
            if (stderr) this.#log(`DROP-WATCHER poll error: ${stderr}`);
            this.#log(`DROP-WATCHER poll → status="${status || '(empty)'}"`);
            if (status && status !== connectionStates.connected) {
                this.#log(`DROP-WATCHER detected unexpected drop (status="${status}") — firing disconnectedHook`);
                this.#stopDropWatcher();
                this.#connectionStatus = connectionStates.disconnected;
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
        this.#log(`=== CONNECT START — type=${this.type} name=${this._name} server=${this._server?.host} ===`);
        this._connectingHook?.();

        const priorStatus = await this.getConnectionStatus();
        this.#log(`Pre-connect status check → "${priorStatus}"`);
        if (priorStatus === connectionStates.connected) {
            this.#log('Existing connection detected — running rasdial /d to tear it down');
            await this.#rasdialDisconnect();
        }
        const afterDisc = await this.getConnectionStatus();
        this.#log(`Status after disconnect → "${afterDisc}"`);
        if (afterDisc === connectionStates.disconnected) {
            this.#log('Removing stale connection profile');
            await this.#removeConnection();
        }

        if (this.type === VpnType.L2TP.label) {
            this.#log('Running L2TP pre-flight (registry NAT-T + ProhibitIpSec + PolicyAgent)');
            this.#prepareL2tp();
        }
        if (this.type === VpnType.PPTP.label) {
            this.#log('Running PPTP pre-flight (firewall rules TCP-1723 + GRE-47)');
            this.#preparePptp();
        }
        if (this.type === VpnType.IKEv2.label) {
            this.#log('Running IKEv2 pre-flight (DisableStrictCertificateChecking)');
            this.#prepareIkev2();
        }

        try {
            this.#log('STEP 1 — Add-VpnConnection (creating profile)');
            await this.#addConnection();
            this.#log('STEP 1 complete — profile created');

            this.#log('STEP 2 — Writing phonebook (IpPrioritizeRemote + DNS)');
            await this.#setDns();
            this.#log('STEP 2 complete — phonebook written');

            this.#log('STEP 3 — Connect-Vpn (45 s timeout)');
            await this.#vpnConnect();
            this.#log('STEP 3 complete — Connect-Vpn returned without error');
        } catch (err) {
            this.#log(`CONNECT FAILED — ${err.message}`);
            this.#stopDropWatcher();
            await this.#removeConnection().catch(e => this.#log(`cleanup removeConnection error: ${e.message}`));
            this.#connectionStatus = connectionStates.disconnected;
            this._disconnectedHook?.(true);
            this._logStream.end();
            this._errorHook?.(err);
            return;
        }

        const finalStatus = await this.getConnectionStatus();
        this.#log(`Post-connect status check → "${finalStatus}"`);

        if (finalStatus === connectionStates.connected) {
            this.#connectionStatus = connectionStates.connected;
            if (this.type === VpnType.L2TP.label || this.type === VpnType.IKEv2.label) {
                this.#log('STEP 4 — Applying post-connect default route to active routing table');
                this.#applyPostConnectRoute();
            }
            this.#log('=== CONNECT SUCCESS ===');
            this._connectedHook?.();
            this.#startDropWatcher();
        }
        else {
            this.#log(`CONNECT FAILED — status after connect is "${finalStatus}" not Connected`);
            await this.#removeConnection().catch(e => this.#log(`cleanup removeConnection error: ${e.message}`));
            this.#connectionStatus = connectionStates.disconnected;
            this._disconnectedHook?.(true);
            this._logStream.end();
            this._errorHook?.(new Error(`${this._name} connection error.`));
        }
    }

    async disconnect() {
        this.#log('=== DISCONNECT START ===');
        this.#stopDropWatcher();

        const status = await this.getConnectionStatus();
        this.#log(`Status at disconnect → "${status}"`);
        if (status === connectionStates.connected) {
            this.#log('Calling rasdial /d');
            await this.#rasdialDisconnect();
        }
        const statusAfter = await this.getConnectionStatus();
        this.#log(`Status after rasdial /d → "${statusAfter}"`);
        if (statusAfter === connectionStates.disconnected) {
            this.#log('Removing connection profile');
            await this.#removeConnection();
        }
        this.#connectionStatus = connectionStates.disconnected;
        this.#log('=== DISCONNECT COMPLETE ===');
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
    #prepareL2tp() {
        let r;

        r = cp.spawnSync('reg', [
            'add',
            'HKLM\\SYSTEM\\CurrentControlSet\\Services\\PolicyAgent',
            '/v', 'AssumeUDPEncapsulationContextOnSendRule',
            '/t', 'REG_DWORD', '/d', '2', '/f'
        ], { shell: true });
        this.#log(`L2TP-PREP reg AssumeUDPEncapsulationContextOnSendRule=2 → exit ${r.status} ${r.stderr?.toString().trim() || ''}`);

        r = cp.spawnSync('reg', [
            'add',
            'HKLM\\SYSTEM\\CurrentControlSet\\Services\\RasMan\\Parameters',
            '/v', 'ProhibitIpSec',
            '/t', 'REG_DWORD', '/d', '0', '/f'
        ], { shell: true });
        this.#log(`L2TP-PREP reg ProhibitIpSec=0 → exit ${r.status} ${r.stderr?.toString().trim() || ''}`);

        r = cp.spawnSync('sc', ['start', 'PolicyAgent'], { shell: true, timeout: 8000 });
        this.#log(`L2TP-PREP sc start PolicyAgent → exit ${r.status} ${r.stderr?.toString().trim() || ''}`);
    }

    // ── PPTP pre-flight ───────────────────────────────────────────────────────
    #preparePptp() {
        const rules = [
            ['VPNUK-PPTP-TCP-1723', 'TCP', '1723'],
            ['VPNUK-PPTP-GRE-47',   '47',   null ],
        ];
        for (const [name, proto, port] of rules) {
            let r = cp.spawnSync('netsh', [
                'advfirewall', 'firewall', 'delete', 'rule', `name=${name}`
            ], { shell: true });
            this.#log(`PPTP-PREP firewall delete ${name} → exit ${r.status}`);

            const add = [
                'advfirewall', 'firewall', 'add', 'rule',
                `name=${name}`, 'dir=out', 'action=allow', `protocol=${proto}`,
            ];
            if (port) add.push(`remoteport=${port}`);
            r = cp.spawnSync('netsh', add, { shell: true });
            this.#log(`PPTP-PREP firewall add ${name} proto=${proto} → exit ${r.status} ${r.stderr?.toString().trim() || ''}`);
        }
    }

    // ── IKEv2 pre-flight ──────────────────────────────────────────────────────
    #prepareIkev2() {
        // Windows IKEv2 enforces strict server-certificate EKU checks by default:
        // the server cert must carry the serverAuth OID (1.3.6.1.5.5.7.3.1).
        // VPNUK's internal CA issues certs without that OID, which causes Windows
        // to abort the IKE_AUTH exchange with "Invalid payload received" (13868).
        // DisableStrictCertificateChecking=1 relaxes the EKU requirement so the
        // connection can proceed while still verifying the cert chain (the VPNUK
        // Root CA is in LocalMachine\Root).
        const r = cp.spawnSync('reg', [
            'add',
            'HKLM\\SYSTEM\\CurrentControlSet\\Services\\RasMan\\Parameters',
            '/v', 'DisableStrictCertificateChecking',
            '/t', 'REG_DWORD', '/d', '1', '/f'
        ], { shell: true, timeout: 5000 });
        this.#log(`IKEv2-PREP DisableStrictCertificateChecking=1 → exit ${r.status} ${r.stderr?.toString().trim() || ''}`);
    }

    async #addConnection() {
        const serverAddress = this.type === VpnType.IKEv2.label
            ? (this._server.dns || this._server.host)
            : this._server.host;

        const authMethod = this.type === VpnType.IKEv2.label
            ? 'Eap'
            : 'Chap, MsChapv2';

        this.#log(`ADD-CONNECTION TunnelType=${this.type} ServerAddress=${serverAddress} AuthMethod=${authMethod}${this.type === VpnType.L2TP.label ? ' L2tpPsk=***' : ''}`);

        const result = await this.#logSpawn('powershell', [
            'Add-VpnConnection',
            '-Name', this._name,
            '-TunnelType', this.type,
            '-ServerAddress', serverAddress,
            this.type === VpnType.L2TP.label
                ? `-L2tpPsk ${this.#ipseckey}` : '',
            this.type === VpnType.IKEv2.label
                ? '-AuthenticationMethod Eap'
                : '-AuthenticationMethod Chap, MsChapv2',
            '-Force -RememberCredential -PassThru'
        ]);

        this.#log(`ADD-CONNECTION output: ${result?.trim() || '(none)'}`);

        // For IKEv2 — override the default PEAP-MSCHAPv2 EAP config that Windows
        // sets automatically with raw EAP-MSCHAPv2 (type 26, no PEAP wrapper).
        // VPNUK's IKEv2 server expects the unwrapped type; sending PEAP causes
        // the "Invalid payload received" handshake failure we were seeing.
        if (this.type === VpnType.IKEv2.label) {
            this.#log('IKEv2 — overriding EAP config to raw MSCHAPv2 (type 26)');
            await this.#setIkev2EapConfig();
        }

        return result;
    }

    async #setIkev2EapConfig() {
        // EAP type 26 = EAP-MSCHAPv2 (raw, no PEAP wrapper).
        // Windows defaults to type 25 (PEAP) when AuthenticationMethod=Eap is set
        // via Add-VpnConnection.  IKEv2 servers that use EAP-MSCHAPv2 directly
        // reject PEAP with an IKEv2 "Invalid payload received" error.
        const eapXml = [
            '<?xml version="1.0"?>',
            '<EapHostConfig xmlns="http://www.microsoft.com/provisioning/EapHostConfig">',
            '  <EapMethod>',
            '    <Type xmlns="http://www.microsoft.com/provisioning/EapCommon">26</Type>',
            '    <VendorId xmlns="http://www.microsoft.com/provisioning/EapCommon">0</VendorId>',
            '    <VendorType xmlns="http://www.microsoft.com/provisioning/EapCommon">0</VendorType>',
            '    <AuthorId xmlns="http://www.microsoft.com/provisioning/EapCommon">0</AuthorId>',
            '  </EapMethod>',
            '  <Config xmlns="http://www.microsoft.com/provisioning/MsChapV2ConnectionPropertiesV1">',
            '    <MsChapV2Properties>',
            '      <UseWinlogonCredentials>false</UseWinlogonCredentials>',
            '    </MsChapV2Properties>',
            '  </Config>',
            '</EapHostConfig>',
        ].join('');

        // Write to a temp file to avoid PowerShell quoting issues with the XML string.
        const tmpPath = '%TEMP%\\vpnuk_ikev2_eap.xml';
        const cmd =
            `Set-Content -Path '${tmpPath}' -Value '${eapXml}' -Encoding UTF8;` +
            ` $doc = [xml](Get-Content -Path '${tmpPath}' -Encoding UTF8);` +
            ` Set-VpnConnectionEapConfiguration -ConnectionName '${this._name}'` +
            `   -EapConfigXmlStream $doc -Force;` +
            ` Write-Output "EAP-CONFIG-SET"`;

        try {
            const result = await this.#logSpawn('powershell', ['-Command', cmd]);
            this.#log(`IKEv2-EAP result: ${result?.trim() || '(none)'}`);
        } catch (err) {
            this.#log(`IKEv2-EAP config error (non-fatal): ${err.message}`);
        }
    }

    #applyPostConnectRoute() {
        this.#log(`POST-ROUTE looking up adapter name="${this._name}"`);
        // Strategy 1 — exact name match (works for IKEv2, may not for L2TP PPP adapters).
        // Strategy 2 — /32 point-to-point address fallback: every PPP tunnel (L2TP, PPTP)
        //              gets a /32 remote address; nothing else on a normal Windows machine does.
        const cmd =
            // Diagnostic: list all adapters so we can see what Windows actually calls them.
            `$all = (Get-NetAdapter | ForEach-Object { "$($_.Name)=[$($_.Status)]" }) -join ', ';` +
            ` Write-Output "ALL-ADAPTERS: $all";` +
            // Strategy 1: exact name.
            ` $adapter = Get-NetAdapter -Name '${this._name}' -ErrorAction SilentlyContinue;` +
            ` if ($adapter) {` +
            `   Write-Output "FOUND-BY-NAME ifIndex=$($adapter.ifIndex) status=$($adapter.Status)";` +
            `   New-NetRoute -InterfaceIndex $adapter.ifIndex -DestinationPrefix '0.0.0.0/0' -RouteMetric 5 -ErrorAction SilentlyContinue;` +
            `   Write-Output "ROUTE-ADDED"; return` +
            ` };` +
            // Strategy 2: /32 PPP point-to-point address.
            ` $ppp = Get-NetIPAddress -AddressFamily IPv4 -PrefixLength 32 -ErrorAction SilentlyContinue` +
            `   | Where-Object { $_.InterfaceAlias -notlike 'Loopback*' }` +
            `   | Select-Object -First 1;` +
            ` if ($ppp) {` +
            `   Write-Output "FOUND-BY-PPP ifIndex=$($ppp.InterfaceIndex) alias=$($ppp.InterfaceAlias) addr=$($ppp.IPAddress)";` +
            // Force interface metric to 1 so its total beats all physical adapters.
            `   Set-NetIPInterface -InterfaceIndex $ppp.InterfaceIndex -InterfaceMetric 1 -ErrorAction SilentlyContinue;` +
            // Remove any existing default route on this interface (added by Windows PPP
            // stack or a prior attempt) so we don't fight with a high-metric duplicate.
            `   Remove-NetRoute -InterfaceIndex $ppp.InterfaceIndex -DestinationPrefix '0.0.0.0/0' -Confirm:$false -ErrorAction SilentlyContinue;` +
            `   New-NetRoute -InterfaceIndex $ppp.InterfaceIndex -DestinationPrefix '0.0.0.0/0' -RouteMetric 1 -ErrorAction SilentlyContinue;` +
            // Flush the IPv4 routing cache so Windows uses the new route immediately.
            `   netsh interface ipv4 delete destinationcache | Out-Null;` +
            // Dump all default routes so we can verify ours wins.
            `   $routes = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | ForEach-Object { "if=$($_.InterfaceIndex) total=$(([int]$_.InterfaceMetric)+([int]$_.RouteMetric)) next=$($_.NextHop)" };` +
            `   Write-Output "DEFAULT-ROUTES: $($routes -join ' | ')";` +
            `   Write-Output "ROUTE-ADDED"; return` +
            ` };` +
            ` Write-Output "ADAPTER-NOT-FOUND"`;

        const r = cp.spawnSync('powershell', ['-Command', cmd], { timeout: 10_000 });
        const out = r.stdout?.toString().trim() || '';
        const err = r.stderr?.toString().trim() || '';
        this.#log(`POST-ROUTE stdout: ${out || '(none)'}`);
        if (err) this.#log(`POST-ROUTE stderr: ${err}`);
        this.#log(`POST-ROUTE exit: ${r.status}`);
    }

    async #vpnConnect() {
        const TIMEOUT_MS = 45_000;

        this.#log(`VPN-CONNECT using Connect-Vpn for ${this.type} "${this._name}" (timeout=${TIMEOUT_MS}ms)`);
        const child = cp.spawn('powershell', [
            'Connect-Vpn',
            this._name,
            this._credentials.login,
            this._credentials.password,
        ]);

        return new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', chunk => {
                const s = chunk.toString();
                stdout += s;
                this.#log(`VPN-CONNECT stdout: ${s.trim()}`);
            });
            child.stderr.on('data', chunk => {
                const s = chunk.toString();
                stderr += s;
                this.#log(`VPN-CONNECT stderr: ${s.trim()}`);
            });
            const timer = setTimeout(() => {
                this.#log(`VPN-CONNECT timeout after ${TIMEOUT_MS}ms — killing process`);
                child.kill();
                reject(new Error('VPN connection timed out after 45 seconds'));
            }, TIMEOUT_MS);
            child.on('close', code => {
                clearTimeout(timer);
                this.#log(`VPN-CONNECT process closed — exit code ${code}`);
                if (stdout.trim()) this._logStream.write(stdout);
                if (code) reject(new Error(`Subprocess exited with error ${code}:\n${stderr}`));
                else resolve(stdout);
            });
        });
    }

    async #rasdialDisconnect() {
        return await this.#logSpawn('powershell',
            ['rasdial', this._name, '/d']);
    }

    async #setDns() {
        // IpPrioritizeRemote is a PPP-level phonebook flag — it only applies to
        // PPTP and L2TP connections.  For IKEv2, routing is fully handled by
        // SplitTunneling=False and the post-connect route we add explicitly.
        // More importantly, the ini round-trip (decode → mutate → encode) risks
        // corrupting the CustomAuthData blob that holds the EAP XML config — which
        // is exactly what causes the "Invalid payload received" handshake failure.
        // Skip the phonebook write entirely for IKEv2.
        if (this.type === VpnType.IKEv2.label) {
            this.#log('SET-DNS skipping phonebook write for IKEv2 (not applicable; avoids EAP config corruption)');
            return;
        }

        this.#log(`SET-DNS reading phonebook from ${phoneBookPath}`);
        let phoneBook = decode(await readFile(phoneBookPath, 'utf-8'));

        const sectionExists = !!phoneBook[this._name];
        this.#log(`SET-DNS phonebook section "${this._name}" exists=${sectionExists}`);

        phoneBook[this._name].IpPrioritizeRemote = '1';
        this.#log('SET-DNS IpPrioritizeRemote=1 written');

        if (this._dns.value) {
            phoneBook[this._name].IpDnsAddress  = this._dns.value[0];
            phoneBook[this._name].IpDns2Address = this._dns.value[1];
            phoneBook[this._name].IpNameAssign  = '2';
            this.#log(`SET-DNS DNS1=${this._dns.value[0]} DNS2=${this._dns.value[1]} IpNameAssign=2`);
        } else {
            this.#log('SET-DNS no DNS values configured — skipping DNS entries');
        }

        writeFileSync(phoneBookPath, encode(phoneBook), 'utf-8');
        this.#log('SET-DNS phonebook written successfully');
    }

    async #logSpawn(cmd, args) {
        let result = await spawnChild(cmd, args);
        this._logStream.write(result);
        return result;
    }
}

module.exports = WindowsVpn;
