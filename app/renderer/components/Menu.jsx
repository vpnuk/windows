import React, { useState, useEffect } from 'react';
import { action }          from 'mobx';
import { observer }        from 'mobx-react-lite';
import { Tabs, Radio }     from 'antd';
import {
    ValueSelector,
    ServerSelector,
    ConnectionButton,
    ConnectionDetails,
    OvpnDetails,
    WireGuardDetails,
    ConfigEditor,
} from '@components';
import '@components/index.css';
import { VpnType }         from '@modules/constants.js';
import { Servers, useStore } from '@domain';
import { isDev }           from '@app';

const { TabPane }       = Tabs;
const { ipcRenderer }   = require('electron');

const TAWK_URL = 'https://tawk.to/chat/56bae5de496019e65d794d8f/default';

const annotateProviderLabels = providers =>
    Object.entries(providers).map(([, provider]) => ({
        value:      provider.label,
        label:      provider.isDisabled ? `${provider.label} — Coming soon` : provider.label,
        isDisabled: provider.isDisabled,
    }));

const Menu = observer(() => {
    const store    = useStore();
    const profiles = store.profiles;
    const profile  = profiles.currentProfile;
    const vpnTypes = annotateProviderLabels(VpnType);

    const [newName, setNewName] = useState('');
    const [logMsg,  setLogMsg]  = useState('');

    useEffect(() => {
        const handler = (_, msg) => setLogMsg(msg);
        ipcRenderer.on('log-open-error', handler);
        return () => ipcRenderer.removeListener('log-open-error', handler);
    }, []);

    const handleCreate = action(() => {
        const name = newName.trim();
        if (!name) return;
        profiles.createProfile(name);
        setNewName('');
    });

    const handleDelete = action(() => {
        profiles.deleteProfile(profile.id);
    });

    return (
        <div>
            {/* ── Type (left) + Profile (right) ──────────────────────────── */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
                <div style={{ flex: '0 0 42%' }}>
                    <div className="form-label">Connection Type</div>
                    <ValueSelector
                        options={vpnTypes}
                        value={vpnTypes.find(t => t.value === store.settings.vpnType)}
                        onChange={action(opt => store.settings.vpnType = opt.value)}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="form-label">Profile</div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <ValueSelector
                                options={profiles.getProfiles(store.settings.vpnType)}
                                getOptionLabel={o => o.label}
                                value={profile}
                                onChange={action(v => store.settings.profileId = v.id)}
                            />
                        </div>
                        <button className="icon-btn" onClick={handleDelete} title="Delete profile">×</button>
                    </div>
                </div>
            </div>

            {/* ── Create new profile ─────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                <input
                    className="form-input"
                    placeholder="New profile name…"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                    style={{ flex: 1 }}
                />
                <button className="form-button-sm" onClick={handleCreate}>+ Create</button>
            </div>

            {/* ── Tabs ───────────────────────────────────────────────────── */}
            <Tabs className="menu-tabs" defaultActiveKey="profile" tabBarStyle={{ marginBottom: 0 }}>
                <TabPane tab="Profile" key="profile">
                    <ProfileTab logMsg={logMsg} setLogMsg={setLogMsg} />
                </TabPane>

                <TabPane tab="Connection" key="connection">
                    <div style={{ paddingTop: 10 }}>
                        <ConnectionDetails />
                        {store.settings.vpnType === VpnType.OpenVPN.label   && <OvpnDetails />}
                        {store.settings.vpnType === VpnType.WireGuard.label && <WireGuardDetails />}
                    </div>
                </TabPane>

                <TabPane tab="Config" key="config">
                    <ConfigEditor
                        vpnType={store.settings.vpnType}
                        profileId={profile.id}
                        serverType={profile.serverType}
                        serverDns={profile.server?.dns}
                        reloadKey={profile.wgConfigFetched}
                    />
                </TabPane>

                <TabPane tab="Log" key="log">
                    <div style={{ paddingTop: 10 }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
                            Connection logs are saved per profile and opened in your default text editor.
                        </p>
                        <button
                            className="form-button"
                            onClick={() => { setLogMsg(''); ipcRenderer.send('log-open', profile.id); }}
                        >
                            Open Connection Log
                        </button>
                        {logMsg && (
                            <p style={{ margin: '5px 0 0', fontSize: 11, color: '#e6a817', textAlign: 'center' }}>
                                {logMsg}
                            </p>
                        )}
                    </div>
                </TabPane>

                <TabPane tab="Live Help" key="livehelp">
                    <div style={{ paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                className="form-button-sm"
                                onClick={() => ipcRenderer.send('open-live-help')}
                                title="Open chat in a separate window so you can navigate the app freely"
                            >
                                ↗ Detach Chat
                            </button>
                        </div>
                        <webview
                            src={TAWK_URL}
                            style={{
                                width: '100%',
                                height: 'calc(100vh - 260px)',
                                minHeight: 400,
                                border: 'none',
                                borderRadius: 4,
                                background: '#fff',
                            }}
                            allowpopups="true"
                        />
                    </div>
                </TabPane>
            </Tabs>

            {isDev && (
                <button
                    className="form-button form-button--danger"
                    style={{ marginTop: 4 }}
                    onClick={() => console.log('STORE', store)}
                >
                    DEBUG
                </button>
            )}
        </div>
    );
});

// ── Profile tab ───────────────────────────────────────────────────────────────
const ProfileTab = observer(({ logMsg, setLogMsg }) => {
    const store   = useStore();
    const profile = store.profiles.currentProfile;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 20 }}>

            {/* Row 1: credentials (narrow) | server selector (wider) */}
            <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: '0 0 28%', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div className="form-label">Username</div>
                    <input
                        className="form-input"
                        placeholder="login"
                        autoComplete="username"
                        value={profile.credentials.login}
                        onChange={action(e => profile.credentials.login = e.target.value.trim())}
                    />
                    <div className="form-label" style={{ marginTop: 20 }}>Password</div>
                    <input
                        className="form-input"
                        type="password"
                        placeholder="password"
                        autoComplete="current-password"
                        value={profile.credentials.password}
                        onChange={action(e => profile.credentials.password = e.target.value.trim())}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <ServerSelector />
                </div>
            </div>

            {/* Row 2: account type radio buttons — full width */}
            <div>
                <Radio.Group
                    className="server-type-radio"
                    value={profile.serverType}
                    onChange={action(e => {
                        profile.serverType = e.target.value;
                        const cat = Servers.getCatalog(e.target.value);
                        if (cat.length > 0) profile.server = cat[0];
                    })}
                >
                    <Radio.Button value="shared">Shared</Radio.Button>
                    <Radio.Button value="dedicated">Dedicated</Radio.Button>
                    <Radio.Button value="dedicated11">1:1</Radio.Button>
                </Radio.Group>
            </div>

            {/* Row 3: connect button (full width) + persistent status panel inside */}
            <div style={{ marginTop: 17 }}>
                <ConnectionButton />
            </div>

        </div>
    );
});

export default Menu;
