'use strict';
// Config generation belongs to the main process's serialized connect operation,
// not renderer callbacks that can race tray/auto-connect/disconnect.
const fs = require('fs');
const { ipcRenderer } = require('electron');
const { bypassPrefixes } = require('@modules/ip-bypass.js');

function getConfEndpointIp(file) {
    try { return fs.readFileSync(file, 'utf8').match(/^Endpoint\s*=\s*([\d.]+):\d+/m)?.[1] || null; }
    catch { return null; }
}

async function ensureWgConfig(profile, onStatus) {
    try {
        if (!profile.credentials?.login || !profile.credentials?.password) {
            throw new Error('Enter your VPN username and password first.');
        }
        bypassPrefixes(profile.bypassIps);
        if (onStatus) onStatus('Preparing WireGuard — a fresh config will be generated on connect…');
        return await ipcRenderer.invoke('wg-preflight');
    } catch (error) { return { success: false, error: error.message }; }
}

module.exports = { getConfEndpointIp, ensureWgConfig };
