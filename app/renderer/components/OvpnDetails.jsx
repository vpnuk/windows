import React from 'react';
import { action } from 'mobx';
import { observer } from 'mobx-react-lite';
import { Radio } from 'antd';
import '@components/index.css';
import { OvpnOptions, useStore } from '@domain';
import { windowsArch } from '@modules/windows-arch.js';

const OvpnDetails = observer(() => {
    const details = useStore().profiles.currentProfile.details;

    return (
        <div className="connection-details-wrapper">
            <div className="form-label" style={{ marginBottom: 4 }}>Protocol</div>
            <Radio.Group
                value={details.protocol}
                onChange={action(e => {
                    details.protocol = e.target.value;
                    details.port = OvpnOptions.getPorts(e.target.value)[0];
                })}
            >
                {OvpnOptions.protocolNames.filter(name => windowsArch() !== 'arm64' || name.toLowerCase() !== 'obfuscation').map(name =>
                    <Radio.Button key={name} value={name}>
                        {name}
                    </Radio.Button>)}
            </Radio.Group>
            {windowsArch() === 'arm64' && <p>ARM64 uses native OpenVPN. Obfuscation is unavailable because no ARM64 patch is supplied.</p>}
            <div className="form-label" style={{ marginTop: 10, marginBottom: 4 }}>Port</div>
            <Radio.Group
                value={details.port}
                onChange={action(e => details.port = e.target.value)}
            >
                {OvpnOptions.getPorts(details.protocol).map(port =>
                    <Radio.Button
                        key={port}
                        value={port}
                        checked={port === details.port}
                    >
                        {port}
                    </Radio.Button>)}
            </Radio.Group>
        </div>
    );
});

export default OvpnDetails;