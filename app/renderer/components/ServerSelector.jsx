import React, { useEffect } from 'react';
import { action, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { Radio } from 'antd';
import '@components/index.css';
import { ValueSelector } from '@components';
import { Servers, useStore } from '@domain';

const countryCodeToEmoji = code => {
    const normalized = code === 'UK' ? 'GB' : code;
    return [...normalized.toUpperCase()]
        .map(c => String.fromCodePoint(c.charCodeAt(0) + 0x1F1A5))
        .join('');
};

const formatServerOption = option => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>
            {option.countryCode ? countryCodeToEmoji(option.countryCode) : ''}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>
                {option.city || option.label}
            </span>
            <span style={{ fontSize: 11, opacity: 0.65 }}>
                {option.label}
            </span>
        </span>
    </div>
);

const ServerSelector = observer(() => {
    const profile = useStore().profiles.currentProfile;
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
    </>
});

export default ServerSelector;
