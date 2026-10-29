'use strict';
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { settingsFolder } = require('../../modules/constants');
const { bypassPrefixes } = require('../../modules/ip-bypass');
const journalPath = path.join(settingsFolder, 'bypass-routes.json');

function powershell(script) {
    const encoded = Buffer.from(`$ErrorActionPreference='Stop'; ${script}`, 'utf16le').toString('base64');
    const result = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        { shell: false, windowsHide: true, timeout: 15000, encoding: 'utf8' });
    if (result.error || result.status !== 0) {
        const error = new Error('Could not update VPN bypass routes. Run VPNUK as administrator.');
        error.completedFailure = !result.error && Number.isInteger(result.status);
        throw error;
    }
    return result.stdout.trim();
}

function save(records) {
    fs.mkdirSync(settingsFolder, { recursive: true });
    const temporary = journalPath + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(records));
    fs.renameSync(temporary, journalPath);
}

function read() {
    return fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath, 'utf8')) : [];
}

function cleanupBypassRoutes() {
    const retained = [];
    for (const record of read()) {
        // Re-validate disk contents before inserting them into a command.
        const prefix = bypassPrefixes([record.prefix])[0];
        const gateway = bypassPrefixes([record.gateway])[0].replace('/32', '');
        const index = Number(record.index);
        if (!Number.isSafeInteger(index) || index < 1) throw new Error('Invalid bypass route journal.');
        try {
            powershell(`Get-NetRoute -DestinationPrefix '${prefix}' -InterfaceIndex ${index} -NextHop '${gateway}' -ErrorAction SilentlyContinue | Where-Object { $_.RouteMetric -eq 3 -and $_.Protocol -eq 'NetMgmt' } | Remove-NetRoute -Confirm:$false`);
        } catch (error) {
            retained.push(record);
        }
    }
    save(retained);
    if (retained.length) throw new Error('Some VPNUK bypass routes could not be removed. Retry Disconnect.');
}

function installBypassRoutes(value, gateway) {
    const prefixes = bypassPrefixes(value);
    if (!prefixes.length) return;
    const validGateway = bypassPrefixes([gateway])[0].replace('/32', '');
    const index = Number(powershell(`(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Where-Object { $_.NextHop -eq '${validGateway}' } | Sort-Object RouteMetric | Select-Object -First 1).InterfaceIndex`));
    if (!Number.isSafeInteger(index) || index < 1) throw new Error('No physical network gateway is available for IP bypass.');
    const records = read();
    for (const prefix of prefixes) {
        const exists = powershell(`@(Get-NetRoute -DestinationPrefix '${prefix}' -InterfaceIndex ${index} -ErrorAction SilentlyContinue).Count`);
        // Do not replace or later delete a route that belongs to the OS/user.
        if (Number(exists) > 0) continue;
        const record = { prefix, gateway: validGateway, index };
        records.push(record);
        save(records); // record ownership before mutation, including crash recovery
        try {
            powershell(`New-NetRoute -DestinationPrefix '${prefix}' -InterfaceIndex ${index} -NextHop '${validGateway}' -RouteMetric 3 -PolicyStore ActiveStore | Out-Null`);
        } catch (error) {
            // A definite creation failure must not claim another application's
            // route. Retain ownership only after indeterminate failures/timeouts.
            if (error.completedFailure) {
                records.pop();
                save(records);
            }
            throw error;
        }
    }
}

module.exports = { installBypassRoutes, cleanupBypassRoutes };
