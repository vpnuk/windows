import React, { useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import '@components/index.css';
import { VpnType, settingsPath, settingsLink, wgConfSlug } from '@modules/constants.js';

const fs = require('fs');

const readFile = path => {
    try {
        return fs.readFileSync(path, 'utf-8');
    } catch {
        return '';
    }
};

const writeFile = (path, content) => {
    try {
        fs.writeFileSync(path, content, 'utf-8');
        return true;
    } catch {
        return false;
    }
};

const ConfigEditor = observer(({ vpnType, profileId, serverType, serverDns, reloadKey }) => {
    const isWireGuard = vpnType === VpnType.WireGuard.label;
    const isOpenVPN   = vpnType === VpnType.OpenVPN.label;

    if (!isWireGuard && !isOpenVPN) {
        return (
            <div className="app-notification app-notification--info" style={{ marginTop: 12 }}>
                <span className="app-notification-icon">ℹ️</span>
                <div className="app-notification-body">
                    <h4>No config file</h4>
                    <p>{vpnType} connections use Windows built-in VPN — no config file to edit.</p>
                </div>
            </div>
        );
    }

    return isOpenVPN
        ? <OvpnConfigEditor />
        : <WgConfigEditor profileId={profileId} serverType={serverType} serverDns={serverDns} reloadKey={reloadKey} />;
});

const OvpnConfigEditor = () => {
    const [content, setContent] = useState('');
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        setContent(readFile(settingsPath.ovpn));
    }, []);

    const handleSave = () => {
        if (writeFile(settingsPath.ovpn, content)) {
            setSaved(true);
            setError('');
            setTimeout(() => setSaved(false), 2000);
        } else {
            setError('Failed to save. Check file permissions.');
        }
    };

    const handleRestoreDefaults = async () => {
        try {
            const axios = require('axios');
            const response = await axios.get(settingsLink.ovpn);
            const lines = ('' + response.data).split('\n').filter(line =>
                !line.startsWith('#') &&
                !line.startsWith('proto') &&
                !line.startsWith('remote') &&
                !line.startsWith('auth-user-pass')
            );
            const defaultContent = lines.join('\n');
            setContent(defaultContent);
            writeFile(settingsPath.ovpn, defaultContent);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch {
            setError('Failed to restore defaults. Check your internet connection.');
        }
    };

    return (
        <div className="config-editor-wrapper" style={{ paddingTop: 8 }}>
            <p style={{ color: '#6b8cad', fontSize: 12, margin: '0 0 8px' }}>
                Editing: OpenVPN configuration (.ovpn)
            </p>
            <textarea
                className="config-editor-textarea"
                value={content}
                onChange={e => setContent(e.target.value)}
                spellCheck={false}
            />
            {error && (
                <div className="app-notification app-notification--error">
                    <span className="app-notification-icon">🔴</span>
                    <div className="app-notification-body"><p>{error}</p></div>
                </div>
            )}
            <div className="config-editor-actions">
                <button className="form-button" onClick={handleSave}>
                    {saved ? '✓ Saved' : 'Save'}
                </button>
                <button className="form-button form-button--danger" onClick={handleRestoreDefaults}>
                    Restore Defaults
                </button>
            </div>
        </div>
    );
};

const WgConfigEditor = ({ profileId, serverType, serverDns, reloadKey }) => {
    const [content, setContent] = useState('');
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');
    const confPath = profileId
        ? settingsPath.wgConf(serverType, serverDns)
        : null;

    // reloadKey changes every time a config is fetched or cleared, so the
    // textarea re-reads the file from disk automatically without the user
    // needing to switch tabs.
    useEffect(() => {
        setContent(confPath ? readFile(confPath) : '');
    }, [confPath, reloadKey]);

    const handleSave = () => {
        if (!confPath) return setError('No WireGuard config for this profile.');
        if (writeFile(confPath, content)) {
            setSaved(true);
            setError('');
            setTimeout(() => setSaved(false), 2000);
        } else {
            setError('Failed to save. Check file permissions.');
        }
    };

    if (!confPath) {
        return (
            <div className="app-notification app-notification--info" style={{ marginTop: 12 }}>
                <span className="app-notification-icon">ℹ️</span>
                <div className="app-notification-body">
                    <h4>No WireGuard config yet</h4>
                    <p>Use the Profile tab to fetch your WireGuard configuration first.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="config-editor-wrapper" style={{ paddingTop: 8 }}>
            <p style={{ color: '#6b8cad', fontSize: 12, margin: '0 0 8px' }}>
                Editing: WireGuard configuration (.conf){serverDns ? ` for ${serverDns}` : ''}
            </p>
            <textarea
                className="config-editor-textarea"
                value={content}
                onChange={e => setContent(e.target.value)}
                spellCheck={false}
            />
            {error && (
                <div className="app-notification app-notification--error">
                    <span className="app-notification-icon">🔴</span>
                    <div className="app-notification-body"><p>{error}</p></div>
                </div>
            )}
            <div className="config-editor-actions">
                <button className="form-button" onClick={handleSave}>
                    {saved ? '✓ Saved' : 'Save'}
                </button>
            </div>
        </div>
    );
};

export default ConfigEditor;
