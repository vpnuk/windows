import { ipcRenderer } from 'electron';
import React from 'react';
import { toJS, runInAction } from 'mobx';
import { connectionStates, VpnType } from '@modules/constants.js';
import { ConnectionStore, ConnectionLogStore, WvpnOptions, Servers } from '@domain';

const { ensureWgConfig } = require('../wgApi');

/**
 * Shared hook that encapsulates the full VPN connect procedure:
 *   1. Push step-log messages appropriate to the VPN type
 *   2. For WireGuard: call ensureWgConfig before handing off
 *   3. Send connection-start IPC
 *   4. Poll ConnectionStore until connected or definitively failed
 *
 * Used by both ConnectionButton (profile/settings page) and
 * ConnectionSwitch (quick-launch home screen) so both surfaces
 * show an identical, live connection log.
 *
 * Returns { startConnect, busy }
 *   startConnect — async fn, call when user initiates a connection
 *   busy         — true while WireGuard config is being fetched (disables UI)
 */
export function useConnectAction(profile) {
    const [busy, setBusy] = React.useState(false);

    const startConnect = async () => {
        ConnectionLogStore.clear();

        // Auto-init server to first catalog entry when user has never explicitly
        // clicked one — the visual selection fallback (i === 0) in ServerSelector
        // does not set profile.server, so profile.server.host can still be empty.
        if (!profile.server?.host) {
            const catalog = Servers.getCatalog(profile.serverType || 'shared');
            if (catalog.length > 0) {
                runInAction(() => { profile.server = catalog[0]; });
            }
        }

        const details = profile.details || {};
        const mtuVal  = details.mtu?.value;
        const dnsVal  = details.dns?.value;
        const hasMtu  = !!mtuVal;
        const hasDns  = !!(dnsVal && dnsVal.length);
        const vpnType = profile.vpnType;

        const pushStep = (msg) => { if (msg) ConnectionLogStore.pushStep(msg); };

        pushStep('Connection initialised\u2026');

        // ── WireGuard ─────────────────────────────────────────────────────────
        if (vpnType === VpnType.WireGuard.label) {
            setBusy(true);

            let result;
            try {
                result = await ensureWgConfig(toJS(profile), msg => { if (msg) pushStep(msg); });
            } catch (err) {
                result = { success: false, error: err.message || 'WireGuard setup failed.' };
            }

            setBusy(false);

            if (!result.success) {
                ConnectionLogStore.setError(result.error || 'Could not prepare WireGuard config.');
                return;
            }

            runInAction(() => { profile.wgConfigFetched = !profile.wgConfigFetched; });
            pushStep('Handing off to WireGuard service\u2026');
        }

        // ── OpenVPN ───────────────────────────────────────────────────────────
        else if (vpnType === VpnType.OpenVPN.label) {
            if (hasMtu) pushStep(`Applying custom MTU (mss-fix ${mtuVal}) \u2713`);
            if (hasDns) pushStep(`Applying custom DNS (${dnsVal.join(', ')}) \u2713`);

            const protocol = details.protocol || 'TCP';
            const port     = details.port     || '443';
            const isObfs   = protocol === 'Obfuscation';
            pushStep(`Connecting over ${isObfs ? 'UDP (obfuscated)' : protocol} port ${port}\u2026`);
            pushStep('Handing off to OpenVPN service\u2026');
        }

        // ── Windows native VPN — IKEv2, L2TP, PPTP ───────────────────────────
        else {
            if (hasMtu) pushStep('Applying custom MTU settings \u2713');
            if (hasDns) pushStep(`Applying custom DNS (${dnsVal.join(', ')}) \u2713`);
            pushStep('Handing off to native VPN service\u2026');
        }

        ipcRenderer.send('connection-start', {
            profile:     toJS(profile),
            gateway:     toJS(ConnectionStore.gateway),
            wVpnOptions: toJS(WvpnOptions),
        });

        // Poll until we reach a definitive connected or failed state.
        let seenConnecting = false;
        let ticks = 0;
        const maxTicks = 400; // ~120 s safety cap
        const pollId = setInterval(() => {
            ticks++;
            const st = ConnectionStore.state;
            if (st === connectionStates.connecting) {
                seenConnecting = true;
            } else if (st === connectionStates.connected) {
                pushStep(`Connected to ${profile.server?.label || 'server'} \u2713`);
                clearInterval(pollId);
            } else if (st === connectionStates.disconnected && seenConnecting) {
                ConnectionLogStore.setError(
                    'Connection failed. Please check your username and password, then try again.'
                );
                clearInterval(pollId);
            } else if (ticks >= maxTicks) {
                clearInterval(pollId);
            }
        }, 300);
    };

    return { startConnect, busy };
}
