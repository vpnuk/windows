'use strict';
// Windows CI adapter/lifecycle test. Uses the real WireGuard service/driver and
// the production config writer. Only the credentialed VPNUK API is replaced.
// This does NOT test a live VPN handshake or claim Windows 10 device coverage.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const Module = require('module');

if (process.platform !== 'win32') throw new Error('Native WireGuard checks require Windows.');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vpnuk-native-'));
process.env.APPDATA = folder;
process.env.LOCALAPPDATA = folder;
const originalLoad = Module._load;
let apiConfigs = 0;
let apiDeletes = 0;
const peer = crypto.randomBytes(32).toString('base64');
Module._load = function (name, parent, isMain) {
    if (name === 'axios' && parent.filename.endsWith(path.join('modules', 'wg-config.js'))) {
        return { post: async (url, body) => {
            const action = new URLSearchParams(body).get('action');
            if (action === 'delete_config') {
                apiDeletes++;
                return { data: { deleted: true, cleanup_confirmed: true } };
            }
            assert.equal(action, 'get_config');
            apiConfigs++;
            return { data: { config: [
                '[Interface]',
                `PrivateKey = ${crypto.randomBytes(32).toString('base64')}`,
                'Address = 10.254.254.253/32', 'MTU = 1380', '[Peer]',
                `PublicKey = ${peer}`,
                // Never redirect the runner's internet, set DNS or use a real
                // server/account. Only the adapter startup is under test.
                'AllowedIPs = 10.254.254.254/32',
                'Endpoint = 127.0.0.1:51820', '',
            ].join('\n') } };
        } };
    }
    return originalLoad.call(this, name, parent, isMain);
};

const { WireGuard, cleanupOrphanedTunnels } = require('../app/main/vpn/WireGuard');
const { settingsPath } = require('../app/modules/constants');
const { serviceState } = require('../app/main/utils/wg-tunnels');
const { readLog } = require('../app/main/utils/logs');
const profile = {
    id: '11111111-2222-4333-8444-555555555555',
    vpnType: 'WireGuard', serverType: 'shared',
    credentials: { login: 'ci-no-live-account', password: 'ci-not-a-credential' },
    server: { host: '127.0.0.1', label: 'Local adapter check' },
    details: {}, bypassIps: [],
};
let connection = null;
let priorConfig = null;
(async () => {
    try {
        cleanupOrphanedTunnels();
        for (let cycle = 1; cycle <= 2; cycle++) {
            connection = new WireGuard(profile, {
                connectedHook: () => {}, disconnectedHook: () => {},
                connectingHook: () => {}, errorHook: () => {},
            });
            await connection.connect();
            assert.equal(connection.getConnectionStatus(), 'Connected');
            assert.equal(serviceState('shared'), 4);
            const configPath = settingsPath.wgConf('shared', null, profile.id);
            const config = fs.readFileSync(configPath, 'utf8');
            if (priorConfig) assert.notEqual(config, priorConfig, 'reconnect must use fresh keys');
            priorConfig = config;
            const adapter = cp.spawnSync('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-Command',
                "$ErrorActionPreference='Stop'; $a = Get-NetAdapter -IncludeHidden -Name 'shared'; if (!$a -or $a.Status -ne 'Up') { throw 'Test adapter is not Up' }",
            ], { shell: false, windowsHide: true, encoding: 'utf8', timeout: 15000 });
            assert.equal(adapter.status, 0, 'the actual Windows network adapter must be Up');
            await connection.disconnect();
            assert.equal(serviceState('shared'), null, 'tunnel service must be removed');
            assert(!fs.existsSync(configPath), 'local keys must be removed on disconnect');
            console.log(`PASS native adapter cycle ${cycle}: service running, adapter Up, service/config removed`);
            connection = null;
        }
        assert.equal(apiConfigs, 2);
        assert.equal(apiDeletes, 4);
        assert(readLog(profile.id).includes('[WireGuard native]'), 'native diagnostics must reach the profile log');
        console.log('PASS fresh-key reconnect and native log capture (no live VPN handshake tested)');
    } catch (error) {
        console.error('Native WireGuard lifecycle check failed:', error.message);
        console.error(readLog(profile.id));
        process.exitCode = 1;
    } finally {
        try {
            if (connection) await connection.disconnect();
            cleanupOrphanedTunnels();
            fs.rmdirSync(folder, { recursive: true });
        } catch (error) {
            console.error('Native test cleanup failed:', error.message);
            process.exitCode = 1;
        }
        Module._load = originalLoad;
    }
})();
