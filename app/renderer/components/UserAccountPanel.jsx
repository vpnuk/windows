import React, { useState } from 'react';
import { action, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { ipcRenderer } from 'electron';
import '@components/index.css';

const { fetchToken, fetchSubscriptions, isSubActive, renewalUrl } = require('./vpnukUserApi');

const EyeOpen = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
    </svg>
);
const EyeOff = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
);

const isSubDedicated = (sub) =>
    sub.type === 'Dedicated' || sub.type === 'dedicated' || sub.type === 'dedicated11';

const subTypeLabel = (sub) => isSubDedicated(sub) ? 'Dedicated IP' : 'Shared IP';

const subStatusLabel = (status) => {
    switch (status) {
        case 'active':    return 'Active';
        case 'on-hold':   return 'On Hold';
        case 'cancelled': return 'Cancelled';
        case 'expired':   return 'Expired';
        default:          return status || 'Inactive';
    }
};

// Load VPN credentials from a subscription into the profile.
// The API returns credentials inside vpnaccounts[0], not at the top level.
const applySubscription = action((profile, sub) => {
    const vpnCred = sub.vpnaccounts?.[0];
    profile.credentials.login    = vpnCred?.username || '';
    profile.credentials.password = vpnCred?.password || '';
    profile.userSubscription = {
        id:          sub.id,
        status:      sub.status,
        isDedicated: isSubDedicated(sub),
        type:        sub.type,
    };
});

