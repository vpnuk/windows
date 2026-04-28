/**
 * ServerSelector — scrollable multi-row server list.
 *
 * Fixed height shows ~7 rows; the rest scrolls.
 * Auto-initialises profile.server to catalog[0] when the server host is blank
 * (new profile, or serverType switch) so the connection flow always has a
 * valid endpoint to work with.
 */

import React, { useRef, useEffect } from 'react';
import { action, runInAction }      from 'mobx';
import { observer }                  from 'mobx-react-lite';
import ReactCountryFlag              from 'react-country-flag';
import '@components/index.css';
import { Servers, useStore }         from '@domain';

const toIso = code => (code === 'UK' ? 'GB' : (code || '').toUpperCase());

const ServerSelector = observer(() => {
    const profile = useStore().profiles.currentProfile;
    const catalog = Servers.getCatalog(profile.serverType);
    const listRef = useRef(null);

    // ── Auto-init: if the stored server has no host, select the first entry ──
    useEffect(() => {
        if (catalog.length > 0 && !profile.server?.host) {
            runInAction(() => { profile.server = catalog[0]; });
        }
    }, [profile.serverType, catalog.length]);

    // ── Scroll the selected row into view ────────────────────────────────────
    // Uses setTimeout(0) so the DOM is fully laid out before scrolling.
    // block:'center' keeps the selection visible even when it's deep in the list.
    // Fires on serverType change too (new catalog = new list = selected may shift).
    useEffect(() => {
        const t = setTimeout(() => {
            if (!listRef.current) return;
            const sel = listRef.current.querySelector('[data-selected="true"]');
            if (sel) sel.scrollIntoView({ block: 'center', behavior: 'auto' });
        }, 0);
        return () => clearTimeout(t);
    }, [profile.server?.host, profile.serverType]);

    return (
        <div ref={listRef} className="server-list">
            {catalog.length === 0 && (
                <div style={{ padding: '12px 10px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                    No servers available
                </div>
            )}
            {catalog.map((server, i) => {
                const isSelected = profile.server?.host
                    ? profile.server.host === server.host
                    : i === 0;

                return (
                    <div
                        key={server.host || server.dns || i}
                        data-selected={isSelected}
                        className={'server-list-item' + (isSelected ? ' server-list-item--selected' : '')}
                        onClick={action(() => { profile.server = server; })}
                    >
                        {server.countryCode ? (
                            <ReactCountryFlag
                                countryCode={toIso(server.countryCode)}
                                svg
                                style={{ width: 18, height: 14, flexShrink: 0 }}
                            />
                        ) : (
                            <span style={{ width: 18, flexShrink: 0 }} />
                        )}
                        <div className="server-list-item-text">
                            <span className="server-list-item-name">{server.label}</span>
                            {server.city && (
                                <span className="server-list-item-city">{server.city}</span>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
});

export default ServerSelector;
