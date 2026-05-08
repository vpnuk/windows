const { dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const isDev = process.env.ELECTRON_ENV === 'Dev';
let _sender;
let _downloading = false; // true only while a download is in progress

const enableAutoUpdate = sender => {
    _sender = sender;
    autoUpdater.autoDownload = false;
    autoUpdater.checkForUpdates().catch(err => {
        isDev && console.log('Update check failed (offline?):', err.message);
    });
};
exports.enableAutoUpdate = enableAutoUpdate;

const notify = ({ type = 'info', title, message }) => {
    try {
        _sender?.send('app-notification', { type, title, message });
    } catch {}
};

autoUpdater.on('checking-for-update', () => {
    isDev && console.log('Checking for update...');
});

autoUpdater.on('update-available', info => {
    isDev && console.log('Update available:', info.version);

    if (dialog.showMessageBoxSync({
        type: 'question',
        icon: path.join(__dirname, '../assets/icon.ico'),
        title: 'VPNUK Update Available',
        message: `Version ${info.version} is ready to download.\n\nThis update includes improvements and new features. Install now?`,
        detail: `You are currently on version ${info.releaseName || 'current'}.`,
        buttons: ['Download & Install', 'Later'],
        cancelId: 1,
        defaultId: 0
    }) !== 1) {
        _sender?.send('auto-update-info', info);
        _downloading = true;
        autoUpdater.downloadUpdate().catch(err => {
            _downloading = false;
            isDev && console.error('Download failed:', err);
            notify({
                type: 'error',
                title: 'Update Download Failed',
                message: 'Could not download the update. Check your internet connection and try again.'
            });
        });
    }
});

autoUpdater.on('update-not-available', () => {
    isDev && console.log('App is up to date.');
});

autoUpdater.on('download-progress', progressObj => {
    _sender?.send('auto-update-progress', progressObj);
    isDev && console.log(`Download progress: ${Math.round(progressObj.percent)}%`);
});

autoUpdater.on('update-downloaded', () => {
    _downloading = false;
    _sender?.send('auto-update-progress', { percent: 100 });
    isDev && console.log('Update downloaded. Restarting to install.');

    dialog.showMessageBoxSync({
        type: 'info',
        icon: path.join(__dirname, '../assets/icon.ico'),
        title: 'VPNUK — Restart Required',
        message: 'Update downloaded successfully.',
        detail: 'VPNUK will restart now to apply the update.',
        buttons: ['Restart Now']
    });

    !isDev && autoUpdater.quitAndInstall();
});

autoUpdater.on('error', err => {
    isDev && console.log('Auto-updater error:', err.message);
    // Only alert the user if they actively triggered a download — never on
    // the background update check (which fails on test/private builds).
    if (_downloading) {
        _downloading = false;
        notify({
            type: 'warning',
            title: 'Update Failed',
            message: 'Could not complete the update. Please try again later.'
        });
    }
});
