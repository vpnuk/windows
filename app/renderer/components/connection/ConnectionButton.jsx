import { ipcRenderer } from 'electron';
import React, { useState, useRef } from 'react';
import { toJS, runInAction }       from 'mobx';
import { observer }                from 'mobx-react-lite';
import { connectionStates, VpnType } from '@modules/constants.js';
import { ConnectionStore, useStore, WvpnOptions } from '@domain';

const { ensureWgConfig } = require('../wgApi');

// ── Step-log panel styles ──────────────────────────────────────────────────────
const S = {
    log: {
        marginTop: 8,
        padding: '5px 8px',
        background: 'rgba(0,0,0,0.38)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 4,
        maxHeight: 96,
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.6,
        color: '#90b8f8',
    },
    line: { display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
    lineActive: { color: '#fff', fontWeight: 700 },
    error: {
        marginTop: 8,
        padding: '6px 8px',
        background: 'rgba(231,76,60,0.15)',
        border: '1px solid rgba(231,76,60,0.45)',
        borderRadius: 4,
        fontSize: 11,
        color: '#e74c3c',
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap',
    },
};

const ConnectionButton = observer(() => {
    const profile = useStore().profiles.currentProfile;

    const [stepLog,  setStepLog]  = useState([]);   // array of step strings
    const [errorMsg, setErrorMsg] = useState('');
    const [busy,     setBusy]     = useState(false);
    const logEndRef = useRef(null);

    const pushStep = (msg) => {
        if (!msg) return;
        setStepLog(prev => [...prev, msg]);
        requestAnimationFrame(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
    };

    const handleClick = async () => {
        if (ConnectionStore.state !== connectionStates.disconnected) {
            ipcRenderer.send('connection-stop');
            setStepLog([]);
            setErrorMsg('');
            return;
        }

        // ── WireGuard: auto-fetch / verify config before connecting ──────────
        if (profile.vpnType === VpnType.WireGuard.label) {
            setErrorMsg('');
            setStepLog([]);
            setBusy(true);

            let result;
            try {
                result = await ensureWgConfig(toJS(profile), msg => {
                    if (msg) pushStep(msg);
                });
            } catch (err) {
                result = { success: false, error: err.message || 'WireGuard setup failed.' };
            }

            setBusy(false);

            if (!result.success) {
                setErrorMsg(result.error || 'Could not prepare WireGuard config.');
                return;
            }

            // Config is on disk — tell ConfigEditor to re-read it.
            runInAction(() => { profile.wgConfigFetched = !profile.wgConfigFetched; });
        }

        setErrorMsg('');
        pushStep(`Handing off to WireGuard service\u2026`);

        ipcRenderer.send('connection-start', {
            profile:     toJS(profile),
            gateway:     toJS(ConnectionStore.gateway),
            wVpnOptions: toJS(WvpnOptions),
        });

        // Once the state changes from disconnected, append a final line.
        const clear = setInterval(() => {
            if (ConnectionStore.state !== connectionStates.disconnected) {
                pushStep(`Connected to ${profile.server?.label || 'server'} \u2713`);
                clearInterval(clear);
            }
        }, 300);
    };

    const isConnected = ConnectionStore.state !== connectionStates.disconnected;
    const label       = busy ? 'Preparing\u2026' : isConnected ? 'Disconnect' : 'Connect';

    // Show the step log while busy or just after a successful connect sequence
    const showLog = !errorMsg && stepLog.length > 0 && !isConnected;

    return (
        <div>
            <button
                className="form-button"
                onClick={handleClick}
                disabled={busy}
                style={busy ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
            >
                {label}
            </button>

            {/* Step-by-step progress log — monospace mini-terminal */}
            {showLog && (
                <div style={S.log}>
                    {stepLog.map((line, i) => {
                        const isCurrent = i === stepLog.length - 1;
                        return (
                            <span key={i} style={isCurrent ? { ...S.line, ...S.lineActive } : S.line}>
                                {isCurrent && busy ? '\u25b6 ' : '\u2714 '}{line}
                            </span>
                        );
                    })}
                    <span ref={logEndRef} />
                </div>
            )}

            {/* Error panel — red, shows completed steps above the error message */}
            {errorMsg && (
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
            )}
        </div>
    );
});

export default ConnectionButton;
