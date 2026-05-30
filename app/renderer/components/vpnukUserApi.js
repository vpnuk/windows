'use strict';
const axios = require('axios');

const PORTAL_BASE = 'https://vpnuk.info/wp-json/vpnuk/v1';
const WG_API_URL  = 'https://clientcp.vpnuk.info/vpnuk/clients/wg_v2_app_api.php';

// ── Portal sign-in ─────────────────────────────────────────────────────────

/**
 * Sign in with VPNUK portal (User Account) credentials.
 * Returns { token: string } on success.
 * Throws an Error with user-friendly message + .code property on failure.
 */
const fetchToken = async (email, password) => {
    let res;
    try {
        const body = new URLSearchParams({ grant_type: 'password', username: email, password });
        res = await axios.post(`${PORTAL_BASE}/token`, body.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            validateStatus: () => true,
            timeout: 15000,
        });
    } catch {
        throw Object.assign(
            new Error('Network error — could not reach VPNUK servers. (E3001)'),
            { code: 'E3001' }
        );
    }

    if (res.status === 200 && res.data?.access_token) {
        return { token: res.data.access_token };
    }

    // 403 or invalid_grant = wrong credentials or 2FA enabled
    if (res.status === 403 || res.data?.code === 'invalid_grant') {
        throw Object.assign(
            new Error(
                'Incorrect email or password.\n' +
                'If you have two-factor authentication enabled, ' +
                'use the VPN Account tab instead. (E1001)'
            ),
            { code: 'E1001' }
        );
    }

    throw Object.assign(
        new Error('Sign-in failed — unexpected response from server. Please try again. (E1003)'),
        { code: 'E1003' }
    );
};

/**
 * Fetch all subscriptions for a signed-in user.
 * Returns an array of subscription objects.
 */
const fetchSubscriptions = async (token) => {
    let res;
    try {
        res = await axios.get(`${PORTAL_BASE}/subscriptions`, {
            headers: { Authorization: `Bearer ${token}` },
            validateStatus: () => true,
            timeout: 15000,
        });
    } catch {
        throw Object.assign(
            new Error('Network error fetching subscriptions. (E3001)'),
            { code: 'E3001' }
        );
    }

    if (!Array.isArray(res.data)) {
        throw Object.assign(
            new Error('Unexpected response from subscriptions API. Please try again. (E1003)'),
            { code: 'E1003' }
        );
    }

    return res.data;
};

/**
 * Returns true if the subscription is currently active.
 */
const isSubActive = (sub) => sub?.status === 'active';

/**
 * Build the renewal URL for a subscription.
 * Uses the WooCommerce subscription ID when available.
 */
const renewalUrl = (subId) =>
    subId
        ? `https://www.vpnuk.net/my-account/view-subscription/${subId}/`
        : 'https://www.vpnuk.net/my-account/subscriptions/';

// ── VPN Account status check (WireGuard only) ─────────────────────────────

/**
 * Check if a VPN Account (direct VPN credentials) subscription is active.
 * Calls check_status on the WireGuard API.
 *
 * Returns: { active: bool, subscriptionId: string|null, isDedicated: bool }
 * On network error: returns { active: true } — fail-open, don't block unnecessarily.
 */
const checkVpnAccountStatus = async (login, password) => {
    try {
        const params = new URLSearchParams({
            action:   'check_status',
            username: login,
            password,
        });
        const res = await axios.post(WG_API_URL, params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            validateStatus: () => true,
            timeout: 12000,
        });

        const data = res.data || {};
        if (typeof data.active === 'boolean' && !data.active) {
            return {
                active:         false,
                subscriptionId: data.subscription_id ?? null,
                isDedicated:    data.is_dedicated     ?? true,
            };
        }
        return { active: true };
    } catch {
        // Network error — fail-open so we don't block on a bad connection
        return { active: true };
    }
};

module.exports = { fetchToken, fetchSubscriptions, isSubActive, renewalUrl, checkVpnAccountStatus };
