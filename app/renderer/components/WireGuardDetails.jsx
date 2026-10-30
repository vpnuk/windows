/**
 * WireGuardDetails — Read-only status panel shown in the WireGuard tab.
 *
 * Config is generated and kept up-to-date automatically in ConnectionButton
 * via wgApi.js — there are no manual buttons here.
 */

import React             from 'react';
import { observer }      from 'mobx-react-lite';
import '@components/index.css';
import { useStore, ConnectionStore } from '@domain';
import { settingsPath }  from '@modules/constants.js';

const fs        = require('fs');
const path      = require('path');
const { ipcRenderer } = require('electron');
const { getConfEndpointIp } = require('./wgApi');


const WireGuardDetails = observer(() => {
    const profile    = useStore().profiles.currentProfile;
    void profile.wgConfigFetched;   // track observable so panel re-renders after connect
    void ConnectionStore.state;    // main creates/removes configs after renderer preflight

    const serverType    = profile.serverType || 'shared';
    const serverHost    = profile.server?.host || '';
    const confPath      = settingsPath.wgConf(serverType, null, profile.id);
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
                        Your config is loaded automatically when you click{' '}
                        <strong>Connect</strong>. This device’s server config is reused
                        for reconnecting. Disconnect removes the local config file.
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
                            No local config saved — will be loaded on Connect.
                        </p>
                    )}
                </div>
            </div>

            <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button
                    onClick={() => ipcRenderer.send('open-wg-manage')}
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
