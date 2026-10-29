import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useStore } from '@domain';
import { bypassPrefixes } from '@modules/ip-bypass.js';

const IpBypassSettings = observer(() => {
    const store = useStore();
    const profile = store.profiles.currentProfile;
    const [text, setText] = useState('');
    const [message, setMessage] = useState('');
    const [hasError, setHasError] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [contentHeight, setContentHeight] = useState(0);
    const contentRef = useRef(null);
    const panelId = `ip-bypass-${profile.id}`;
    useEffect(() => {
        setText((profile.bypassIps || []).join(', '));
        setMessage('');
        setHasError(false);
        setExpanded(false);
    }, [profile.id]);
    useLayoutEffect(() => {
        const content = contentRef.current;
        if (!expanded || !content) {
            setContentHeight(0);
            return;
        }
        const measure = () => setContentHeight(content.scrollHeight);
        measure();
        const resize = new ResizeObserver(measure);
        resize.observe(content);
        return () => resize.disconnect();
    }, [expanded, message, profile.id]);
    const save = () => {
        try {
            const prefixes = bypassPrefixes(text);
            runInAction(() => { profile.bypassIps = prefixes; });
            store.triggerPersist();
            setText(prefixes.join(', '));
            setHasError(false);
            setMessage('Bypass rules saved. Applied on the next connection.');
        } catch (error) {
            setHasError(true);
            setMessage(error.message);
        }
    };
    return <section className="ip-bypass-settings">
        <button type="button" className="ip-bypass-toggle" aria-expanded={expanded}
            aria-controls={panelId} onClick={() => setExpanded(value => !value)}>
            <span>SPLIT TUNNELLING — BYPASS IP ADDRESSES</span>
            <svg className="ip-bypass-chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        </button>
        <div id={panelId} className="ip-bypass-panel" aria-hidden={!expanded}
            style={{ height: contentHeight, visibility: expanded ? 'visible' : 'hidden' }}>
            <div className="ip-bypass-content" ref={contentRef}>
                <p id={`${panelId}-description`} className="ip-bypass-description">
                    Comma separated IPs bypass the VPN and Kill Switch.
                </p>
                <textarea className="ip-bypass-input" rows={4} aria-label="VPN bypass IPv4 addresses"
                    aria-describedby={`${panelId}-description`} tabIndex={expanded ? 0 : -1}
                    spellCheck={false} placeholder="192.168.1.10, 10.0.0.0/8"
                    value={text} onChange={e => setText(e.target.value)} />
                <button type="button" className="form-button-sm ip-bypass-save" tabIndex={expanded ? 0 : -1}
                    onClick={save}>Save Bypass Rules</button>
                {message && <p className={`ip-bypass-message${hasError ? ' ip-bypass-error' : ''}`}
                    role={hasError ? 'alert' : 'status'}>{message}</p>}
            </div>
        </div>
    </section>;
});

export default IpBypassSettings;
