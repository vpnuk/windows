'use strict';
const cp = require('child_process');

// Never import the entire machine-wide log: it includes other tunnels and
// Windows account names. Copy only this tunnel's new entries into its profile.
function redact(line) {
    return line.replace(/\b(PrivateKey|PresharedKey|password)\s*[:=]\s*\S+/gi, '$1 = [redacted]')
        .replace(/\b[A-Za-z0-9+/]{43}=/g, '[redacted key]');
}

function tunnelLines(text, tunnel) {
    const marker = `[TUN] [${tunnel}]`;
    return String(text || '').split(/\r?\n/).filter(line => line.includes(marker)).map(redact);
}

function createDiagnostics(exe, tunnel, write) {
    let pending = null;
    let seen = new Set();
    let available = null;
    return function refresh() {
        if (pending) return pending;
        pending = new Promise(resolve => {
            cp.execFile(exe, ['/dumplog'], {
                shell: false, windowsHide: true, encoding: 'utf8',
                timeout: 5000, maxBuffer: 4 * 1024 * 1024,
            }, (error, stdout) => {
                try {
                    if (error) {
                        if (available !== false) write('[WireGuard native] Diagnostic log unavailable; refresh the Log tab to retry.\n');
                        available = false;
                        resolve([]);
                        return;
                    }
                    available = true;
                    const lines = tunnelLines(stdout, tunnel);
                    const fresh = lines.filter(line => !seen.has(line));
                    // The native ring log is bounded; don't grow this set
                    // forever on long-lived sessions.
                    seen = new Set(lines);
                    for (const line of fresh) write(`[WireGuard native] ${line}\n`);
                    resolve(fresh);
                } catch {
                    // Diagnostics must never prevent driver/service cleanup.
                    resolve([]);
                }
            });
        }).finally(() => { pending = null; });
        return pending;
    };
}

function startupFailure(lines) {
    if (lines.some(line => /Unable to create network adapter:.*device is not ready/i.test(line))) {
        return 'WireGuard could not create its Windows network adapter: the device is not ready. See the Log tab for native diagnostic details.';
    }
    return null;
}

module.exports = { createDiagnostics, tunnelLines, startupFailure };
