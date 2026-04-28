import React, { useState } from 'react';
import { action } from 'mobx';
import { observer } from 'mobx-react-lite';
import CreatableSelect from 'react-select/creatable';
import { Tabs } from 'antd';
import { selectOptionColors } from '@styles';
import {
    ProfileDetails,
    ConnectionButton,
    ValueSelector,
    ServerSelector,
    ConnectionDetails,
    OvpnDetails,
    WireGuardDetails,
    ConfigEditor,
} from '@components';
import '@components/index.css';
import { VpnType } from '@modules/constants.js';
import { useStore } from '@domain';
import { isDev } from '@app';

const { TabPane } = Tabs;

const Menu = observer(() => {
    const store = useStore();
    const vpnTypes = annotateProviderLabels(VpnType);

    return (
        <div>
            <div className="form-titles">Connection Type</div>
            <ValueSelector
                options={vpnTypes}
                value={vpnTypes.find(type => type.value === store.settings.vpnType)}
                onChange={action(option => store.settings.vpnType = option.value)} />

            <div className="form-titles" style={{ marginTop: 12 }}>Profile</div>
            <CreatableSelect
                className="form-select"
                styles={selectOptionColors}
                options={store.profiles.getProfiles(store.settings.vpnType)}
                getOptionLabel={option => option.label}
                value={store.profiles.currentProfile}
                onChange={action(value => store.settings.profileId = value.id)}
                onCreateOption={action(label => store.profiles.createProfile(label))} />

            <Tabs
                className="menu-tabs"
                defaultActiveKey="profile"
                tabBarStyle={{ marginBottom: 0 }}
            >
                <TabPane tab="Profile" key="profile">
                    <ProfileDetails />
                    <ServerSelector />
                </TabPane>

                <TabPane tab="Connection" key="connection">
                    <ConnectionDetails />
                    {store.settings.vpnType === VpnType.OpenVPN.label && (
                        <OvpnDetails />
                    )}
                    {store.settings.vpnType === VpnType.WireGuard.label && (
                        <WireGuardDetails />
                    )}
                </TabPane>

                <TabPane tab="Config" key="config">
                    <ConfigEditor
                        vpnType={store.settings.vpnType}
                        profileId={store.profiles.currentProfile.id}
                        serverType={store.profiles.currentProfile.serverType}
                        serverDns={store.profiles.currentProfile.server?.dns}
                        reloadKey={store.profiles.currentProfile.wgConfigFetched} />
                </TabPane>

                <TabPane tab="Log" key="log">
                    <LogTab />
                </TabPane>
            </Tabs>

            <ConnectionButton />

            {isDev && (
                <button className="form-button form-button--danger"
                    style={{ marginTop: 8 }}
                    onClick={() => console.log('STORE', store)}>
                    DEBUG
                </button>
            )}
        </div>
    );
});

const LogTab = observer(() => {
    const store = useStore();
    const { ipcRenderer } = require('electron');
    return (
        <div style={{ paddingTop: 8 }}>
            <p style={{ color: '#6b8cad', fontSize: 13, marginBottom: 12 }}>
                Connection logs are saved per profile and can be opened in your default text editor.
            </p>
            <button
                className="form-button"
                onClick={() => ipcRenderer.send('log-open', store.profiles.currentProfile.id)}
            >
                Open Connection Log
            </button>
        </div>
    );
});

const annotateProviderLabels = providers => Object.entries(providers).map(entry => {
    const provider = entry[1];
    return {
        value: provider.label,
        label: provider.isDisabled
            ? `${provider.label} — Coming soon`
            : provider.label,
        isDisabled: provider.isDisabled
    };
});

export default Menu;
