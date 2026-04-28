import React, { useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { action } from 'mobx';
import '@components/index.css';
import { useStore } from '@domain';
import { settingsPath } from '@modules/constants.js';

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const WG_AUTH_URL = 'https://clientcp.vpnuk.info/vpnuk/clients/wg_v2_app_api.php';

// Return a persistent per-installation device label such as "win-a3f7b2c1".
// The label is generated once, written to %APPDATA%\VPNUK\device.json, and
// reused on every subsequent fetch — so this installation always maps to the
// same keypair and internal IP on the server, and never collides with another
// device belonging to the same account.
const getDeviceLabel = () => {
    try {
        if (fs.existsSync(settingsPath.device)) {
            const data = JSON.parse(fs.readFileSync(settingsPath.device, 'utf-8'));
            if (typeof data.label === 'string' && data.label.length > 0) return data.label;
        }
    } catch { /* ignore corrupt file — regenerate below */ }

    // Generate: "win-" + 8 random lowercase hex chars
    const hex   = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const label = `win-${hex}`;
    try { fs.writeFileSync(settingsPath.device, JSON.stringify({ label }), 'utf-8'); } catch { /* best-effort */ }
    return label;
};

// Write to the profile's VPN log file so it appears in the LOG tab.
// vpnuk-wg.conf lives in settingsFolder; logs/ is a sibling directory.
const makeLogAppender = confPath => (profileId, msg) => {
    try {
        const logDir  = path.join(path.dirname(confPath), 'logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const logFile = path.join(logDir, `${profileId}.log`);
        const line    = `[${new Date().toISOString()}] ${msg}\n`;
        fs.appendFileSync(logFile, line, 'utf-8');
    } catch { /* best-effort */ }
};

// Replace the Endpoint hostname with the server IP in a WireGuard conf
const patchEndpointToIp = (conf, serverIp) => {
    if (!conf || !serverIp) return conf;
    return conf.replace(
        /^(Endpoint\s*=\s*)([a-zA-Z0-9._-]+)(\s*:\s*\d+)/m,
        (_, prefix, host, portPart) => {
            // Only replace if host is not already an IP
            const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host);
            return isIp ? `${prefix}${host}${portPart}` : `${prefix}${serverIp}${portPart}`;
        }
    );
};

const WireGuardDetails = observer(() => {
    const store   = useStore();
    const profile = store.profiles.currentProfile;
    const [status, setStatus] = useState('');
    const [statusType, setStatusType] = useState('');
    const [loading, setLoading] = useState(false);

    const serverDns  = profile.server?.dns  || '';
    const serverHost = profile.server?.host || '';     // IP address
    const isShared   = profile.serverType === 'shared';

    // Config file path (DNS slug: shared32.vpnuk.net → shared32.conf)
    const confPath  = settingsPath.wgConf(profile.id, serverDns);
    const confName  = path.basename(confPath);
    const confDir   = path.dirname(confPath);
    const log       = makeLogAppender(confPath);

    useEffect(() => {
        setStatus('');
        setStatusType('');
    }, [profile.id, serverDns]);

    const configExists = () => {
        try { return fs.existsSync(confPath); }
        catch { return false; }
    };

    const fetchConfig = async () => {
        const { login, password } = profile.credentials;
        if (!login || !password) {
            setStatus('Enter your username and password in the Profile tab first.');
            setStatusType('error');
            return;
        }
        if (!serverHost) {
            setStatus('No server assigned to this profile. Check the Profile tab.');
            setStatusType('error');
            return;
        }

        setLoading(true);
        setStatus('Fetching WireGuard configuration...');
        setStatusType('');

        log(profile.id, `=== WireGuard Config Fetch ===`);
        log(profile.id, `serverType : ${profile.serverType}`);
        log(profile.id, `serverDns  : ${serverDns}`);
        log(profile.id, `serverHost : ${serverHost}`);
        log(profile.id, `confPath   : ${confPath}`);

        // For shared accounts the API uses server (IP) to select the right server.
        // For dedicated/1:1 accounts the API ignores this param and uses the server
        // assigned to the account record — sending the IP is harmless.
        //
        // device_label is a persistent per-installation identifier (e.g. "win-a3f7b2c1").
        // The server uses it to look up — or create — a config exclusively for this
        // device, so two machines on the same account NEVER share a keypair or
        // internal IP address.
        const deviceLabel = getDeviceLabel();
        const body = {
            action:       'get_config',
            username:     login,
            password,
            server:       serverHost,
            device_label: deviceLabel,
        };

        log(profile.id, `POST server="${serverHost}" device_label="${deviceLabel}"`);

        try {
            const params   = new URLSearchParams(body);
            const response = await axios.post(WG_AUTH_URL, params.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 15000,
                validateStatus: () => true,
            });

            log(profile.id, `HTTP ${response.status} : ${JSON.stringify(response.data)}`);

            if (response.data?.error) {
                const errMsg = response.data.error;
                log(profile.id, `API error: ${errMsg}`);
                setStatus(errMsg);
                setStatusType('error');

            } else if (response.data?.config) {
                const rawConf     = response.data.config;
                const patchedConf = patchEndpointToIp(rawConf, serverHost);

                const endpointRaw     = (rawConf.match(/^Endpoint\s*=.+/m)     || [''])[0];
                const endpointPatched = (patchedConf.match(/^Endpoint\s*=.+/m) || [''])[0];

                log(profile.id, `Endpoint original : ${endpointRaw}`);
                log(profile.id, `Endpoint patched  : ${endpointPatched}`);

                fs.writeFileSync(confPath, patchedConf, 'utf-8');
                action(() => { profile.wgConfigFetched = !profile.wgConfigFetched; })();

                setStatus(`Config saved: ${confName}  (${confDir})`);
                setStatusType('ok');
                log(profile.id, `Config written to: ${confPath}`);

            } else {
                log(profile.id, `Unexpected response: ${JSON.stringify(response.data)}`);
                setStatus('Unexpected response from server. Check the LOG tab.');
                setStatusType('error');
            }
        } catch (err) {
            log(profile.id, `Fetch exception: ${err.message}`);
            setStatus(
                err.code === 'ECONNABORTED'
                    ? 'Request timed out. Check your internet connection.'
                    : 'Could not reach the VPNUK server. Check your connection and try again.'
            );
            setStatusType('error');
        } finally {
            setLoading(false);
        }
    };

    const clearConfig = () => {
        try {
            if (fs.existsSync(confPath)) fs.unlinkSync(confPath);
            action(() => { profile.wgConfigFetched = !profile.wgConfigFetched; })();
            setStatus('Config cleared. Fetch again to reconnect.');
            setStatusType('');
            log(profile.id, `Config cleared: ${confPath}`);
        } catch {
            setStatus('Failed to clear config.');
            setStatusType('error');
        }
    };

    const hasConfig = configExists();

    return (
        <div style={{ paddingTop: 8 }}>
            <div className="app-notification app-notification--info">
                <span className="app-notification-icon">🔒</span>
                <div className="app-notification-body">
                    <h4>WireGuard</h4>
                    <p>
                        {!isShared
                            ? 'Your dedicated config will be fetched from your account. Click below to download it.'
                            : 'A config will be generated for the selected server. Switch servers and fetch again for each one.'
                        }
                    </p>
                    {hasConfig && (
                        <p style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 0' }}>
                            Saved: {confName}
                        </p>
                    )}
                </div>
            </div>

            <div className="wg-fetch-section">
                <button
                    className="form-button"
                    onClick={fetchConfig}
                    disabled={loading}
                >
                    {loading ? 'Fetching...' : hasConfig ? 'Refresh Config' : 'Fetch WireGuard Config'}
                </button>

                {hasConfig && !loading && (
                    <button
                        className="form-button form-button--danger"
                        onClick={clearConfig}
                        style={{ marginTop: 6 }}
                    >
                        Clear Config
                    </button>
                )}

                {status && (
                    <p className={`wg-status ${statusType}`}>{status}</p>
                )}
            </div>
        </div>
    );
});

export default WireGuardDetails;
