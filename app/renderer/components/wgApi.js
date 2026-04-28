/**
 * wgApi.js — WireGuard API utilities (renderer process only).
 *
 * Pure CommonJS (like constants.js) so webpack doesn't trip over mixed
 * ES-module / CommonJS syntax.  Consumed via require() in .jsx components.
 *
 * ensureWgConfig() drives the full pre-connect flow:
 *   1. Validates credentials are present
 *   2. Reads existing .conf and compares Endpoint IP with current server
 *   3. If server switched → deletes old server-side config, fetches new one
 *   4. If dedicated/1:1 conf is > 24 h old → re-fetches (catches IP rotations)
 *   5. Reports progress via an optional onStatus(msg) callback
 */

const axios        = require('axios');
const fs           = require('fs');
const { settingsPath } = require('@modules/constants.js');

const WG_AUTH_URL = 'https://clientcp.vpnuk.info/vpnuk/clients/wg_v2_app_api.php';

// ── Device label ──────────────────────────────────────────────────────────────

const getDeviceLabel = () => {
    try {
        if (fs.existsSync(settingsPath.device)) {
            const data = JSON.parse(fs.readFileSync(settingsPath.device, 'utf-8'));
            if (typeof data.label === 'string' && data.label.length > 0) return data.label;
        }
    } catch { /* ignore corrupt file */ }

    const hex   = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const label = `win-${hex}`;
    try { fs.writeFileSync(settingsPath.device, JSON.stringify({ label }), 'utf-8'); } catch { /* best-effort */ }
    return label;
};

// ── Conf-string helpers ───────────────────────────────────────────────────────

// Patch Endpoint hostname → IP so WireGuard never needs DNS on connect.
const patchEndpointToIp = (conf, serverIp) => {
    if (!conf || !serverIp) return conf;
    return conf.replace(
        /^(Endpoint\s*=\s*)([a-zA-Z0-9._-]+)(\s*:\s*\d+)/m,
        (_, prefix, host, portPart) => {
            const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host);
            return isIp ? `${prefix}${host}${portPart}` : `${prefix}${serverIp}${portPart}`;
        }
    );
};

// Inject or replace the MTU line in the [Interface] section.
const applyMtu = (conf, mtuValue) => {
    if (!mtuValue) return conf;
    if (/^MTU\s*=/m.test(conf)) return conf.replace(/^MTU\s*=.*/m, `MTU = ${mtuValue}`);
    return conf.replace(/(\[Interface\][^\n]*\n)/, `$1MTU = ${mtuValue}\n`);
};

// Read Endpoint IP from a stored .conf file.
const getConfEndpointIp = confPath => {
    try {
        const content = fs.readFileSync(confPath, 'utf-8');
        const match   = content.match(/^Endpoint\s*=\s*([\d.]+):\d+/m);
        return match ? match[1] : null;
    } catch { return null; }
};

// ── Server API calls ──────────────────────────────────────────────────────────

const fetchWgConfig = async ({ login, password, serverHost, mtuValue, confPath }) => {
    const deviceLabel = getDeviceLabel();
    const params = new URLSearchParams({
        action:       'get_config',
        username:     login,
        password,
        server:       serverHost || '',
        device_label: deviceLabel,
    });

    const response = await axios.post(WG_AUTH_URL, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
        validateStatus: () => true,
    });

    if (response.data && response.data.error) {
        return { success: false, error: response.data.error };
    }

    if (response.data && response.data.config) {
        let conf = response.data.config;
        conf = patchEndpointToIp(conf, serverHost);
        conf = applyMtu(conf, mtuValue);
        fs.writeFileSync(confPath, conf, 'utf-8');
        return { success: true };
    }

    return { success: false, error: 'Unexpected response from server.' };
};

// Delete this device's config from a specific server (best-effort).
const deleteWgConfig = async ({ login, password, serverHost }) => {
    try {
        const params = new URLSearchParams({
            action:       'delete_config',
            username:     login,
            password,
            server:       serverHost || '',
            device_label: getDeviceLabel(),
        });
        await axios.post(WG_AUTH_URL, params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000,
            validateStatus: () => true,
        });
    } catch { /* ignore — deletion is best-effort */ }
};

// ── Main entry-point ──────────────────────────────────────────────────────────

/**
 * ensureWgConfig(profile, onStatus?)
 *
 * Checks whether a fresh config is needed and fetches one if so.
 * Returns { success: boolean, error?: string }.
 * onStatus(msg) is called at each step for UI progress feedback.
 */
const ensureWgConfig = async (profile, onStatus) => {
    const report = typeof onStatus === 'function' ? onStatus : () => {};

    report('Checking credentials\u2026');

    const { login, password } = profile.credentials || {};
    if (!login || !password) {
        return { success: false, error: 'Enter your username and password in the Profile tab first.' };
    }

    const serverHost  = (profile.server && profile.server.host) || '';
    const serverType  = profile.serverType || 'shared';
    const isDedicated = serverType === 'dedicated' || serverType === 'dedicated11';
    const mtuValue    = (profile.details && profile.details.mtu && profile.details.mtu.value) || '';

    if (!serverHost && !isDedicated) {
        return { success: false, error: 'Select a server in the Profile tab first.' };
    }

    report('Checking configuration\u2026');

    const confPath   = settingsPath.wgConf(serverType, null);
    const confExists = fs.existsSync(confPath);

    const existingEndpointIp = confExists ? getConfEndpointIp(confPath) : null;
    const serverChanged      = confExists && existingEndpointIp && serverHost && existingEndpointIp !== serverHost;

    // Re-check dedicated/1:1 IPs once a day to catch assigned-IP rotations.
    let dedicatedStale = false;
    if (isDedicated && confExists) {
        try {
            const ageH     = (Date.now() - fs.statSync(confPath).mtimeMs) / 3600000;
            dedicatedStale = ageH > 24;
        } catch { /* ignore */ }
    }

    const needsFetch = !confExists || serverChanged || dedicatedStale;

    if (!needsFetch) {
        report('');
        return { success: true };
    }

    // Release old server config slot when switching shared servers.
    if (serverChanged && !isDedicated && existingEndpointIp) {
        report('Releasing old server config\u2026');
        await deleteWgConfig({ login, password, serverHost: existingEndpointIp });
    }

    const verb = !confExists ? 'Generating' : 'Refreshing';
    report(verb + ' WireGuard config\u2026');

    const result = await fetchWgConfig({ login, password, serverHost, mtuValue, confPath });

    if (result.success) report('');
    return result;
};

module.exports = {
    getDeviceLabel,
    patchEndpointToIp,
    applyMtu,
    getConfEndpointIp,
    fetchWgConfig,
    deleteWgConfig,
    ensureWgConfig,
};
