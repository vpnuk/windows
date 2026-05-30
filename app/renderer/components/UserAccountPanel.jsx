import React, { useState } from 'react';
import { action, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { ipcRenderer } from 'electron';
import '@components/index.css';

const { fetchToken, fetchSubscriptions, isSubActive, renewalUrl } = require('./vpnukUserApi');

// ── Eye icon SVG (consistent with Menu.jsx) ───────────────────────────────────
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

const UserAccountPanel = observer(({ profile }) => {
    const [email,    setEmail]    = useState(profile.userAccount?.email    || '');
    const [password, setPassword] = useState(profile.userAccount?.password || '');
    const [showPw,   setShowPw]   = useState(false);
    const [signing,  setSigning]  = useState(false);
    const [error,    setError]    = useState('');

    const sub = profile.userSubscription;

    const handleSignIn = async () => {
        if (!email.trim() || !password.trim()) {
            setError('Enter your VPNUK account email and password.');
            return;
        }
        setSigning(true);
        setError('');

        try {
            const { token } = await fetchToken(email.trim(), password.trim());
            const subs      = await fetchSubscriptions(token);
            const active    = subs.filter(isSubActive);

            if (active.length === 0) {
                // All expired — store the first subscription for the renewal URL
                const firstSub = subs[0] || null;
                runInAction(() => {
                    profile.userAccount      = { email: email.trim(), password: password.trim() };
                    profile.userSubscription = firstSub ? {
                        id:          firstSub.id,
                        status:      firstSub.status,
                        isDedicated: firstSub.type === 'dedicated' || firstSub.type === 'dedicated11',
                        type:        firstSub.type,
                    } : null;
                });
                setError('EXPIRED:Your VPNUK subscription is no longer active.');
                setSigning(false);
                return;
            }

            // Auto-pick the first active subscription; populate VPN credentials
            const picked = active[0];
            runInAction(() => {
                profile.userAccount             = { email: email.trim(), password: password.trim() };
                profile.credentials.login       = picked.username || '';
                profile.credentials.password    = picked.password || '';
                profile.userSubscription        = {
                    id:          picked.id,
                    status:      picked.status,
                    isDedicated: picked.type === 'dedicated' || picked.type === 'dedicated11',
                    type:        picked.type,
                };
            });
        } catch (err) {
            setError(err.message || 'Sign-in failed. Please try again.');
        }
        setSigning(false);
    };

    const handleSignOut = action(() => {
        profile.userSubscription     = null;
        profile.credentials.login    = '';
        profile.credentials.password = '';
        setError('');
    });

    // ── Signed-in state ───────────────────────────────────────────────────────
    if (sub) {
        const isActive = sub.status === 'active';
        const subType  = sub.isDedicated ? 'Dedicated IP' : 'Shared IP';
        const url      = renewalUrl(sub.id);

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{
                    background:   isActive ? 'rgba(26,206,184,0.08)' : 'rgba(230,168,23,0.1)',
                    border:       `1px solid ${isActive ? 'rgba(26,206,184,0.35)' : 'rgba(230,168,23,0.55)'}`,
                    borderRadius: 6,
                    padding:      '8px 12px',
                    display:      'flex',
                    flexDirection:'column',
                    gap:          4,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{
                            fontSize:      11,
                            fontWeight:    700,
                            color:         isActive ? '#1ACEB8' : '#e6a817',
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                        }}>
                            {isActive ? '● Active' : '! Expired'}
                        </span>
                        <button
                            onClick={handleSignOut}
                            style={{ background: 'transparent', border: 'none', color: '#6b8cad', fontSize: 11, cursor: 'pointer', padding: '0 2px' }}
                        >
                            Sign out
                        </button>
                    </div>
                    <div style={{ fontSize: 12, color: '#d6e4f7' }}>{profile.userAccount?.email || ''}</div>
                    <div style={{ fontSize: 11, color: '#6b8cad' }}>{subType} · Subscription #{sub.id}</div>
                    {!isActive && (
                        <button
                            onClick={() => ipcRenderer.send('open-external', url)}
                            style={{
                                marginTop:  4,
                                padding:    '4px 10px',
                                background: '#e6a817',
                                color:      '#000',
                                border:     'none',
                                borderRadius: 4,
                                cursor:     'pointer',
                                fontWeight: 700,
                                fontSize:   11,
                                alignSelf:  'flex-start',
                            }}
                        >
                            Renew on VPNUK Website &rarr;
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // ── Sign-in form ──────────────────────────────────────────────────────────
    const isExpiredError = error.startsWith('EXPIRED:');
    const displayError   = isExpiredError ? error.replace('EXPIRED:', '') : error;
    const expiredSubId   = isExpiredError ? profile.userSubscription?.id : null;

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
                <span
                    onClick={() => setShowPw(v => !v)}
                    title={showPw ? 'Hide password' : 'Show password'}
                    style={{
                        position:  'absolute',
                        right:     7,
                        top:       '50%',
                        transform: 'translateY(-50%)',
                        cursor:    'pointer',
                        userSelect:'none',
                        lineHeight: 1,
                        color:     showPw ? '#4a90d9' : '#aaa',
                        fontSize:  15,
                    }}
                >
                    {showPw ? <EyeOff /> : <EyeOpen />}
                </span>
            </div>

            {displayError && (
                <div style={{
                    background:   isExpiredError ? 'rgba(230,168,23,0.1)'     : 'rgba(231,76,60,0.12)',
                    border:       `1px solid ${isExpiredError ? 'rgba(230,168,23,0.4)' : 'rgba(231,76,60,0.35)'}`,
                    borderRadius: 5,
                    padding:      '7px 10px',
                    fontSize:     11,
                    color:        isExpiredError ? '#e6a817' : '#e74c3c',
                    lineHeight:   1.5,
                    whiteSpace:   'pre-line',
                }}>
                    {isExpiredError ? 'Your VPNUK subscription is no longer active.' : displayError}
                    {isExpiredError && (
                        <div style={{ marginTop: 6 }}>
                            <button
                                onClick={() => ipcRenderer.send('open-external', renewalUrl(expiredSubId))}
                                style={{
                                    background:   '#e6a817',
                                    color:        '#000',
                                    border:       'none',
                                    borderRadius: 4,
                                    padding:      '3px 10px',
                                    fontSize:     11,
                                    fontWeight:   700,
                                    cursor:       'pointer',
                                }}
                            >
                                Renew on VPNUK Website &rarr;
                            </button>
                        </div>
                    )}
                </div>
            )}

            <button
                className="form-button"
                onClick={handleSignIn}
                disabled={signing}
                style={{ marginTop: 4, height: 34, fontSize: 13 }}
            >
                {signing ? 'Signing in\u2026' : 'Sign In'}
            </button>

            <p style={{ margin: 0, fontSize: 10, color: '#6b8cad', textAlign: 'center', lineHeight: 1.4 }}>
                Use your VPNUK account email &amp; password, not your VPN credentials
            </p>
        </div>
    );
});

export default UserAccountPanel;
