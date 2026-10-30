'use strict';
// Deliberately outside Electron's removable application data. Never store
// credentials, configs or keys here: only this Windows user's device labels.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { settingsPath } = require('./constants');

function valid(label) {
    if (typeof label !== 'string' || !/^[a-zA-Z0-9-]{1,32}$/.test(label)) {
        throw new Error('The saved WireGuard device identity is invalid.');
    }
    return label;
}

function labels() {
    const folder = settingsPath.wgRecoveryFolder;
    const journal = path.join(folder, 'devices.json');
    let saved = [];
    if (fs.existsSync(journal)) {
        const data = JSON.parse(fs.readFileSync(journal, 'utf8'));
        if (!Array.isArray(data.labels)) throw new Error('Invalid WireGuard cleanup record.');
        saved = data.labels.map(valid);
    }
    // The uninstaller can preserve an old installation's identity without
    // needing Electron, credentials or a working internet connection.
    for (const file of [path.join(folder, 'device.json'), settingsPath.device]) {
        if (fs.existsSync(file)) saved.push(valid(JSON.parse(fs.readFileSync(file, 'utf8')).label));
    }
    return [...new Set(saved)];
}

function remember(saved) {
    const folder = settingsPath.wgRecoveryFolder;
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, 'devices.json');
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ labels: [...new Set(saved.map(valid))] }), { mode: 0o600 });
    fs.renameSync(temporary, file);
}

function deviceLabel() {
    const saved = labels(); // Corrupt recovery data must not silently lose slots.
    let label;
    if (fs.existsSync(settingsPath.device)) {
        label = valid(JSON.parse(fs.readFileSync(settingsPath.device, 'utf8')).label);
    } else {
        label = saved[saved.length - 1] || `win-${crypto.randomBytes(8).toString('hex')}`;
    }
    // Durable recovery record BEFORE making any request that can create a peer.
    remember([...saved, label]);
    if (!fs.existsSync(settingsPath.device)) {
        fs.mkdirSync(settingsPath.folder, { recursive: true });
        fs.writeFileSync(settingsPath.device, JSON.stringify({ label }), { mode: 0o600 });
    }
    return label;
}

module.exports = { labels, remember, deviceLabel, valid };
