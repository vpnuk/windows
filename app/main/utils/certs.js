const { escapeSpaces } = require('../utils/cmd');
const { spawnChild } = require('./async');

const ROOT_CERT_PATH = 'cert:\\LocalMachine\\Root';
const CERT_PATTERN = '\'.*VPNUK Root CA.*\'';

const GET_CMD = [
    'Get-ChildItem', '-path', ROOT_CERT_PATH,
    '^|', 'Where-Object', 'Subject', '-Match', CERT_PATTERN,
];

exports.checkRootCert = async () =>
    (await spawnChild('powershell', GET_CMD, { shell: true }))
        .trim() !== '';

exports.removeRootCert = async () =>
    await spawnChild('powershell',
        [...GET_CMD, '^|', 'Remove-Item'], { shell: true });

exports.importRootCert = async filePath =>
    await spawnChild('powershell', [
        'Import-Certificate',
        '-FilePath', escapeSpaces(filePath),
        '-CertStoreLocation', ROOT_CERT_PATH
    ], { shell: true });

// exports.importRootCert = async filePath =>
//     await spawnChild('powershell', [
//         'Start-Process', '-FilePath', 'powershell', '-ArgumentList',
//         `@('Import-Certificate', '-FilePath', '''${escapeSpaces(filePath)}''', '-CertStoreLocation', '''${ROOT_CERT_PATH}''')`,
//         '-Verb', 'RunAs', '-WindowStyle', 'Hidden'
//     ], { shell: true });
