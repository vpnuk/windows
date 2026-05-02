import { ipcRenderer } from 'electron';
import React from 'react';
import { observer } from 'mobx-react-lite';
import { Switch } from 'antd';
import { CSSTransition } from 'react-transition-group';
import '@components/index.css';
import { connectionStates } from '@modules/constants.js';
import { ConnectionStore, ConnectionLogStore, useStore } from '@domain';
import { useConnectAction } from './useConnectAction';

const ConnectionSwitch = observer(() => {
    const profile = useStore().profiles.currentProfile;
    const { startConnect, busy } = useConnectAction(profile);

    const handleChange = async (checked) => {
        if (checked && ConnectionStore.state === connectionStates.disconnected) {
            await startConnect();
        } else {
            ConnectionLogStore.clear();
            ipcRenderer.send('connection-stop');
        }
    };

    return <>
        <div className="column-content_block-check">
            <CSSTransition
                classNames="switch"
                in={ConnectionStore.state === connectionStates.connected}
                timeout={360}
            >
                <Switch
                    className="switch"
                    onChange={handleChange}
                    checked={ConnectionStore.state !== connectionStates.disconnected}
                    disabled={busy}
                />
            </CSSTransition>
            <p>{ConnectionStore.state}</p>
        </div>
    </>;
});

export default ConnectionSwitch;