const UserAccountPanel = observer(({ profile }) => {
    const [email,    setEmail]    = useState(profile.userAccount?.email    || '');
    const [password, setPassword] = useState(profile.userAccount?.password || '');
    const [showPw,   setShowPw]   = useState(false);
    const [signing,  setSigning]  = useState(false);
    const [error,    setError]    = useState('');

    const sub  = profile.userSubscription;
    const subs = profile.userSubscriptions || [];

    const handleSignIn = async () => {
        if (!email.trim() || !password.trim()) {
            setError('Enter your VPNUK account email and password.');
            return;
        }
        setSigning(true);
        setError('');
        try {
            const { token } = await fetchToken(email.trim(), password.trim());
            const allSubs   = await fetchSubscriptions(token);
            const active    = allSubs.filter(isSubActive);

            runInAction(() => {
                profile.userAccount       = { email: email.trim(), password: password.trim() };
                profile.userSubscriptions = allSubs;
            });

            if (active.length > 0) {
                applySubscription(profile, active[0]);
            } else {
                // All expired — record first sub so renewal URL is available
                runInAction(() => {
                    profile.userSubscription = allSubs[0]
                        ? { id: allSubs[0].id, status: allSubs[0].status,
                            isDedicated: isSubDedicated(allSubs[0]), type: allSubs[0].type }
                        : { id: null, status: 'expired', isDedicated: false, type: 'Shared' };
                    profile.credentials.login    = '';
                    profile.credentials.password = '';
                });
            }
        } catch (err) {
            setError(err.message || 'Sign-in failed. Please try again.');
        }
        setSigning(false);
    };

    const handleSignOut = action(() => {
        profile.userSubscription  = null;
        profile.userSubscriptions = [];
        profile.credentials.login    = '';
        profile.credentials.password = '';
        setError('');
    });

    // ── Signed-in view ────────────────────────────────────────────────────────
    if (sub) {
        // If full list is available use it; otherwise synthesise from persisted sub
        // (backward-compat with profiles saved before this build).
        const displaySubs = subs.length > 0
            ? subs
            : [{ id: sub.id, status: sub.status, type: sub.isDedicated ? 'Dedicated' : 'Shared',
                 vpnaccounts: [{ username: profile.credentials.login }] }];

        const hasActive = displaySubs.some(isSubActive);

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                                   textTransform: 'uppercase', color: hasActive ? '#1ACEB8' : '#e6a817' }}>
                        {hasActive ? '● Active' : '⚠ Expired'}
                    </span>
                    <button onClick={handleSignOut}
                        style={{ background: 'transparent', border: 'none', color: '#6b8cad',
                                 fontSize: 11, cursor: 'pointer', padding: '0 2px' }}>
                        Sign out
                    </button>
                </div>
                <div style={{ fontSize: 12, color: '#d6e4f7', marginBottom: 1 }}>
                    {profile.userAccount?.email}
                </div>

                {/* Subscription cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {displaySubs.map(s => {
                        const active   = isSubActive(s);
                        const selected = sub?.id === s.id;
                        const url      = renewalUrl(s.id);
                        return (
                            <div key={s.id}
                                onClick={() => active && applySubscription(profile, s)}
                                style={{
                                    background:   selected ? 'rgba(26,206,184,0.1)' : active ? 'rgba(255,255,255,0.03)' : 'rgba(230,168,23,0.06)',
                                    border:       `1px solid ${selected ? 'rgba(26,206,184,0.5)' : active ? 'rgba(255,255,255,0.12)' : 'rgba(230,168,23,0.4)'}`,
                                    borderRadius: 5,
                                    padding:      '6px 9px',
                                    cursor:       active ? 'pointer' : 'default',
                                    opacity:      active ? 1 : 0.82,
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: 11, color: '#cfdff0' }}>
                                        {subTypeLabel(s)} &middot; #{s.id}
                                    </span>
                                    <span style={{ fontSize: 10, fontWeight: 700, color: active ? '#1ACEB8' : '#e6a817' }}>
                                        {subStatusLabel(s.status)}{selected ? ' ✓' : ''}
                                    </span>
                                </div>
                                {active && s.vpnaccounts?.[0]?.username && (
                                    <div style={{ fontSize: 10, color: '#6b8cad', marginTop: 2 }}>
                                        {s.vpnaccounts[0].username}
                                    </div>
                                )}
                                {!active && (
                                    <button
                                        onClick={e => { e.stopPropagation(); ipcRenderer.send('open-external', url); }}
                                        style={{ marginTop: 4, padding: '3px 8px', background: '#e6a817',
                                                 color: '#000', border: 'none', borderRadius: 3,
                                                 cursor: 'pointer', fontWeight: 700, fontSize: 10 }}
                                    >
                                        Renew on VPNUK Website &rarr;
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    // ── Sign-in form ──────────────────────────────────────────────────────────
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div className="form-label">Account Email</div>
            <input
                className="form-input"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
                disabled={signing}
            />

            <div className="form-label" style={{ marginTop: 4 }}>Account Password</div>
            <div style={{ position: 'relative' }}>
                <input
                    className="form-input"
                    type={showPw ? 'text' : 'password'}
                    placeholder="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(''); }}
                    disabled={signing}
                    style={{ paddingRight: 30, width: '100%', boxSizing: 'border-box' }}
                    onKeyDown={e => e.key === 'Enter' && handleSignIn()}
                />
                <span onClick={() => setShowPw(v => !v)}
                    title={showPw ? 'Hide password' : 'Show password'}
                    style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)',
                             cursor: 'pointer', userSelect: 'none', lineHeight: 1,
                             color: showPw ? '#4a90d9' : '#aaa', fontSize: 15 }}>
                    {showPw ? <EyeOff /> : <EyeOpen />}
                </span>
            </div>

            {error && (
                <div style={{ background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.35)',
                              borderRadius: 5, padding: '7px 10px', fontSize: 11, color: '#e74c3c',
                              lineHeight: 1.5, whiteSpace: 'pre-line' }}>
                    {error}
                </div>
            )}

            <button className="form-button" onClick={handleSignIn} disabled={signing}
                style={{ marginTop: 4, height: 34, fontSize: 13 }}>
                {signing ? 'Signing in…' : 'Sign In'}
            </button>

            <p style={{ margin: 0, fontSize: 10, color: '#6b8cad', textAlign: 'center', lineHeight: 1.4 }}>
                Use your VPNUK account email &amp; password, not your VPN credentials
            </p>
        </div>
    );
});

export default UserAccountPanel;
