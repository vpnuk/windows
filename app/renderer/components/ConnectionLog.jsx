import React, { useEffect, useState } from 'react';
const { ipcRenderer } = require('electron');

export default function ConnectionLog({ profileId, active }) {
    const [text, setText] = useState('');
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        setText('');
        setError('');
        if (!active) return;
        let cancelled = false;
        let pending = false;
        const refresh = async () => {
            if (pending) return;
            pending = true;
            try {
                const result = await ipcRenderer.invoke('log-read', profileId);
                if (cancelled) return;
                if (!result.success) throw new Error(result.error);
                setText(result.text);
                setError('');
            } catch {
                if (!cancelled) setError('Could not read the connection log. Try Refresh.');
            } finally { pending = false; }
        };
        refresh();
        const timer = setInterval(refresh, 5000);
        return () => { cancelled = true; clearInterval(timer); };
    }, [profileId, active, revision]);

    return (
        <div style={{ paddingTop: 10 }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                Profile connection log, including native WireGuard tunnel diagnostics.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button className="form-button-sm" onClick={() => setRevision(value => value + 1)}>Refresh</button>
                <button className="form-button-sm" onClick={() => ipcRenderer.send('log-open', profileId)}>Open Connection Log</button>
            </div>
            {error && <p role="alert" style={{ color: 'var(--text)' }}>{error}</p>}
            <pre aria-label="Connection log" tabIndex={0} style={{
                color: 'var(--text)', background: 'var(--panel, #0d1422)',
                border: '1px solid #415573', borderRadius: 8, padding: 10,
                height: 260, overflow: 'auto', whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere', fontSize: 11, lineHeight: 1.5,
            }}>{text || 'No log yet — connect first to generate one.'}</pre>
        </div>
    );
}
