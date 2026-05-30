'use strict';
const { Notification, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

const isDev = process.env.ELECTRON_ENV === 'Dev';
let _sender;

const enableAutoUpdate = sender => {
    _sender = sender;
    autoUpdater.autoDownload = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.checkForUpdates().catch(err => {
        isDev && console.log('[updater] check failed:', err.message);
    });
};
exports.enableAutoUpdate = enableAutoUpdate;

// Renderer requests install after user clicks "Restart Now"
ipcMain.on('update-install', () => {
    isDev && console.log('[updater] quit-and-install requested');
    if (!isDev) autoUpdater.quitAndInstall(false, true);
});

autoUpdater.on('checking-for-update', () => {
    isDev && console.log('[updater] checking...');
});

autoUpdater.on('update-available', info => {
    isDev && console.log('[updater] available:', info.version);
    _sender?.send('auto-update-available', { version: info.version });
});

autoUpdater.on('update-not-available', () => {
    isDev && console.log('[updater] up to date');
});

autoUpdater.on('download-progress', progressObj => {
    isDev && console.log(`[updater] ${Math.round(progressObj.percent)}%`);
    _sender?.send('auto-update-progress', { percent: progressObj.percent });
});

autoUpdater.on('update-downloaded', info => {
    isDev && console.log('[updater] downloaded:', info.version);
    _sender?.send('auto-update-ready', { version: info.version });
    try {
        new Notification({
            title: 'VPNUK Update Ready',
            body: `v${info.version} downloaded — restart VPNUK to install.`,
            silent: true,
        }).show();
    } catch {}
});

autoUpdater.on('error', err => {
    // Silently log — never bother the user with background update errors
    isDev && console.log('[updater] error:', err.message);
});
