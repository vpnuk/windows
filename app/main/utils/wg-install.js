'use strict';
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

function installWireGuard() {
    const directory = process.env.ELECTRON_ENV === 'Dev'
        ? path.resolve(__dirname, '../../../nsis')
        : path.join(path.dirname(process.execPath), 'install-tools');
    const script = path.join(directory, 'wireguard-install.ps1');
    const root = process.env.SystemRoot || 'C:\\Windows';
    const nativePowerShell = path.join(root, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const powershell = fs.existsSync(nativePowerShell) ? nativePowerShell
        : path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return new Promise((resolve, reject) => {
        cp.execFile(powershell,
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
            { shell: false, windowsHide: true, encoding: 'utf8', timeout: 480000, maxBuffer: 1024 * 1024 },
            (error, stdout, stderr) => {
                const code = error ? error.code : 0;
                if ([0, 3010].includes(code)) return resolve(code);
                if (error && (error.killed || typeof code !== 'number')) {
                    return reject(new Error(`WireGuard install did not finish (${code || 'timeout/launch error'}). Check the WireGuard installation log before retrying.`));
                }
                reject(new Error(String(stdout || stderr || 'WireGuard installation failed.').trim()));
            });
    });
}

module.exports = { installWireGuard };
