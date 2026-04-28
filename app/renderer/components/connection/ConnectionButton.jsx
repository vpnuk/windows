import { ipcRenderer } from 'electron';
import React, { useState } from 'react';
import { toJS }           from 'mobx';
import { observer }       from 'mobx-react-lite';
import { connectionStates, VpnType } from '@modules/constants.js';
import { ConnectionStore, useStore, WvpnOptions } from '@domain';

const { ensureWgConfig } = require('@components/wgApi.js');

const ConnectionButton = observer(() => {
    const profile = useStore().profiles.currentProfile;

    // stepMsg   — progress text shown while preparing WireGuard (e.g. "Generating config…")
    // errorMsg  — shown in red when the pre-connect step fails
    const [stepMsg,  setStepMsg]  = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [busy,     setBusy]     = useState(false);

    const handleClick = async () => {
        if (ConnectionStore.state !== connectionStates.disconnected) {
            ipcRenderer.send('connection-stop');
            return;
        }

        // ── WireGuard: auto-fetch / verify config before connecting ──────────
        if (profile.vpnType === VpnType.WireGuard.label) {
            setErrorMsg('');
            setStepMsg('');
            setBusy(true);

            let result;
            try {
                result = await ensureWgConfig(toJS(profile), msg => setStepMsg(msg));
            } catch (err) {
                result = { success: false, error: err.message || 'WireGuard setup failed.' };
            }

            setBusy(false);
            setStepMsg('');

            if (!result.success) {
                setErrorMsg(result.error || 'Could not prepare WireGuard config.');
                return;
            }
        }

        setErrorMsg('');
        setStepMsg('Connecting…');
        ipcRenderer.send('connection-start', {
            profile:     toJS(profile),
            gateway:     toJS(ConnectionStore.gateway),
            wVpnOptions: toJS(WvpnOptions),
        });

        // Clear "Connecting…" once the store reflects a non-disconnected state
        const clear = setInterval(() => {
            if (ConnectionStore.state !== connectionStates.disconnected) {
                setStepMsg('');
                clearInterval(clear);
            }
        }, 300);
    };

    const isConnected = ConnectionStore.state !== connectionStates.disconnected;

    const label = busy
        ? 'Preparing…'
        : isConnected ? 'Disconnect' : 'Connect';

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

            {/* Progress / step message — neutral colour, fades in below button */}
            {stepMsg && !errorMsg && (
                <p style={{
                    margin: '6px 0 0',
                    fontSize: 12,
                    textAlign: 'center',
                    color: 'var(--text-muted, #888)',
                    fontStyle: 'italic',
                }}>
                    {stepMsg}
                </p>
            )}

            {/* Error message — red, only shown when pre-connect step fails */}
            {errorMsg && (
                <p style={{
                    margin: '6px 0 0',
                    fontSize: 12,
                    textAlign: 'center',
                    color: '#e74c3c',
                    whiteSpace: 'pre-wrap',
                }}>
                    {errorMsg}
                </p>
            )}
        </div>
    );
});

export default ConnectionButton;
