import React from 'react';
import { action } from 'mobx';
import { observer } from 'mobx-react-lite';
import { Checkbox, Switch } from 'antd';
import '@components/index.css';
import { optionsMtu } from '@modules/constants.js';
import { ValueSelector } from '@components';
import { Dns, useStore } from '@domain';

const ConnectionDetails = observer(() => {
    const store = useStore();
    const profile = store.profiles.currentProfile;

    return <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>

            {/* Row 1: Launch at Startup + Auto-Connect */}
            <div style={{ display: 'flex', gap: 12 }}>
                <div className="auto-connect-row" style={{ flex: 1 }}>
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
                <div className="auto-connect-row" style={{ flex: 1 }}>
                    <div>
                        <label>Auto-Connect</label>
                        <br />
                        <small>Connect on app launch</small>
                    </div>
                    <Switch
                        checked={store.settings.autoConnect}
                        onChange={action(v => store.settings.autoConnect = v)}
                        style={{ background: store.settings.autoConnect ? '#237be7' : undefined }}
                    />
                </div>
            </div>

            {/* Row 2: Kill Switch + Custom DNS + Custom MTU */}
            <div style={{ display: 'flex', gap: 12 }}>
                <div className="auto-connect-row" style={{ flex: 1, borderBottom: 'none' }}>
                    <div>
                        <label>Kill Switch</label>
                        <br />
                        <small>Block traffic if VPN drops</small>
                    </div>
                    <Switch
                        checked={profile.details.killSwitchEnabled}
                        onChange={action(v => profile.details.killSwitchEnabled = v)}
                        style={{ background: profile.details.killSwitchEnabled ? '#237be7' : undefined }}
                    />
                </div>
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

        </div>
    </>;
});

export default ConnectionDetails;
