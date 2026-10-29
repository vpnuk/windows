'use strict';

// process.arch describes Electron, not necessarily Windows (x64 can be
// emulated on ARM64). The native OS decides which driver MSI is usable.
function windowsArch(arch = process.arch, env = process.env) {
    const native = String(env.PROCESSOR_ARCHITEW6432 || env.PROCESSOR_ARCHITECTURE || '').toUpperCase();
    if (native === 'ARM64' || arch === 'arm64') return 'arm64';
    if (native === 'AMD64' || arch === 'x64') return 'x64';
    return 'ia32';
}

function downloadForArch(links, arch = windowsArch()) {
    const key = { arm64: 'arm64', x64: 'win64', ia32: 'win32' }[arch];
    const url = links && (links[key] || (arch === 'arm64' && links.win_arm64));
    if (!url || !/^https:\/\//i.test(url)) {
        throw new Error(`No secure ${arch} download is available. An incompatible driver will not be installed.`);
    }
    return url;
}

function executableArch(file) {
    const data = require('fs').readFileSync(file);
    if (data.length < 64 || data.readUInt16LE(0) !== 0x5a4d) return null;
    const pe = data.readUInt32LE(0x3c);
    if (pe > data.length - 6 || data.toString('ascii', pe, pe + 4) !== 'PE\u0000\u0000') return null;
    return { 0xaa64: 'arm64', 0x8664: 'x64', 0x14c: 'ia32' }[data.readUInt16LE(pe + 4)] || null;
}

module.exports = { windowsArch, downloadForArch, executableArch };
