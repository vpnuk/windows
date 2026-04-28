import React, { useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { action } from 'mobx';
import '@components/index.css';
import { useStore } from '@domain';
import { settingsPath } from '@modules/constants.js';

const axios = require('axios');
const fs    = require('fs');

const WG_AUTH_URL = 'https://clientcp.vpnuk.info/vpnuk/clients/wg_v2_app_api.php';

const WireGuardDetails = observer(() => {
    const store   = useStore();
    const profile = store.profiles.currentProfile;
    const [status, setStatus] = useState('');
    const [statusType, setStatusType] = useState('');
    const [loading, setLoading] = useState(false);

    // dns  = hostname like uk20.vpnuk.net / shared32.vpnuk.net
    // host = IP address (used for shared API param)
    const serverDns  = profile.server?.dns  || '';
    const serverHost = profile.server?.host || '';
    const isShared   = profile.serverType === 'shared';

    // Config file is named by DNS slug: shared32.vpnuk.net → shared32.conf
    const confPath = settingsPath.wgConf(profile.id, serverDns);

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
        if (isShared && !serverHost) {
            setStatus('Select a server in the Profile tab first.');
            setStatusType('error');
            return;
        }
        if (!isShared && !serverDns) {
            setStatus('No server assigned to this profile. Check the Profile tab.');
            setStatusType('error');
            return;
        }

        setLoading(true);
        setStatus('Fetching WireGuard configuration...');
        setStatusType('');
        try {
            // Shared accounts: send server as IP address (serverHost)
            // Dedicated / 1:1: send server as DNS hostname (serverDns)
            const serverParam = isShared ? serverHost : serverDns;

            const params = new URLSearchParams({
                action: 'get_config',
                username: login,
                password,
                server_type: profile.serverType,
                server: serverParam,
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
                action(() => { profile.wgConfigFetched = !profile.wgConfigFetched; })();
                setStatus('Config saved. You can now connect.');
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
            action(() => { profile.wgConfigFetched = !profile.wgConfigFetched; })();
            setStatus('Config cleared. Fetch again to reconnect.');
            setStatusType('');
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
