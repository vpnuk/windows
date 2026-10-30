'use strict';
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { settingsFolder } = require('../../modules/constants');

function run(file, args, timeout = 10000) {
    const result = cp.spawnSync(file, args, { shell: false, windowsHide: true, timeout, encoding: 'utf8' });
    if (result.error) throw result.error;
    return result;
}

function serviceName(tunnel) {
    if (!/^[a-zA-Z0-9_=+.-]{1,64}$/.test(tunnel)) throw new Error('Invalid WireGuard tunnel name.');
    return `WireGuardTunnel$${tunnel}`;
}

function serviceState(tunnel) {
    const result = run('sc.exe', ['query', serviceName(tunnel)]);
    if (result.status === 1060 || /FAILED\s+1060/.test(result.stdout)) return null;
    if (result.status !== 0) throw new Error(`Cannot query VPNUK tunnel (${result.status}).`);
    // sc.exe localizes field labels. TYPE and STATE remain the first two
    // numeric fields even when the literal word STATE is translated.
    const numericFields = result.stdout.match(/^[ \t]+[^:\r\n]+:\s*\d+\b/gm) || [];
    const match = result.stdout.match(/STATE\s*:\s*(\d+)/)
        || numericFields[1]?.match(/:\s*(\d+)/);
    if (!match) throw new Error('Cannot determine WireGuard service state safely.');
    return Number(match[1]);
}

function stopTunnel(tunnel) {
    let state = serviceState(tunnel);
    if (state !== null && state !== 1) {
        run('sc.exe', ['stop', serviceName(tunnel)]);
        for (let attempt = 0; attempt < 15; attempt++) {
            state = serviceState(tunnel);
            if (state === null || state === 1) break;
            run('ping.exe', ['-n', '2', '127.0.0.1'], 3000);
        }
        if (state !== null && state !== 1) {
            throw new Error('WireGuard did not stop. Its service and config were retained; try Disconnect again.');
        }
    }
    return state;
}

function stopAndRemoveTunnel(tunnel, wgExe) {
    const state = stopTunnel(tunnel);
    if (state === null) return;
    if (wgExe && fs.existsSync(wgExe)) {
        const result = run(wgExe, ['/uninstalltunnelservice', tunnel], 15000);
        if (result.status !== 0 && serviceState(tunnel) !== null) {
            throw new Error(`WireGuard could not remove its stopped tunnel (${result.status}).`);
        }
    } else {
        // Works even when WireGuard was removed outside VPNUK. Never delete a
        // running service: stopping it first lets WireGuardNT release its adapter.
        const result = run('sc.exe', ['delete', serviceName(tunnel)]);
        if (result.status !== 0 && serviceState(tunnel) !== null) {
            throw new Error('Could not delete the stopped VPNUK tunnel service.');
        }
    }
    if (serviceState(tunnel) !== null) throw new Error('WireGuard tunnel is still pending removal. Retry Disconnect.');
}

async function stopSessionTunnel(tunnel, wgExe) {
    if (!wgExe || !fs.existsSync(wgExe)) {
        // Only the external-uninstall recovery path needs raw Service Control
        // deletion. Normal sessions use WireGuard's own uninstaller as in 1.3.8.
        stopAndRemoveTunnel(tunnel, null);
        return;
    }
    stopTunnel(tunnel);
    // 1.3.8 waited for the native uninstaller's close event before installing
    // the next tunnel. Keep that ordering instead of the replacement sync path.
    await new Promise((resolve, reject) => {
        let timer;
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error); else resolve();
        };
        const proc = cp.spawn(wgExe, ['/uninstalltunnelservice', tunnel],
            { shell: false, windowsHide: true });
        timer = setTimeout(() => finish(new Error('WireGuard tunnel removal timed out. No replacement tunnel was started.')), 15000);
        proc.once('error', error => finish(error));
        proc.once('close', code => {
            try {
                // WireGuard returns an error when no service existed. That is
                // harmless only when Service Control confirms it is absent.
                if (serviceState(tunnel) !== null) {
                    finish(new Error(`WireGuard tunnel removal is incomplete (${code}).`));
                } else finish();
            } catch (error) { finish(error); }
        });
    });
}

function findOwnedTunnels() {
    // Avoid PowerShell/CIM startup entirely. A slow/unavailable WMI provider
    // must not prevent startup cleanup on an otherwise usable Windows system.
    const result = run('sc.exe', ['query', 'type=', 'service', 'state=', 'all', 'bufsize=', '262144']);
    if (result.status !== 0) throw new Error('Could not enumerate WireGuard services. Cleanup was not completed.');
    // Match the stable service-name value, not the localized field label.
    const names = [...new Set(
        [...String(result.stdout || '').matchAll(/^[^:\r\n]+:\s*(WireGuardTunnel\$[a-zA-Z0-9_=+.-]{1,64})[ \t]*\r?$/gm)]
            .map(match => match[1])
    )];
    const folder = settingsFolder.toLowerCase().replace(/\//g, '\\') + '\\';
    const owned = [];
    for (const name of names) {
        const config = run('sc.exe', ['qc', name]);
        if (config.status === 1060) continue; // removed between enumeration/query
        if (config.status !== 0) throw new Error('Could not verify WireGuard service ownership. Cleanup was not completed.');
        // Only inspect the command containing /tunnelservice; a display name
        // or a similar folder name is not proof that this app owns a tunnel.
        const command = String(config.stdout || '').split(/\r?\n/)
            .find(line => /\/tunnelservice(?:[ \t]|$)/i.test(line));
        const argument = String(command || '').match(/\/tunnelservice[ \t]+(?:"([^"]+)"|([^ \t\r\n]+))/i);
        const configPath = argument && (argument[1] || argument[2]);
        if (configPath && path.win32.dirname(configPath).toLowerCase() + '\\' === folder) {
            owned.push(name.slice('WireGuardTunnel$'.length));
        }
    }
    return owned;
}

function cleanupOwnedTunnels(wgExe) {
    for (const tunnel of findOwnedTunnels()) stopAndRemoveTunnel(tunnel, wgExe);
    // All owned services are now gone; private keys no longer need to be on disk.
    if (fs.existsSync(settingsFolder)) {
        for (const file of fs.readdirSync(settingsFolder)) {
            if (/^(shared|dedicated|11dedicated|vpnuk-[a-z0-9_-]+)\.conf$/i.test(file)) {
                fs.unlinkSync(path.join(settingsFolder, file));
            }
        }
    }
}

module.exports = { serviceState, stopAndRemoveTunnel, stopSessionTunnel, cleanupOwnedTunnels, findOwnedTunnels };
