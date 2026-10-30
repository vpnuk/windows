'use strict';
const axios = require('axios');
const fs = require('fs');
const { settingsPath } = require('./constants');
const recovery = require('./wg-recovery');
const { applyWireGuardBypass, bypassPrefixes } = require('./ip-bypass');
const primary = 'https://clientcp.vpnuk.info/vpnuk/clients/wg_v2_app_api.php';
const fallback = 'https://www.serverlistvault.com/wg/config';

function deviceLabel() {
    return recovery.deviceLabel();
}

async function request(action, profile, server, label) {
    const { login, password } = profile.credentials || {};
    if (!login || !password) throw new Error('Enter your VPN username and password first.');
    const params = new URLSearchParams({
        action, username: login, password,
        server: server === undefined ? (profile.server?.host || '') : server,
        device_label: label === undefined ? deviceLabel() : recovery.valid(label),
    });
    if (action === 'delete_config') params.set('confirm_peer_removal', '1');
    const options = { timeout: 15000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
    let response;
    try { response = await axios.post(primary, params.toString(), options); }
    catch (error) {
        if (error.response) throw new Error(`WireGuard API returned HTTP ${error.response.status}.`);
        response = await axios.post(fallback, params.toString(), options);
    }
    if (!response.data || response.data.error) throw new Error(response.data?.error || 'Invalid WireGuard API response.');
    return response.data;
}

function endpointIp(conf) {
    return conf.match(/^Endpoint\s*=\s*([\d.]+):\d+/m)?.[1] || null;
}

function confPath(profile) {
    return settingsPath.wgConf(profile.serverType || 'shared', profile.server?.dns, profile.id);
}

function removeLocalConfig(profile) {
    const file = confPath(profile);
    if (fs.existsSync(file)) fs.unlinkSync(file);
}

async function releaseConfig(profile, server, label) {
    const data = await request('delete_config', profile, server, label);
    if (data.deleted !== true || data.cleanup_confirmed !== true) {
        throw new Error('WireGuard server did not confirm config deletion. No replacement config was requested.');
    }
    return data;
}

async function releasePending(profile) {
    const saved = recovery.labels();
    recovery.remember(saved);
    for (const label of saved) await releaseConfig(profile, '', label);
    // Retain identities, not passwords: another saved account may also have
    // used this PC. It must reclaim its own peers when it next authenticates.
}

async function createConfig(profile) {
    bypassPrefixes(profile.bypassIps);
    const file = confPath(profile);
    removeLocalConfig(profile); // never start a stale config after a failed fetch
    // Compatibility rollback: get_config already reuses this device's registered
    // peer. Do not delete it first: new keys also change Windows' adapter GUID.
    // Remote deletion is now reserved for explicit uninstall cleanup.
    deviceLabel();
    const data = await request('get_config', profile);
    if (typeof data.config !== 'string' || !/^\[Interface\]/m.test(data.config) || !/^PrivateKey\s*=/m.test(data.config)) {
        throw new Error('WireGuard API did not return a valid configuration.');
    }
    let conf = data.config;
    if (profile.server?.host) {
        conf = conf.replace(/^(Endpoint\s*=\s*)([a-zA-Z0-9._-]+)(:\d+)/m, (line, prefix, host, port) =>
            /^\d+\.\d+\.\d+\.\d+$/.test(host) ? line : `${prefix}${profile.server.host}${port}`);
    }
    const details = profile.details || {};
    const setInterface = (key, value) => {
        const match = new RegExp(`^${key}\\s*=.*`, 'm');
        conf = match.test(conf) ? conf.replace(match, `${key} = ${value}`)
            : conf.replace(/(\[Interface\]\s*\r?\n)/, `$1${key} = ${value}\n`);
    };
    if (details.mtu?.value) {
        const mtu = Number(details.mtu.value);
        if (!Number.isInteger(mtu) || mtu < 576 || mtu > 9000) throw new Error('Invalid WireGuard MTU.');
        setInterface('MTU', mtu);
    }
    if (details.dns?.value?.length) setInterface('DNS', details.dns.value.join(', '));
    const allowed = details.allowedIps;
    const raw = allowed?.isCustom ? allowed.customValue?.trim() : allowed?.value;
    if (raw && raw !== 'custom') conf = conf.replace(/^AllowedIPs\s*=.*/gm, `AllowedIPs = ${raw}`);
    conf = applyWireGuardBypass(conf, profile.bypassIps);
    fs.mkdirSync(settingsPath.folder, { recursive: true });
    fs.writeFileSync(file, conf, { encoding: 'utf8', mode: 0o600 });
    return { file, server: endpointIp(conf) || profile.server?.host || '' };
}

module.exports = { createConfig, releaseConfig, releasePending, removeLocalConfig, endpointIp, confPath };
