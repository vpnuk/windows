import React from 'react';
import { action } from 'mobx';
import { observer } from 'mobx-react-lite';
import { Checkbox, Switch } from 'antd';
import '@components/index.css';
import { optionsMtu, optionsAllowedIps, VpnType } from '@modules/constants.js';
import { ValueSelector } from '@components';
import { Dns, useStore } from '@domain';

const ConnectionDetails = observer(() => {
    const store   = useStore();
    const profile = store.profiles.currentProfile;
    const isWg    = store.settings.vpnType === VpnType.WireGuard.label;

    const allowedIps    = profile.details.allowedIps || { ...optionsAllowedIps[0], customValue: '' };
    const isCustomAllowedIps = allowedIps.value === 'custom';

    return <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>

            <div className="auto-connect-row">
                <div>
                    <label>Launch at Startup</label>
                    <br />
                    <small>Start VPNUK with Windows</small>
                </div>
                <Switch
                    checked={store.settings.autoRun}
                    onChange={action(v => {
                        store.settings.autoRun = v;
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.send('auto-run-toggle', v);
                    })}
                    style={{ background: store.settings.autoRun ? '#237be7' : undefined }}
                />
            </div>

            <div className="auto-connect-row">
                <div>
                    <label>Auto-Connect</label>
                    <br />
                    <small>Connect automatically on app launch</small>
                </div>
                <Switch
                    checked={store.settings.autoConnect}
                    onChange={action(v => store.settings.autoConnect = v)}
                    style={{ background: store.settings.autoConnect ? '#237be7' : undefined }}
                />
            </div>

            <div className="auto-connect-row">
                <div>
                    <label>Kill Switch</label>
                    <br />
                    <small>Block all traffic if VPN disconnects</small>
                </div>
                <Switch
                    checked={profile.details.killSwitchEnabled}
                    onChange={action(v => profile.details.killSwitchEnabled = v)}
                    style={{ background: profile.details.killSwitchEnabled ? '#237be7' : undefined }}
                />
            </div>

            {/* DNS + MTU share a row */}
            <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                    <div className="form-titles" style={{ marginBottom: 6 }}>Custom DNS</div>
                    <ValueSelector
                        options={Dns.values}
                        value={profile.details.dns}
                        onChange={action(value => profile.details.dns = value)} />
                </div>
                <div style={{ flex: 1 }}>
                    <div className="form-titles" style={{ marginBottom: 6 }}>Custom MTU</div>
                    <ValueSelector
                        options={optionsMtu}
                        value={profile.details.mtu}
                        onChange={action(value => profile.details.mtu = value)} />
                </div>
            </div>

            {/* Allowed IPs — WireGuard only */}
            {isWg && (
                <div>
                    <div className="form-titles" style={{ marginBottom: 6 }}>Allowed IPs</div>
                    <ValueSelector
                        options={optionsAllowedIps}
                        value={optionsAllowedIps.find(o => o.value === allowedIps.value) || optionsAllowedIps[0]}
                        onChange={action(opt => {
                            profile.details.allowedIps = {
                                ...opt,
                                customValue: allowedIps.customValue || '',
                            };
                        })}
                    />
                    {isCustomAllowedIps && (
                        <input
                            className="form-input"
                            placeholder="e.g. 10.0.0.0/8, 192.168.1.0/24"
                            value={allowedIps.customValue || ''}
                            onChange={action(e => {
                                profile.details.allowedIps = {
                                    ...allowedIps,
                                    customValue: e.target.value,
                                };
                            })}
                            style={{ marginTop: 6, width: '100%', boxSizing: 'border-box' }}
                        />
                    )}
                </div>
            )}

        </div>
    </>;
});

export default ConnectionDetails;
