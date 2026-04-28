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
// This appends renderer-side diagnostic lines (config fetch, IP check, etc.)
// into the same .log file that WireGuard/OpenVPN use, so every troubleshooting
// session is in one place.
const logToFile = (profileId, line) => {
    if (!profileId) return;
    try { ipcRenderer.send('log-append', { profileId, line }); } catch { /* best-effort */ }
};

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

// Extract the [Interface] Address IP from a .conf file string.
const getConfInterfaceIp = confContent => {
    try {
        const match = confContent.match(/^\[Interface\][\s\S]*?^Address\s*=\s*([\d.]+)/m);
        return match ? match[1] : null;
    } catch { return null; }
};

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
    const mtuValue    = (profile.details && profile.details.mtu && profile.details.mtu.value) || '';

    logToFile(profileId, `[wgApi] serverType=${serverType}  isDedicated=${isDedicated}`);
    logToFile(profileId, `[wgApi] server="${serverLabel}"  host=${serverHost || '(using dedicated)'}`);
    logToFile(profileId, `[wgApi] MTU=${mtuValue || '(auto)'}`);

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

    // Dedicated/1:1 servers: ALWAYS fetch a fresh config before every connect.
    // The WireGuard peer entry on the server can be cleared or rotated at any time
    // (reboot, key rotation, server maintenance). Reusing a cached config causes a
    // silent handshake failure — the tunnel installs (exit 0) but never routes
    // traffic because the server no longer recognises the client's public key.
    // For shared servers the 24-hour staleness window is sufficient.
    let dedicatedStale = isDedicated; // dedicated = always stale (always re-fetch)
    if (!isDedicated && confExists) {
        try {
            const ageH     = (Date.now() - fs.statSync(confPath).mtimeMs) / 3600000;
            dedicatedStale = ageH > 24;
            logToFile(profileId, `[wgApi] shared conf age: ${ageH.toFixed(1)} h  stale=${dedicatedStale}`);
        } catch { /* ignore */ }
    }
    if (isDedicated) {
        logToFile(profileId, `[wgApi] dedicated/1:1 — always fetching fresh config`);
    }

    const needsFetch = !confExists || serverChanged || dedicatedStale;
    logToFile(profileId, `[wgApi] needsFetch=${needsFetch} (noConf=${!confExists} serverChanged=${serverChanged} stale=${dedicatedStale})`);

    if (!needsFetch) {
        logToFile(profileId, `[wgApi] Config is current — skipping fetch`);
        if (typeof onStatus === 'function') onStatus('');
        return { success: true };
    }

    // Release old server config slot when switching servers.
    // For dedicated accounts using shared servers: the PHP now correctly targets
    // the shared server slot when server= matches a shared IP.
    if (serverChanged && existingEndpointIp) {
        log(`Releasing slot on old server (${existingEndpointIp})\u2026`);
        logToFile(profileId, `[wgApi] Calling delete_config for old endpoint: ${existingEndpointIp}`);
        await deleteWgConfig({ login, password, serverHost: existingEndpointIp });
        logToFile(profileId, `[wgApi] delete_config done`);
    }

    const verb = !confExists ? 'Requesting' : 'Refreshing';
    log(`${verb} WireGuard config for "${serverLabel}"\u2026`);
    logToFile(profileId, `[wgApi] Calling get_config  server=${serverHost || '(dedicated)'}`);

    const result = await fetchWgConfig({ login, password, serverHost, mtuValue, confPath });

    if (!result.success) {
        logToFile(profileId, `[wgApi] get_config FAILED: ${result.error}`);
        return result;
    }
    logToFile(profileId, `[wgApi] get_config OK — conf written to ${confPath}`);

    // ── Internal IP uniqueness check ──────────────────────────────────────────
    // Each active WireGuard tunnel on Windows must use a unique internal IP.
    // If two .conf files share the same Address, Windows refuses the second tunnel.
    // When a clash is found: free the conflicting slot and regenerate.
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
                    const fresh = await fetchWgConfig({ login, password, serverHost, mtuValue, confPath });
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
    getConfEndpointIp,
    fetchWgConfig,
    deleteWgConfig,
    ensureWgConfig,
};
