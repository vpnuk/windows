const cp = require('child_process');
const { spawnChild } = require('./async');

const defaultRoute = '0.0.0.0';
exports.defaultRoute = defaultRoute;

exports.getDefaultGateway = async () =>
    (await spawnChild('route', ['print', defaultRoute], { shell: true }))
        .split('\r\n')
        .filter(line => // includes('Default');
            line.indexOf(defaultRoute) != line.lastIndexOf(defaultRoute))
        .pop()
        .split(' ')
        .filter(_ => _)[2];

exports.addRouteSync = (dst, gw, mask = '255.255.255.255') =>
    cp.spawnSync('route', ['add', dst, 'MASK', mask, gw], { shell: true })
        .stdout + '';

exports.deleteRouteSync = (dst, gw) =>
    cp.spawnSync('route', ['delete', dst, gw], { shell: true })
        .stdout + '';

exports.getIPv6Adapters = async () =>
    (await spawnChild('powershell',
        ['Get-NetAdapterBinding', '-ComponentID', 'ms_tcpip6'], { shell: true }))
        .split('\r\n')
        .filter(_ => _)
        .slice(2)
        .map(line => {
            const words = line.split('  ').filter(_ => _);
            return {
                name: words[0].trim(),
                ipv6Enabled: words.pop().trim() === 'True'
            }
        });

exports.disableIPv6 = async adapterName =>
    await spawnChild('powershell',
        [
            'Start-Process', '-FilePath', 'powershell', '-ArgumentList',
            `@('Disable-NetAdapterBinding', '-Name', '''${adapterName}''', '-ComponentID', 'ms_tcpip6')`,
            '-Verb', 'RunAs', '-WindowStyle', 'Hidden' //'-NoNewWindow'
        ],
        { shell: true });
