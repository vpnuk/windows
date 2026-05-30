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

const axios            = require('axios');
const fs               = require('fs');
const { ipcRenderer }  = require('electron');
const { settingsPath } = require('@modules/constants.js');

// ── Log to the profile's log file via the main process ───────────────────────
const logToFile = (profileId, line) => {
    if (!profileId) return;
    try { ipcRenderer.send('log-append', { profileId, line }); } catch { /* best-effort */ }
};

// Primary WireGuard API endpoint.
const WG_AUTH_URL = 'https://clientcp.vpnuk.info/vpnuk/clients/wg_v2_app_api.php';
// Fallback proxy — used when the primary is unreachable (network error / timeout).
const WG_AUTH_FALLBACK_URL = 'https://www.serverlistvault.com/wg/config';

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

const getConfInterfaceIp = confContent => {
    try {
        const match = confContent.match(/^\[Interface\][\s\S]*?^Address\s*=\s*([\d.]+)/m);
        return match ? match[1] : null;
    } catch { return null; }
};

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

const applyMtu = (conf, mtuValue) => {
    if (!mtuValue) return conf;
    if (/^MTU\s*=/m.test(conf)) return conf.replace(/^MTU\s*=.*/m, `MTU = ${mtuValue}`);
    return conf.replace(/(\[Interface\][^\n]*\n)/, `$1MTU = ${mtuValue}\n`);
};

const applyAllowedIps = (conf, allowedIpsOption) => {
    if (!allowedIpsOption) return conf;
    const raw = allowedIpsOption.isCustom
        ? (allowedIpsOption.customValue || '').trim()
        : allowedIpsOption.value;
    if (!raw || raw === 'custom') return conf;
    const line = `AllowedIPs = ${raw}`;
    if (/^AllowedIPs\s*=/m.test(conf)) return conf.replace(/^AllowedIPs\s*=.*/m, line);
    return conf.replace(/(\[Peer\][^\n]*\n)/, `$1${line}\n`);
};

const applyDns = (conf, dnsAddresses) => {
    if (!dnsAddresses || !dnsAddresses.length) return conf;
    const dnsLine = `DNS = ${dnsAddresses.join(', ')}`;
    if (/^DNS\s*=/m.test(conf)) return conf.replace(/^DNS\s*=.*/m, dnsLine);
    if (/^Address\s*=/m.test(conf)) return conf.replace(/^(Address\s*=.*)/m, `$1\n${dnsLine}`);
    return conf.replace(/(\[Interface\][^\n]*\n)/, `$1${dnsLine}\n`);
};

const getConfEndpointIp = confPath => {
    try {
        const content = fs.readFileSync(confPath, 'utf-8');
        const match   = content.match(/^Endpoint\s*=\s*([\d.]+):\d+/m);
        return match ? match[1] : null;
    } catch { return null; }
};

// ── WireGuard API POST helper ─────────────────────────────────────────────────
// Tries the primary URL first. If a network-level error occurs (unreachable /
// timeout), automatically retries against the fallback proxy.
const postWgApi = async (params, timeout = 15000) => {
    const opts = {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout,
        validateStatus: () => true,
    };
    try {
        return await axios.post(WG_AUTH_URL, params.toString(), opts);
    } catch (primaryErr) {
        // Primary unreachable — try fallback proxy silently.
        return axios.post(WG_AUTH_FALLBACK_URL, params.toString(), opts);
    }
};

// ── Server API calls ──────────────────────────────────────────────────────────

const fetchWgConfig = async ({ login, password, serverHost, mtuValue, dnsAddresses, allowedIpsOption, confPath }) => {
    const deviceLabel = getDeviceLabel();
    const params = new URLSearchParams({
        action:       'get_config',
        username:     login,
        password,
        server:       serverHost || '',
        device_label: deviceLabel,
    });

    const response = await postWgApi(params);

    if (response.data && response.data.error) {
        return { success: false, error: response.data.error };
    }

    if (response.data && response.data.config) {
        let conf = response.data.config;
        conf = patchEndpointToIp(conf, serverHost);
        conf = applyMtu(conf, mtuValue);
        conf = applyDns(conf, dnsAddresses);
        conf = applyAllowedIps(conf, allowedIpsOption);
        fs.writeFileSync(confPath, conf, 'utf-8');
        return { success: true };
    }

    return { success: false, error: 'Unexpected response from server.' };
};

