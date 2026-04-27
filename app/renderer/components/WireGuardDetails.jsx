import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { action } from 'mobx';
import '@components/index.css';
import { useStore } from '@domain';

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const WG_AUTH_URL = 'https://clientcp.vpnuk.info/vpnuk/clients/wg_v2_app_api.php';

const WireGuardDetails = observer(() => {
    const store   = useStore();
    const profile = store.profiles.currentProfile;
    const [status, setStatus] = useState('');
    const [statusType, setStatusType] = useState('');
    const [loading, setLoading] = useState(false);

    const confPath = path.join(
        require('process').env.APPDATA + '\\VPNUK',
        `wg-${profile.id}.conf`
    );

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
        setLoading(true);
        setStatus('Fetching WireGuard configuration...');
        setStatusType('');
        try {
            const server = profile.serverType === 'shared'
                ? (profile.server?.host || '')
                : '';

            const params = new URLSearchParams({
                action: 'get_config',
                username: login,
                password,
                server_type: profile.serverType,
                ...(server ? { server: server } : {})
            });

            const response = await axios.post(WG_AUTH_URL, params.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 15000,
                validateStatus: () => true
            });

            if (response.data?.error) {
                setStatus(response.data.error);
                setStatusType('error');
            } else if (response.data?.config) {
                fs.writeFileSync(confPath, response.data.config, 'utf-8');
                action(() => { profile.wgConfigFetched = true; })();
                setStatus('Config saved successfully. You can now connect.');
                setStatusType('ok');
            } else {
                setStatus('Unexpected response from server. Please try again.');
                setStatusType('error');
            }
        } catch (err) {
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
            action(() => { profile.wgConfigFetched = false; })();
            setStatus('Config cleared. Fetch again to reconnect.');
            setStatusType('');
        } catch {
            setStatus('Failed to clear config.');
            setStatusType('error');
        }
    };

    return (
        <div style={{ paddingTop: 8 }}>
            <div className="app-notification app-notification--info">
                <span className="app-notification-icon">🔒</span>
                <div className="app-notification-body">
                    <h4>WireGuard</h4>
                    <p>
                        {profile.serverType === 'dedicated' || profile.serverType === 'dedicated11'
                            ? 'Your dedicated config will be fetched from your account. Click below to download it.'
                            : 'A shared server config will be generated for you automatically.'
                        }
                    </p>
                </div>
            </div>

            <div className="wg-fetch-section">
                <button
                    className="form-button"
                    onClick={fetchConfig}
                    disabled={loading}
                >
                    {loading ? 'Fetching...' : configExists() ? 'Refresh Config' : 'Fetch WireGuard Config'}
                </button>

                {configExists() && !loading && (
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

                {configExists() && (
                    <p className="wg-status ok">
                        ✓ Config is ready — use the Connection tab to connect
                    </p>
                )}
            </div>
        </div>
    );
});

export default WireGuardDetails;
