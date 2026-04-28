import React, { useEffect } from 'react';
import { action, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { Radio } from 'antd';
import ReactCountryFlag from 'react-country-flag';
import '@components/index.css';
import { ValueSelector } from '@components';
import { Servers, useStore } from '@domain';
import { settingsPath, VpnType } from '@modules/constants.js';

const fs = require('fs');

const toIso = code => (code === 'UK' ? 'GB' : (code || '').toUpperCase());

const formatServerOption = option => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {option.countryCode && (
            <ReactCountryFlag
                countryCode={toIso(option.countryCode)}
                svg
                style={{ width: 24, height: 18, flexShrink: 0 }}
            />
        )}
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>
                {option.label}
            </span>
            {option.city && (
                <span style={{ fontSize: 11, opacity: 0.60 }}>
                    {option.city}
                </span>
            )}
        </span>
    </div>
);

const WireGuardConfigStatus = observer(({ profile }) => {
    const serverDns = profile.server?.dns || '';
    void profile.wgConfigFetched;
    const confPath = serverDns ? settingsPath.wgConf(profile.id, serverDns) : null;
    let hasConfig = false;
    try { hasConfig = confPath ? fs.existsSync(confPath) : false; } catch { }

    if (!serverDns) return null;

    return hasConfig ? (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#1aceb8' }}>
            ✓ WireGuard config ready for this server
        </p>
    ) : (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#e6a817' }}>
            No WireGuard config for this server — go to the Connection tab to fetch one
        </p>
    );
});

const ServerSelector = observer(() => {
    const profile = useStore().profiles.currentProfile;
    const isWireGuard = profile.vpnType === VpnType.WireGuard.label;

    useEffect(() => {
        let catalog = Servers.getCatalog(profile.serverType);
        if (!profile.server.host && catalog.length > 0) {
            runInAction(() => {
                profile.server = catalog[0];
            });
        }
    }, [profile, profile.server, profile.serverType]);

    return <>
        <div className="form-titles">Server</div>
        <div className="form-server-block-radio">
            <Radio.Group
                value={profile.serverType}
                onChange={action(e => {
                    profile.serverType = e.target.value;
                    let cat = Servers.getCatalog(e.target.value);
                    cat.length > 0 && (profile.server = cat[0]);
                })}>

                <Radio.Button value="shared">SHARED</Radio.Button>
                <Radio.Button value="dedicated">DEDICATED</Radio.Button>
                <Radio.Button value="dedicated11">1:1</Radio.Button>
            </Radio.Group>
        </div>
        <ValueSelector
            options={Servers.getCatalog(profile.serverType)}
            value={profile.server}
            formatOptionLabel={formatServerOption}
            onChange={action(value => profile.server = value)} />

        {isWireGuard && <WireGuardConfigStatus profile={profile} />}
    </>
});

export default ServerSelector;
