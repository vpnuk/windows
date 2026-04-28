/**
 * WireGuardDetails — Read-only status panel shown in the WireGuard tab.
 *
 * Config is generated and kept up-to-date automatically in ConnectionButton
 * via wgApi.js — there are no manual buttons here.
 */

import React             from 'react';
import { observer }      from 'mobx-react-lite';
import '@components/index.css';
import { useStore }      from '@domain';
import { settingsPath }  from '@modules/constants.js';

const fs        = require('fs');
const path      = require('path');
const { shell } = require('electron');
const { getConfEndpointIp } = require('./wgApi');

const MANAGE_URL = 'https://clientcp.vpnuk.info/vpnuk/clients/wireguard_v2.php';

const WireGuardDetails = observer(() => {
    const profile    = useStore().profiles.currentProfile;
    void profile.wgConfigFetched;   // track observable so panel re-renders after connect

    const serverType    = profile.serverType || 'shared';
    const serverHost    = profile.server?.host || '';
    const confPath      = settingsPath.wgConf(serverType, null);
    const confName      = path.basename(confPath);
    const confExists    = (() => { try { return fs.existsSync(confPath); } catch { return false; } })();
    const endpointIp    = confExists ? getConfEndpointIp(confPath) : null;
    const serverMismatch = confExists && endpointIp && serverHost && endpointIp !== serverHost;

    return (
        <div style={{ paddingTop: 8 }}>

            <div className="app-notification app-notification--info">
                <span className="app-notification-icon">🔒</span>
                <div className="app-notification-body">
                    <h4>WireGuard — Auto-Connect</h4>
                    <p>
                        Your config is generated automatically when you click{' '}
                        <strong>Connect</strong>. Switching servers releases the old
                        config and fetches the correct one seamlessly.
                    </p>

                    {confExists && !serverMismatch && (
                        <p style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 0' }}>
                            Active config: <strong>{confName}</strong>
                            {endpointIp ? ` · Endpoint ${endpointIp}` : ''}
                        </p>
                    )}

                    {serverMismatch && (
                        <p style={{ fontSize: 11, color: '#e67e22', margin: '4px 0 0' }}>
                            ⚠ Config is for a different server ({endpointIp}) — will refresh on next Connect.
                        </p>
                    )}

                    {!confExists && (
                        <p style={{ fontSize: 11, opacity: 0.6, margin: '4px 0 0' }}>
                            No config saved yet — will be generated on Connect.
                        </p>
                    )}
                </div>
            </div>

            <div style={{ textAlign: 'center', marginTop: 14 }}>
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
