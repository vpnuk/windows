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
const { createIkev2ProfileCommand, createIkev2IpsecCommand } = require('../../modules/windows-ikev2');

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

        this.#log('Running IKEv2 pre-flight (DisableStrictCertificateChecking)');
        this.#prepareIkev2();

        try {
            this.#log('STEP 1 — Add-VpnConnection (creating profile)');
            await this.#addConnection();
            this.#log('STEP 1 complete — profile created');

            this.#log('STEP 2 — Writing phonebook (IpPrioritizeRemote + DNS)');
            await this.#setDns();
            this.#log('STEP 2 complete — phonebook written');

            this.#log('IKEv2 — waiting 600 ms for profile to settle before connecting');
            await new Promise(r => setTimeout(r, 600));

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
            if (this.type === VpnType.IKEv2.label) {
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

        const isIkev2 = this.type === VpnType.IKEv2.label;
        this.#log(`ADD-CONNECTION TunnelType=${this.type} ServerAddress=${serverAddress} AuthMethod=${isIkev2 ? 'Eap (EAP-MSCHAPv2, type 26)' : 'MSChapv2'} SplitTunneling=false`);

        const cmd = isIkev2 ? createIkev2ProfileCommand(this._name, serverAddress) : [
            'Add-VpnConnection',
            `-Name '${this._name}'`,
            `-TunnelType ${this.type}`,
            `-ServerAddress ${serverAddress}`,
            `-AuthenticationMethod MSChapv2`,
            `-SplitTunneling:$false`,
            `-Force -RememberCredential -PassThru`,
        ].join(' ');

        const result = await this.#logSpawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd]);

        this.#log(`ADD-CONNECTION output: ${result?.trim() || '(none)'}`);

        // IKEv2 only: match the existing VPNUK server proposals.
        // EAP configuration is supplied atomically when the profile is created.
        if (this.type === VpnType.IKEv2.label) {
            this.#log('IKEv2 — applying IKE AES-256/SHA-384/Group 2; ESP AES-256/SHA-1; PFS None');
            await this.#setIkev2IpsecConfig();
        }

        return result;
    }

    async #setIkev2IpsecConfig() {
        const cmd = createIkev2IpsecCommand(this._name);
        try {
            const result = await this.#logSpawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd]);
            this.#log(`IKEv2-IPSEC result: ${result?.trim() || '(none)'}`);
        } catch (err) {
            this.#log(`IKEv2-IPSEC config failed — connection stopped: ${err.message}`);
            throw err;
        }
    }

    #applyPostConnectRoute() {
        this.#log(`POST-ROUTE looking up adapter name="${this._name}"`);
        // ─── IMPORTANT — L2TP/IPSec routing safety ────────────────────────────
        // L2TP uses IPSec to encrypt the tunnel.  The IPSec Security Association
        // (SA) is maintained over the PHYSICAL interface (WiFi) directly to the
        // VPN server IP.  If we change the PPP adapter's interface metric or flush
        // the destination cache, Windows can route IPSec SA traffic through the
        // PPP tunnel itself — a routing loop that:
        //   • breaks the IPSec SA (no more tunnel)
        //   • drops all traffic (appears as "no internet")
        //   • causes the WiFi icon to show "no connection" (NCSI probe fails)
        // This does NOT affect PPTP because PPTP has no IPSec layer.
        //
        // Safe strategy:
        //   1. Add a /32 host route for the VPN server via the current physical
        //      gateway FIRST — this pins IPSec SA traffic to WiFi regardless of
        //      what happens to the default route.
        //   2. Add a low-metric 0.0.0.0/0 default route on the PPP adapter.
        //   Do NOT touch interface metrics or flush the destination cache.
        const serverHost = this._server.host;
        const cmd =
            `$all = (Get-NetAdapter | ForEach-Object { "$($_.Name)=[$($_.Status)]" }) -join ', ';` +
            ` Write-Output "ALL-ADAPTERS: $all";` +
            // Find the PPP adapter — exact name first, /32 fallback.
            ` $adapter = Get-NetAdapter -Name '${this._name}' -ErrorAction SilentlyContinue;` +
            ` if ($adapter) {` +
            `   Write-Output "FOUND-BY-NAME ifIndex=$($adapter.ifIndex) status=$($adapter.Status)";` +
            `   $pppIdx = $adapter.ifIndex` +
            ` } else {` +
            `   $ppp = Get-NetIPAddress -AddressFamily IPv4 -PrefixLength 32 -ErrorAction SilentlyContinue` +
            `     | Where-Object { $_.InterfaceAlias -notlike 'Loopback*' }` +
            `     | Select-Object -First 1;` +
            `   if ($ppp) {` +
            `     Write-Output "FOUND-BY-PPP ifIndex=$($ppp.InterfaceIndex) alias=$($ppp.InterfaceAlias) addr=$($ppp.IPAddress)";` +
            `     $pppIdx = $ppp.InterfaceIndex` +
            `   } else {` +
            `     Write-Output "ADAPTER-NOT-FOUND"; return` +
            `   }` +
            ` };` +
            // Step 1: pin VPN server to physical interface so the IPSec SA survives.
            ` $physRoute = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue` +
            `   | Where-Object { $_.InterfaceIndex -ne $pppIdx }` +
            `   | Sort-Object { [int]$_.InterfaceMetric + [int]$_.RouteMetric }` +
            `   | Select-Object -First 1;` +
            ` if ($physRoute) {` +
            `   New-NetRoute -InterfaceIndex $physRoute.InterfaceIndex -DestinationPrefix '${serverHost}/32' -NextHop $physRoute.NextHop -RouteMetric 1 -ErrorAction SilentlyContinue;` +
            `   Write-Output "VPN-SERVER-PROTECTED: server=${serverHost} via if=$($physRoute.InterfaceIndex) gw=$($physRoute.NextHop)"` +
            ` };` +
            // Step 2: add the default route via PPP (low metric beats WiFi).
            ` New-NetRoute -InterfaceIndex $pppIdx -DestinationPrefix '0.0.0.0/0' -RouteMetric 1 -ErrorAction SilentlyContinue;` +
            // Diagnostic dump.
            ` $routes = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | ForEach-Object { "if=$($_.InterfaceIndex) total=$(([int]$_.InterfaceMetric)+([int]$_.RouteMetric)) next=$($_.NextHop)" };` +
            ` Write-Output "DEFAULT-ROUTES: $($routes -join ' | ')";` +
            ` Write-Output "ROUTE-ADDED"`;

        const r = cp.spawnSync('powershell', ['-Command', cmd], { timeout: 10_000 });
        const out = r.stdout?.toString().trim() || '';
        const err = r.stderr?.toString().trim() || '';
        this.#log(`POST-ROUTE stdout: ${out || '(none)'}`);
        if (err) this.#log(`POST-ROUTE stderr: ${err}`);
        this.#log(`POST-ROUTE exit: ${r.status}`);
    }

    async #vpnConnectIkev2(timeoutMs) {
        // Supply the VPNUK credentials to native RAS, without shell interpolation.
        // The connection profile selects EAP-MSCHAPv2, not Windows logon credentials.
        this.#log(`VPN-CONNECT using rasdial for IKEv2 "${this._name}" (timeout=${timeoutMs}ms)`);

        const child = cp.spawn(
            'rasdial',
            [this._name, this._credentials.login, this._credentials.password],
            { shell: false }
        );

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
                this.#log(`VPN-CONNECT IKEv2 timeout after ${timeoutMs}ms — killing process`);
                child.kill();
                reject(new Error('VPN connection timed out after 45 seconds'));
            }, timeoutMs);
            child.on('error', err => {
                clearTimeout(timer);
                reject(new Error(`Unable to start Windows IKEv2 dialler: ${err.message}`));
            });
            child.on('close', code => {
                clearTimeout(timer);
                this.#log(`VPN-CONNECT IKEv2 rasdial closed — exit code ${code}`);
                if (stdout.trim()) this._logStream.write(stdout);
                if (code) reject(new Error(`rasdial exited with error ${code}:\n${stdout}\n${stderr}`));
                else resolve(stdout);
            });
        });
    }

    async #vpnConnect() {
        const TIMEOUT_MS = 45_000;

        // IKEv2 uses the EAP profile created above and native RAS credentials.
        if (this.type === VpnType.IKEv2.label) {
            return this.#vpnConnectIkev2(TIMEOUT_MS);
        }

        this.#log(`VPN-CONNECT using rasdial for ${this.type} "${this._name}" (timeout=${TIMEOUT_MS}ms)`);
        const rasArgs = [this._name, this._credentials.login, this._credentials.password];
        const child = cp.spawn('rasdial', rasArgs, { shell: true });

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
