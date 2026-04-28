/**
 * WireGuardDetails — Configuration status panel shown in the WireGuard tab.
 *
 * Auto-fetch on connect is handled entirely in ConnectionButton / wgApi.js.
 * This panel just shows what config is currently stored and lets the user
 * manually refresh or clear it.
 */

import React, { useState } from 'react';
import { action }          from 'mobx';
import { observer }        from 'mobx-react-lite';
import '@components/index.css';
import { useStore }        from '@domain';
import { settingsPath }    from '@modules/constants.js';
import {
    fetchWgConfig,
    deleteWgConfig,
    getConfEndpointIp,
    getDeviceLabel,
} from '@components/wgApi.js';

const fs          = require('fs');
const path        = require('path');
const { shell }   = require('electron');

const MANAGE_URL = 'https://clientcp.vpnuk.info/vpnuk/clients/wireguard_v2.php';

const WireGuardDetails = observer(() => {
    const store   = useStore();
    const profile = store.profiles.currentProfile;

    const [status,     setStatus]     = useState('');
    const [statusType, setStatusType] = useState('');   // '' | 'ok' | 'error'
    const [loading,    setLoading]    = useState(false);

    const serverType = profile.serverType || 'shared';
    const serverHost = profile.server?.host || '';
    const mtuValue   = profile.details?.mtu?.value || '';
    const confPath   = settingsPath.wgConf(serverType, null);
    const confName   = path.basename(confPath);

    const confExists      = (() => { try { return fs.existsSync(confPath); } catch { return false; } })();
    const endpointIp      = confExists ? getConfEndpointIp(confPath) : null;
    const serverMismatch  = confExists && endpointIp && serverHost && endpointIp !== serverHost;

    const handleRefresh = async () => {
        const { login, password } = profile.credentials || {};
        if (!login || !password) {
            setStatus('Enter credentials in the Profile tab first.');
            setStatusType('error');
            return;
        }
        if (!serverHost) {
            setStatus('Select a server in the Profile tab first.');
            setStatusType('error');
            return;
        }

        setLoading(true);
        setStatus('Fetching config…');
        setStatusType('');

        try {
            const result = await fetchWgConfig({ login, password, serverHost, mtuValue, confPath });
            if (result.success) {
                action(() => { profile.wgConfigFetched = !profile.wgConfigFetched; })();
                setStatus(`Saved: ${confName}`);
                setStatusType('ok');
            } else {
                setStatus(result.error || 'Fetch failed.');
                setStatusType('error');
            }
        } catch (err) {
            setStatus(err.message || 'Fetch failed.');
            setStatusType('error');
        } finally {
            setLoading(false);
        }
    };

    const handleClear = async () => {
        const { login, password } = profile.credentials || {};

        // Attempt to remove from server too (best-effort)
        if (login && password && endpointIp) {
            try { await deleteWgConfig({ login, password, serverHost: endpointIp }); } catch { /* ignore */ }
        }

        try {
            if (confExists) fs.unlinkSync(confPath);
            action(() => { profile.wgConfigFetched = !profile.wgConfigFetched; })();
            setStatus('Config cleared. A new one will be fetched on Connect.');
            setStatusType('');
        } catch {
            setStatus('Failed to clear config file.');
            setStatusType('error');
        }
    };

    const isLimitError = status.toLowerCase().includes('config limit');

    return (
        <div style={{ paddingTop: 8 }}>

            {/* ── Status card ─────────────────────────────────────────────── */}
            <div className="app-notification app-notification--info">
                <span className="app-notification-icon">🔒</span>
                <div className="app-notification-body">
                    <h4>WireGuard — Auto-Connect</h4>
                    <p>
                        Your config is generated and saved automatically when you click{' '}
                        <strong>Connect</strong>. If you switch servers the old config is
                        released and a new one fetched seamlessly.
                    </p>

                    {confExists && !serverMismatch && (
                        <p style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 0' }}>
                            Active config: <strong>{confName}</strong>
                            {endpointIp ? ` · Endpoint ${endpointIp}` : ''}
                        </p>
                    )}

                    {serverMismatch && (
                        <p style={{ fontSize: 11, color: '#e67e22', margin: '4px 0 0' }}>
                            ⚠ Config is for a different server ({endpointIp}) — will be
                            refreshed automatically on next Connect.
                        </p>
                    )}

                    {!confExists && (
                        <p style={{ fontSize: 11, opacity: 0.6, margin: '4px 0 0' }}>
                            No config saved yet — will be generated on Connect.
                        </p>
                    )}
                </div>
            </div>

            {/* ── Manual controls ─────────────────────────────────────────── */}
            <div className="wg-fetch-section">
                <button
                    className="form-button"
                    onClick={handleRefresh}
                    disabled={loading}
                >
                    {loading ? 'Fetching…' : confExists ? 'Refresh Config' : 'Fetch Config Now'}
                </button>

                {confExists && !loading && (
                    <button
                        className="form-button form-button--danger"
                        onClick={handleClear}
                        style={{ marginTop: 6 }}
                    >
                        Clear Config
                    </button>
                )}

                {/* Config-limit warning with manage link */}
                {isLimitError && (
                    <div className="app-notification app-notification--warning" style={{ marginTop: 10 }}>
                        <span className="app-notification-icon">⚠️</span>
                        <div className="app-notification-body">
                            <h4>Config limit reached</h4>
                            <p>Remove an old config, then try again.</p>
                            <button
                                className="form-button"
                                onClick={() => shell.openExternal(MANAGE_URL)}
                                style={{ marginTop: 8, height: 32, fontSize: 12 }}
                            >
                                Manage WireGuard Configs →
                            </button>
                        </div>
                    </div>
                )}

                {status && !isLimitError && (
                    <p className={`wg-status ${statusType}`}>{status}</p>
                )}
            </div>

            {/* ── Always-visible manage link ───────────────────────────────── */}
            <div style={{ textAlign: 'center', marginTop: 12 }}>
                <button
                    onClick={() => shell.openExternal(MANAGE_URL)}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: 11,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        padding: 0,
                    }}
                >
                    View / manage all WireGuard configs
                </button>
            </div>
        </div>
    );
});

export default WireGuardDetails;
