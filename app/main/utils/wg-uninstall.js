'use strict';
const ElectronStore = require('electron-store');
const recovery = require('../../modules/wg-recovery');
const { releasePending } = require('../../modules/wg-config');
const fs = require('fs');
const path = require('path');
const { settingsPath } = require('../../modules/constants');

module.exports = async function cleanup() {
    // Never generate a new identity during uninstall.
    const saved = recovery.labels();
    recovery.remember(saved);
    if (!saved.length) return true;
    // The uninstaller has stopped the owned tunnel. Restore a crash-persisted
    // kill switch before attempting any HTTPS request.
    const ksPath = path.join(settingsPath.folder, 'ks.json');
    if (fs.existsSync(ksPath)) {
        const ks = JSON.parse(fs.readFileSync(ksPath, 'utf8'));
        if (ks.active && ks.gateway) {
            const { addRouteSync, defaultRoute, enableAllIPv6 } = require('./routing');
            addRouteSync(defaultRoute, ks.gateway, defaultRoute);
            enableAllIPv6();
            fs.writeFileSync(ksPath, JSON.stringify({ active: false }));
        }
    }
    require('./bypass-routes').cleanupBypassRoutes();
    const raw = new ElectronStore().get('profiles');
    const state = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const profiles = state && state.profiles && state.profiles.WireGuard;
    if (!Array.isArray(profiles)) return false;
    const seen = new Set();
    let complete = true;
    for (const profile of profiles) {
        const credentials = profile.credentials || {};
        if (!credentials.login || !credentials.password) { complete = false; continue; }
        // Retry another profile if the first has an old password.
        if (seen.has(credentials.login)) continue;
        try {
            await releasePending(profile);
            seen.add(credentials.login);
        } catch (_) {
            complete = false; // Record is already durable; do not expose secrets.
        }
    }
    return complete && seen.size > 0;
};
