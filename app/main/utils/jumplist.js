const { app } = require('electron');

const TAWK_URL  = 'https://tawk.to/chat/56bae5de496019e65d794d8f/default';
const VPNUK_URL = 'https://www.vpnuk.net';

// Module-level state so the Jump List can be rebuilt from any call site.
let _status  = 'disconnected';
let _vpnType = '';
let _server  = '';

function _rebuild() {
    const dot = _status === 'connected'   ? '●'
              : _status === 'connecting'  ? '◌'
              : '○';
    const parts = [dot];
    if (_status === 'connected' && _vpnType) parts.push(_vpnType);
    if (_status === 'connected' && _server)  parts.push(_server);
    const statusStr = _status === 'connecting' ? '◌ Connecting…'
                    : parts.join('  ·  ');

    const tasks = [
        {
            program:     process.execPath,
            arguments:   '--show',
            title:       `Show VPNUK  (${statusStr})`,
            description: 'Open the VPNUK app',
            iconPath:    process.execPath,
            iconIndex:   0,
        },
        {
            program:     process.execPath,
            arguments:   '--live-help',
            title:       'Live Help',
            description: 'Open VPNUK live chat support',
            iconPath:    process.execPath,
            iconIndex:   0,
        },
        {
            program:     process.execPath,
            arguments:   '--visit-vpnuk',
            title:       'Visit VPNUK Website',
            description: 'Open vpnuk.net in your browser',
            iconPath:    process.execPath,
            iconIndex:   0,
        },
    ];

    try { app.setUserTasks(tasks); } catch { /* best-effort — Windows only */ }
}

// Call on startup and whenever connection state changes.
function setJumpListStatus(status, vpnType, server) {
    _status  = status  || 'disconnected';
    _vpnType = vpnType || '';
    _server  = server  || '';
    _rebuild();
}

// Kept for backward-compat with startup call in main.js — ignores profiles arg.
function rebuildJumpList() {
    _rebuild();
}

module.exports = { rebuildJumpList, setJumpListStatus };
