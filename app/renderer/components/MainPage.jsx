import React from 'react';
import { observer } from 'mobx-react-lite';
import ShieldImage from '@assets/shield.png';
import SettingsImage from '@assets/settings.png';
import '@components/index.css';
import { ConnectionSwitch, ValueSelector } from '@components';
import { useStore } from '@domain';
import { action } from 'mobx';

const MainPage = observer(({ showDrawer }) => {
    const store = useStore();
    const profile = store.profiles.currentProfile;

    return <>
        <div className="wrapper-content">
            <div className="column">
                <div className="settings-button" onClick={showDrawer}>
                    <img alt="settings-icon" src={`${SettingsImage}`} />
                    <div>
                        <p>Settings</p>
                    </div>
                </div>
            </div>
            <div className="column">
                <div className="column-block column-image_world">
                    <img alt="vpnuk-shield" src={`${ShieldImage}`} />
                </div>
                <div className="column-block column-content_block">
                    <div className="column-content_block-title">VPNUK</div>
                    <div className="column-content_block-subtitle">Secure & Private Connection</div>
                    <ConnectionSwitch />
                    <ValueSelector
                        options={store.profiles.getProfiles()}
                        value={store.profiles.currentProfile}
                        onChange={action(value => {
                            store.settings.vpnType = value.vpnType;
                            store.settings.profileId = value.id;
                        })} />
                    <div className="column-content_block-text">
                        <p>{profile.credentials.login || 'No profile'}</p>
                        <p>{profile.server.label || 'No server selected'}</p>
                    </div>
                </div>
            </div>
            <div className="column"></div>
        </div>
    </>;
});

export default MainPage;