const deleteWgConfig = async ({ login, password, serverHost }) => {
    try {
        const params = new URLSearchParams({
            action:       'delete_config',
            username:     login,
            password,
            server:       serverHost || '',
            device_label: getDeviceLabel(),
        });
        await postWgApi(params, 10000);
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
    const profileId = profile.id || '';
    const log = (msg) => {
        if (typeof onStatus === 'function' && msg) onStatus(msg);
        logToFile(profileId, `[wgApi] ${msg}`);
    };

    log('Checking credentials\u2026');

    const { login, password } = profile.credentials || {};
    if (!login || !password) {
        const err = 'Enter your username and password in the Profile tab first.';
        logToFile(profileId, `[wgApi] ERROR: ${err}`);
        return { success: false, error: err };
    }
    logToFile(profileId, `[wgApi] login: ${login}`);

    const serverHost  = (profile.server && profile.server.host) || '';
    const serverLabel = (profile.server && profile.server.label) || '(none)';
    const serverType  = profile.serverType || 'shared';
    const isDedicated = serverType === 'dedicated' || serverType === 'dedicated11';
    const mtuValue       = (profile.details && profile.details.mtu && profile.details.mtu.value) || '';
    const dnsValue       = (profile.details && profile.details.dns && profile.details.dns.value) || [];
    const allowedIpsOpt  = (profile.details && profile.details.allowedIps) || null;

    logToFile(profileId, `[wgApi] serverType=${serverType}  isDedicated=${isDedicated}`);
    logToFile(profileId, `[wgApi] server="${serverLabel}"  host=${serverHost || '(using dedicated)'}`);
    logToFile(profileId, `[wgApi] MTU=${mtuValue || '(auto)'}`);
    logToFile(profileId, `[wgApi] DNS=${dnsValue.length ? dnsValue.join(', ') : '(server default)'}`);

    if (!serverHost && !isDedicated) {
        const err = 'Select a server in the Profile tab first.';
        logToFile(profileId, `[wgApi] ERROR: ${err}`);
        return { success: false, error: err };
    }

    log('Checking local config\u2026');

    const confPath   = settingsPath.wgConf(serverType, null);
    const confExists = fs.existsSync(confPath);
    logToFile(profileId, `[wgApi] confPath=${confPath}  exists=${confExists}`);

    const existingEndpointIp = confExists ? getConfEndpointIp(confPath) : null;
    const serverChanged      = confExists && existingEndpointIp && serverHost && existingEndpointIp !== serverHost;

    logToFile(profileId, `[wgApi] existingEndpointIp=${existingEndpointIp || '(none)'}  serverChanged=${serverChanged}`);

    // Always fetch a fresh config before every connect for ALL server types.
    logToFile(profileId, `[wgApi] always fetching fresh config before connect`);
    const needsFetch = true;
    logToFile(profileId, `[wgApi] needsFetch=true (confExists=${confExists} serverChanged=${serverChanged})`);

    if (serverChanged && existingEndpointIp) {
        log(`Releasing slot on old server (${existingEndpointIp})\u2026`);
        logToFile(profileId, `[wgApi] Calling delete_config for old endpoint: ${existingEndpointIp}`);
        await deleteWgConfig({ login, password, serverHost: existingEndpointIp });
        logToFile(profileId, `[wgApi] delete_config done`);
    }

    const verb = !confExists ? 'Requesting' : 'Refreshing';
    log(`${verb} WireGuard config for "${serverLabel}"\u2026`);
    logToFile(profileId, `[wgApi] Calling get_config  server=${serverHost || '(dedicated)'}`);

    const result = await fetchWgConfig({ login, password, serverHost, mtuValue, dnsAddresses: dnsValue, allowedIpsOption: allowedIpsOpt, confPath });

    if (!result.success) {
        logToFile(profileId, `[wgApi] get_config FAILED: ${result.error}`);
        return result;
    }
    logToFile(profileId, `[wgApi] get_config OK — conf written to ${confPath}`);

    if (mtuValue) log(`Custom MTU (${mtuValue}) applied \u2713`);
    if (dnsValue.length) log(`Custom DNS (${dnsValue.join(', ')}) applied \u2713`);

    // ── Internal IP uniqueness check ──────────────────────────────────────────
    try {
        const newConf  = fs.readFileSync(confPath, 'utf-8');
        const newIp    = getConfInterfaceIp(newConf);
        logToFile(profileId, `[wgApi] New conf internal IP: ${newIp || '(not found)'}`);

        const allTypes = ['shared', 'dedicated', 'dedicated11'];
        const others   = allTypes.filter(t => t !== serverType);

        for (const otherType of others) {
            const otherPath = settingsPath.wgConf(otherType, null);
            if (!fs.existsSync(otherPath)) continue;
            try {
                const otherConf = fs.readFileSync(otherPath, 'utf-8');
                const otherIp   = getConfInterfaceIp(otherConf);
                logToFile(profileId, `[wgApi] Other conf (${otherType}) internal IP: ${otherIp || '(not found)'}`);
                if (newIp && otherIp && newIp === otherIp) {
                    log(`Resolving internal IP conflict (${newIp})\u2026`);
                    logToFile(profileId, `[wgApi] IP CONFLICT with ${otherType} conf — deleting and regenerating`);
                    await deleteWgConfig({ login, password, serverHost });
                    logToFile(profileId, `[wgApi] delete_config done (conflict resolution)`);
                    const fresh = await fetchWgConfig({ login, password, serverHost, mtuValue, dnsAddresses: dnsValue, allowedIpsOption: allowedIpsOpt, confPath });
                    if (!fresh.success) {
                        logToFile(profileId, `[wgApi] Regeneration FAILED: ${fresh.error}`);
                        return fresh;
                    }
                    const resolvedConf = fs.readFileSync(confPath, 'utf-8');
                    logToFile(profileId, `[wgApi] Regenerated conf internal IP: ${getConfInterfaceIp(resolvedConf) || '(not found)'}`);
                    break;
                }
            } catch { /* skip unreadable conf files */ }
        }
    } catch { /* IP check is best-effort */ }

    logToFile(profileId, `[wgApi] Config ready — proceeding to connect`);
    if (typeof onStatus === 'function') onStatus('');
    return { success: true };
};

module.exports = {
    getDeviceLabel,
    patchEndpointToIp,
    applyMtu,
    applyAllowedIps,
    getConfEndpointIp,
    fetchWgConfig,
    deleteWgConfig,
    ensureWgConfig,
};
