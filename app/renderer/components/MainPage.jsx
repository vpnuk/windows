import React from 'react';
import { observer } from 'mobx-react-lite';
import ShieldImage from '@assets/shield.png';
import '@components/index.css';
import { ConnectionSwitch, ValueSelector } from '@components';
import { useStore, ConnectionLogStore } from '@domain';
import { action } from 'mobx';

// ── Inline log panel styles — mirrors ConnectionButton panel ──────────────────
const S = {
    log: {
        padding: '6px 8px',
        background: 'rgba(0,0,0,0.38)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 4,
        height: 108,
        overflowY: 'auto',
        overflowX: 'hidden',
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.6,
        color: '#90b8f8',
        marginTop: 10,
        boxSizing: 'border-box',
    },
    placeholder: {
        display: 'block',
        color: 'rgba(144, 184, 248, 0.25)',
        userSelect: 'none',
    },
    line: { display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
    lineActive: { color: '#fff', fontWeight: 700 },
    error: {
        padding: '6px 8px',
        background: 'rgba(231,76,60,0.15)',
        border: '1px solid rgba(231,76,60,0.45)',
        borderRadius: 4,
        height: 108,
        overflowY: 'auto',
        overflowX: 'hidden',
        fontSize: 11,
        color: '#e74c3c',
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap',
        marginTop: 10,
        boxSizing: 'border-box',
    },
    liveHelp: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 8px',
        marginTop: 6,
        background: 'rgba(39,174,96,0.12)',
        border: '1px solid rgba(39,174,96,0.4)',
        borderRadius: 4,
        fontSize: 11,
        color: '#2ecc71',
    },
};

const MainPage = observer(({ showDrawer }) => {
    const store   = useStore();
    const profile = store.profiles.currentProfile;
    const steps   = ConnectionLogStore.steps;
    const errMsg  = ConnectionLogStore.error;

    return <>
        <div className="wrapper-content">
            <div className="column">
                <div className="settings-button" onClick={showDrawer}>
                    <p>Settings</p>
                </div>
            </div>
            <div className="column">
                <div className="column-block column-image_world">
                    <img alt="vpnuk-shield" src={`${ShieldImage}`} />
                </div>
                <div className="column-block column-content_block">
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

                    {/* ── Connection log panel ── */}
                    {errMsg ? (
                        <>
                        <div style={S.error}>
                            {steps.length > 0 && (
                                <div style={{ marginBottom: 4, opacity: 0.65, fontSize: 10 }}>
                                    {steps.map((l, i) => (
                                        <span key={i} style={S.line}>{'\u2714 '}{l}</span>
                                    ))}
                                </div>
                            )}
                            <strong style={{ display: 'block', marginBottom: 2 }}>{'\u26a0'} Error</strong>
                            {errMsg}
                        </div>
                        <div style={S.liveHelp}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                                 stroke="#2ecc71" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                 style={{ flexShrink: 0 }}>
                                <circle cx="12" cy="12" r="10"/>
                                <circle cx="12" cy="12" r="4"/>
                                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
                                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
                                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
                                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
                            </svg>
                            Live Help is on hand — use the Live Help tab in Settings or visit vpnuk.net.
                        </div>
                        </>
                    ) : (
                        <div style={S.log}>
                            {steps.length > 0 ? (
                                steps.map((line, i) => {
                                    const isCurrent = i === steps.length - 1;
                                    return (
                                        <span key={i} style={isCurrent ? { ...S.line, ...S.lineActive } : S.line}>
                                            {'\u2714 '}{line}
                                        </span>
                                    );
                                })
                            ) : (
                                <span style={S.placeholder}>— ready —</span>
                            )}
                        </div>
                    )}
                </div>
            </div>
            <div className="column"></div>
        </div>
    </>;
});

export default MainPage;
