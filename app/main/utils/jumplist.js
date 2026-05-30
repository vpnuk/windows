const { app } = require('electron');

const TAWK_URL  = 'https://tawk.to/chat/56bae5de496019e65d794d8f/default';
const VPNUK_URL = 'https://www.vpnuk.net';

// Rebuild the Windows taskbar right-click Jump List.
// Called on startup and whenever the profile list changes.
function rebuildJumpList(profiles) {
    const tasks = [
        {
            program:     process.execPath,
            arguments:   '--show',
            title:       'Show VPNUK',
            description: 'Open the VPNUK app',
            iconPath:    process.execPath,
            iconIndex:   0,
        },
    ];

    // One "Connect: <profile>" task per profile
    for (const p of (profiles || [])) {
        tasks.push({
            program:     process.execPath,
            arguments:   `--connect-profile=${p.id}`,
            title:       `Connect: ${p.label}`,
            description: `Connect using ${p.label} (${p.vpnType})`,
            iconPath:    process.execPath,
            iconIndex:   0,
        });
    }

    tasks.push(
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
    );

    try { app.setUserTasks(tasks); } catch { /* best-effort — setUserTasks is Windows-only */ }
}

module.exports = { rebuildJumpList };
