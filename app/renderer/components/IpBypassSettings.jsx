import React, { useEffect, useState } from 'react';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useStore } from '@domain';
import { bypassPrefixes } from '@modules/ip-bypass.js';

const IpBypassSettings = observer(() => {
    const store = useStore();
    const profile = store.profiles.currentProfile;
    const [text, setText] = useState('');
    const [message, setMessage] = useState('');
    useEffect(() => {
        setText((profile.bypassIps || []).join('\n'));
        setMessage('');
    }, [profile.id]);
    const save = () => {
        try {
            const prefixes = bypassPrefixes(text);
            runInAction(() => { profile.bypassIps = prefixes; });
            store.triggerPersist();
            setText(prefixes.join('\n'));
            setMessage('Bypass rules saved. Applied on the next connection.');
        } catch (error) { setMessage(error.message); }
    };
    return <div style={{ marginTop: 16 }}>
        <div className="form-label">Split tunnelling — bypass IP addresses</div>
        <p>These IPv4 addresses/subnets use your normal internet connection, not the VPN.
            This is separate from WireGuard Allowed IPs. Listed destinations also bypass the kill switch.</p>
        <textarea className="form-input" rows={4} aria-label="VPN bypass IPv4 addresses"
            placeholder={'192.168.1.10\n10.0.0.0/8'} value={text} onChange={e => setText(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box' }} />
        <p>One IPv4 address or CIDR subnet per line. Leave empty for no bypass. Domains and apps are not included.</p>
        <button className="form-button-sm" onClick={save}>Save Bypass Rules</button>
        {message && <p role="status">{message}</p>}
    </div>;
});

export default IpBypassSettings;
