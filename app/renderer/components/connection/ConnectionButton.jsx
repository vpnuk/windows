import { ipcRenderer } from 'electron';
import React, { useRef } from 'react';
import { observer }                from 'mobx-react-lite';
import { connectionStates }        from '@modules/constants.js';
import { ConnectionStore, ConnectionLogStore, useStore } from '@domain';
import { useConnectAction }        from './useConnectAction';

// ── Step-log panel styles ──────────────────────────────────────────────────────
const PANEL_HEIGHT = 100;

const S = {
    log: {
        padding: '6px 8px',
        background: 'rgba(0,0,0,0.38)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 4,
        height: PANEL_HEIGHT,
        overflowY: 'auto',
        overflowX: 'hidden',
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.6,
        color: '#90b8f8',
        marginBottom: 10,
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
        height: PANEL_HEIGHT,
        overflowY: 'auto',
        overflowX: 'hidden',
        fontSize: 11,
        color: '#e74c3c',
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap',
        marginBottom: 10,
        boxSizing: 'border-box',
    },
};

const ConnectionButton = observer(() => {
    const profile  = useStore().profiles.currentProfile;
    const { startConnect, busy } = useConnectAction(profile);
    const logEndRef = useRef(null);

    const stepLog  = ConnectionLogStore.steps;
    const errorMsg = ConnectionLogStore.error;

    // Auto-scroll to latest step
    React.useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [stepLog.length]);

    const handleClick = async () => {
        if (ConnectionStore.state !== connectionStates.disconnected) {
            ipcRenderer.send('connection-stop');
            ConnectionLogStore.clear();
            return;
        }
        await startConnect();
    };

    const isConnected = ConnectionStore.state !== connectionStates.disconnected;
    const label       = busy ? 'Preparing\u2026' : isConnected ? 'Disconnect' : 'Connect';

    return (
        <div>
            {/* ── Persistent status panel — always visible above the button ── */}
            {errorMsg ? (
                <>
                <div style={S.error}>
                    {stepLog.length > 0 && (
                        <div style={{ marginBottom: 4, opacity: 0.65, fontSize: 10 }}>
                            {stepLog.map((l, i) => (
                                <span key={i} style={S.line}>{'\u2714 '}{l}</span>
                            ))}
                        </div>
                    )}
                    <strong style={{ display: 'block', marginBottom: 2 }}>{'\u26a0'} Error</strong>
                    {errorMsg}
                </div>
                {/* ── Live Help nudge — shown below error panel ── */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '5px 8px',
                    marginBottom: 10,
                    background: 'rgba(39,174,96,0.12)',
                    border: '1px solid rgba(39,174,96,0.4)',
                    borderRadius: 4,
                    fontSize: 11,
                    color: '#2ecc71',
                }}>
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
                    Live Help is on hand if you continue to have problems — use the Live Help tab in the app settings or visit vpnuk.net.
                </div>
                </>
            ) : (
                <div style={S.log}>
                    {stepLog.length > 0 ? (
                        stepLog.map((line, i) => {
                            const isCurrent = i === stepLog.length - 1;
                            return (
                                <span key={i} style={isCurrent ? { ...S.line, ...S.lineActive } : S.line}>
                                    {isCurrent && busy ? '\u25b6 ' : '\u2714 '}{line}
                                </span>
                            );
                        })
                    ) : (
                        <span style={S.placeholder}>— ready —</span>
                    )}
                    <span ref={logEndRef} />
                </div>
            )}

            {/* ── Connect / Disconnect button ─────────────────────────────── */}
            <button
                className="form-button"
                onClick={handleClick}
                disabled={busy}
                style={busy ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
            >
                {label}
            </button>
        </div>
    );
});

export default ConnectionButton;
