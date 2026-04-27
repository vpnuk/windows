import React from 'react';
import { action } from 'mobx';
import { observer } from 'mobx-react-lite';
import { Checkbox, Switch } from 'antd';
import '@components/index.css';
import { optionsMtu, VpnType } from '@modules/constants.js';
import { ValueSelector } from '@components';
import { Dns, useStore } from '@domain';

const ConnectionDetails = observer(() => {
    const store = useStore();
    const profile = store.profiles.currentProfile;

    return <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
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

            <div>
                <div className="form-titles" style={{ marginBottom: 6 }}>DNS</div>
                <ValueSelector
                    options={Dns.values}
                    value={profile.details.dns}
                    onChange={action(value => profile.details.dns = value)} />
            </div>

            {profile.vpnType === VpnType.OpenVPN.label && (
                <div>
                    <div className="form-titles" style={{ marginBottom: 6 }}>MTU</div>
                    <ValueSelector
                        options={optionsMtu}
                        value={profile.details.mtu}
                        onChange={action(value => profile.details.mtu = value)} />
                </div>
            )}
        </div>
    </>;
});

export default ConnectionDetails;
