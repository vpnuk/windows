import { ipcRenderer } from 'electron';
import React from 'react';
import { toJS } from 'mobx';
import { observer } from 'mobx-react-lite';
import { connectionStates } from '@modules/constants.js';
import { ConnectionStore, useStore, WvpnOptions } from '@domain';

const ConnectionButton = observer(() => {
    const profile = useStore().profiles.currentProfile;

    return (
        <button
            className="form-button"
            onClick={() => {
                if (ConnectionStore.state === connectionStates.disconnected) {
                    ipcRenderer.send('connection-start', {
                        profile: toJS(profile),
                        gateway: toJS(ConnectionStore.gateway),
                        wVpnOptions: toJS(WvpnOptions)
                    });
                } else {
                    ipcRenderer.send('connection-stop');
                }
            }}
        >
            {ConnectionStore.state !== connectionStates.disconnected
                ? 'Disconnect'
                : 'Connect'}
        </button>);
});

export default ConnectionButton;