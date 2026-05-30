import { ipcRenderer } from 'electron';
import React from 'react';
import { toJS, runInAction } from 'mobx';
import { connectionStates, VpnType } from '@modules/constants.js';
import { ConnectionStore, ConnectionLogStore, WvpnOptions } from '@domain';

const { ensureWgConfig } = require('../wgApi');
const { checkVpnAccountStatus, renewalUrl } = require('../vpnukUserApi');

/**
 * Shared hook that encapsulates the full VPN connect procedure:
 *   1. Push step-log messages appropriate to the VPN type
 *   2. For User Account: verify cached subscription is still active
 *   3. For VPN Account + WireGuard: call check_status before fetching config
 *   4. For WireGuard: call ensureWgConfig before handing off
 *   5. Send connection-start IPC
 *   6. Poll ConnectionStore until connected or definitively failed
 *
 * Returns { startConnect, busy }
 */
export function useConnectAction(profile) {
    const [busy, setBusy] = React.useState(false);

    const startConnect = async () => {
        ConnectionLogStore.clear();

        const details = profile.details || {};
        const mtuVal  = details.mtu?.value;
        const dnsVal  = details.dns?.value;
        const hasMtu  = !!mtuVal;
        const hasDns  = !!(dnsVal && dnsVal.length);
        const vpnType = profile.vpnType;

        const pushStep = (msg) => { if (msg) ConnectionLogStore.pushStep(msg); };

        // ── User Account: verify cached subscription is still active ──────────
        if (profile.accountType === 'user') {
            const sub = profile.userSubscription;
            if (!sub || sub.status !== 'active') {
                ConnectionLogStore.setSubscriptionExpiredWithUrl(renewalUrl(sub?.id));
                return;
            }
        }

        pushStep('Connection initialised\u2026');

        // ── WireGuard ─────────────────────────────────────────────────────────
        if (vpnType === VpnType.WireGuard.label) {
            setBusy(true);

            // VPN Account: check subscription status via check_status API before fetching config
            if (!profile.accountType || profile.accountType === 'vpn') {
                const { login, password } = profile.credentials || {};
                if (login && password) {
                    pushStep('Checking subscription status\u2026');
                    const statusResult = await checkVpnAccountStatus(login, password);
                    if (!statusResult.active) {
                        ConnectionLogStore.setSubscriptionExpiredWithUrl(renewalUrl(statusResult.subscriptionId));
                        setBusy(false);
                        return;
                    }
                }
            }

            let result;
            try {
                result = await ensureWgConfig(toJS(profile), msg => { if (msg) pushStep(msg); });
            } catch (err) {
                result = { success: false, error: err.message || 'WireGuard setup failed.' };
            }

            setBusy(false);

            if (!result.success) {
                const lower = (result.error || '').toLowerCase();
                const isExpired = lower.includes('not active')
                    || lower.includes('expir')
                    || lower.includes('suspend')
                    || lower.includes('inactive')
                    || lower.includes('disabled')
                    || lower.includes('cancelled');
                if (isExpired) {
                    ConnectionLogStore.setSubscriptionExpiredWithUrl(
                        renewalUrl(profile.userSubscription?.id ?? null)
                    );
                } else {
                    ConnectionLogStore.setError(result.error || 'Could not prepare WireGuard config.');
                }
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

        // ── Windows native VPN — IKEv2 / L2TP ────────────────────────────────
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
