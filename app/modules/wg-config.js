'use strict';
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const { settingsPath } = require('./constants');
const { applyWireGuardBypass, bypassPrefixes } = require('./ip-bypass');
const primary = 'https://clientcp.vpnuk.info/vpnuk/clients/wg_v2_app_api.php';
const fallback = 'https://www.serverlistvault.com/wg/config';

function deviceLabel() {
    if (fs.existsSync(settingsPath.device)) {
        const data = JSON.parse(fs.readFileSync(settingsPath.device, 'utf8'));
        // Match the API's label alphabet and limit without sanitizing or
        // replacing an existing identity. An empty API deletion label means
        // "all configs", so malformed saved labels must fail closed.
        if (typeof data.label === 'string' && /^[a-zA-Z0-9-]{1,32}$/.test(data.label)) return data.label;
        throw new Error('The saved WireGuard device identity is invalid.');
    }
    const label = `win-${crypto.randomBytes(8).toString('hex')}`;
    fs.mkdirSync(settingsPath.folder, { recursive: true });
    fs.writeFileSync(settingsPath.device, JSON.stringify({ label }), { mode: 0o600 });
    return label;
}

async function request(action, profile, server) {
    const { login, password } = profile.credentials || {};
    if (!login || !password) throw new Error('Enter your VPN username and password first.');
    const params = new URLSearchParams({
        action, username: login, password,
        server: server === undefined ? (profile.server?.host || '') : server,
        device_label: deviceLabel(),
    });
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

async function releaseConfig(profile, server) {
    const data = await request('delete_config', profile, server);
    if (data.deleted !== true) {
        throw new Error('WireGuard server did not confirm config deletion. No replacement config was requested.');
    }
    return data;
}

async function createConfig(profile) {
    bypassPrefixes(profile.bypassIps);
    const file = confPath(profile);
    let oldEndpoint = null;
    if (fs.existsSync(file)) oldEndpoint = endpointIp(fs.readFileSync(file, 'utf8'));
    removeLocalConfig(profile); // a failed API request must never reuse old keys
    if (oldEndpoint && oldEndpoint !== profile.server?.host) await releaseConfig(profile, oldEndpoint);
    // Empty server releases this device label across shared servers. This also
    // recovers a peer left by a crash after its local config was deleted.
    await releaseConfig(profile, '');
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

module.exports = { createConfig, releaseConfig, removeLocalConfig, endpointIp, confPath };
