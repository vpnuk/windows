'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function writeMetadata(installer, destination, version) {
    const name = path.basename(installer);
    if (!/^[a-zA-Z0-9._-]+\.exe$/.test(name)) throw new Error('Installer name must be URL-safe before generating update metadata.');
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable release version.');
    const bytes = fs.readFileSync(installer);
    if (!bytes.length) throw new Error('Installer is empty.');
    const hash = crypto.createHash('sha512').update(bytes).digest('base64');
    const metadata = [
        `version: ${version}`, 'files:', `  - url: ${name}`,
        `    sha512: ${hash}`, `    size: ${bytes.length}`,
        `path: ${name}`, `sha512: ${hash}`,
        `releaseDate: '${new Date().toISOString()}'`, '',
    ].join('\n');
    fs.writeFileSync(destination, metadata, 'utf8');
    return { name, version, hash, size: bytes.length };
}

if (require.main === module) {
    const [installer, destination] = process.argv.slice(2);
    if (!installer || !destination) throw new Error('Usage: node scripts/update-metadata.js INSTALLER OUTPUT');
    console.log(writeMetadata(installer, destination, require('../package.json').version));
}
module.exports = { writeMetadata };
