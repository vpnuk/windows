'use strict';
const fs = require('fs');
const path = require('path');
const { windowsArch, executableArch } = require('./windows-arch');

// All native code in a patch must match Windows, not an emulated Electron process.
function validatePatchFolder(folder, arch = windowsArch()) {
    const bin = path.join(folder, 'bin');
    const exe = path.join(bin, 'openvpn.exe');
    if (!fs.existsSync(exe)) throw new Error('The OpenVPN scramble package is missing bin/openvpn.exe.');
    for (const file of fs.readdirSync(bin)) {
        if (/\.(exe|dll)$/i.test(file) && executableArch(path.join(bin, file)) !== arch) {
            throw new Error(`The OpenVPN scramble package contains an incompatible ${file}; ${arch} is required.`);
        }
    }
    return exe;
}

function patchAvailable(folder, arch = windowsArch()) {
    try { validatePatchFolder(folder, arch); return true; } catch (_) { return false; }
}

function patchExecutable(folder, arch = windowsArch()) {
    try { return validatePatchFolder(folder, arch); } catch (error) {
        throw new Error(`A compatible ${arch} OpenVPN scramble package is not installed. ${error.message}`);
    }
}

function installPatchZip(data, destination, arch = windowsArch()) {
    const AdmZip = require('adm-zip');
    const root = path.resolve(destination);
    fs.mkdirSync(path.dirname(root), { recursive: true });
    // Staging and destination share a volume so the final rename is atomic.
    const staging = fs.mkdtempSync(path.join(path.dirname(root), '.ovpn-patch-'));
    const extracted = path.join(staging, 'new');
    const backup = path.join(staging, 'previous');
    let movedOld = false;
    try {
        const zip = new AdmZip(Buffer.from(data));
        const entries = zip.getEntries();
        if (!entries.length) throw new Error('The OpenVPN scramble ZIP is empty.');
        for (const entry of entries) {
            const name = entry.entryName.replace(/\\/g, '/');
            const parts = name.replace(/\/$/, '').split('/');
            if (parts[0] !== 'bin' || parts.some(part => !part || part === '.' || part === '..' ||
                /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part))) {
                throw new Error('The OpenVPN scramble ZIP must contain only a safe top-level bin/ folder.');
            }
            // Windows ZIP tools may store backslashes. Normalize before
            // extraction so the package always produces a real bin/ directory.
            entry.entryName = name;
        }
        fs.mkdirSync(extracted);
        zip.extractAllTo(extracted, true);
        validatePatchFolder(extracted, arch);
        if (fs.existsSync(root)) {
            fs.renameSync(root, backup);
            movedOld = true;
        }
        try { fs.renameSync(extracted, root); } catch (error) {
            if (movedOld) {
                fs.renameSync(backup, root);
                movedOld = false;
            }
            throw error;
        }
        movedOld = false;
        return true;
    } finally {
        // Preserve the backup if rollback itself failed; never erase the only
        // remaining good installation during an exceptional filesystem failure.
        if (!movedOld) fs.rmdirSync(staging, { recursive: true });
    }
}

module.exports = { validatePatchFolder, patchAvailable, patchExecutable, installPatchZip };
