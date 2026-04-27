import React from 'react';
import { action } from 'mobx';
import { observer } from 'mobx-react-lite';
import '@components/index.css';
import { useStore } from '@domain';

const ProfileDetails = observer(() => {
    const profiles = useStore().profiles;
    return <>
        <div className="form-profile-block">
            <div className="form-profile-block-inline">
                <input
                    placeholder="name"
                    value={profiles.currentProfile.label}
                    onChange={action(e => profiles.currentProfile.label = e.target.value)}
                />
                <button
                    className="form-button"
                    onClick={action(() => profiles.deleteProfile(profiles.currentProfile.id))}
                >
                    Delete
                </button>
                <div className="form-titles">Credentials</div>
                <input
                    placeholder="login"
                    value={profiles.currentProfile.credentials.login}
                    onChange={action(e =>
                        profiles.currentProfile.credentials.login =
                            e.target.value.trim())} />
                <input
                    placeholder="password"
                    value={profiles.currentProfile.credentials.password}
                    onChange={action(e =>
                        profiles.currentProfile.credentials.password =
                            e.target.value.trim())}
                />
            </div>
        </div>
    </>;
});

export default ProfileDetails;