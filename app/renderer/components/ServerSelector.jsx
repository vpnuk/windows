/**
 * ServerSelector — scrollable multi-row server list.
 *
 * Replaces the old react-select dropdown.  Dark-blue background throughout;
 * only the selected row gets the bright primary-dark blue highlight.
 * The server type radio (Shared / Dedicated / 1:1) lives in the Profile tab
 * layout in Menu.jsx; this component just renders the list for the current type.
 */

import React, { useRef, useEffect } from 'react';
import { action } from 'mobx';
import { observer } from 'mobx-react-lite';
import ReactCountryFlag from 'react-country-flag';
import '@components/index.css';
import { Servers, useStore } from '@domain';

const toIso = code => (code === 'UK' ? 'GB' : (code || '').toUpperCase());

const ServerSelector = observer(() => {
    const profile = useStore().profiles.currentProfile;
    const catalog = Servers.getCatalog(profile.serverType);
    const listRef = useRef(null);

    useEffect(() => {
        if (!listRef.current) return;
        const sel = listRef.current.querySelector('[data-selected="true"]');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
    }, [profile.serverType, profile.server]);

    return (
        <div ref={listRef} className="server-list">
            {catalog.length === 0 && (
                <div style={{ padding: '12px 10px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                    No servers available
                </div>
            )}
            {catalog.map((server, i) => {
                const isSelected =
                    (profile.server?.host && profile.server.host === server.host) ||
                    (!profile.server?.host && i === 0);

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
