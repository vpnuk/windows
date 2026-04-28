const connectionStates = {
    disconnected: 'Disconnected',
    connecting: 'Connecting',
    connected: 'Connected',
};
Object.freeze(connectionStates);
exports.connectionStates = connectionStates;

exports.optionsMtu = [
    { value: '', label: 'MTU: Default' },
    { value: '1500', label: 'MTU: 1500' },
    { value: '1450', label: 'MTU: 1450' },
    { value: '1400', label: 'MTU: 1400' },
    { value: '1350', label: 'MTU: 1350' },
    { value: '1300', label: 'MTU: 1300' },
    { value: '1250', label: 'MTU: 1250' },
    { value: '1200', label: 'MTU: 1200' },
    { value: '1150', label: 'MTU: 1150' },
    { value: '1100', label: 'MTU: 1100' },
];

const path = require('path');
const settingsFolder = path.resolve(require('process').env.APPDATA + '\\VPNUK');
exports.settingsFolder = settingsFolder;

// Returns the fixed .conf filename slug for a given serverType.
// Each account type gets exactly one conf file — no per-server filenames.
//   dedicated  → dedicated.conf
//   dedicated11 → 11dedicated.conf
//   shared     → shared.conf
// Server-switching is handled by detecting Endpoint IP mismatch and
// regenerating the file automatically on the next Connect click.
// The serverDns argument is accepted but intentionally ignored.
exports.wgConfSlug = (serverType, _serverDns) => {
    if (serverType === 'dedicated')   return 'dedicated';
    if (serverType === 'dedicated11') return '11dedicated';
    return 'shared';
};

exports.settingsPath = {
    folder: settingsFolder,
    versions: path.join(settingsFolder, 'versions.json'),
    dns: path.join(settingsFolder, 'dns.json'),
    servers: path.join(settingsFolder, 'servers.json'),
    ovpn: path.join(settingsFolder, 'openvpn-configuration.ovpn'),
    ovpnObfucation: path.join(settingsFolder, 'openvpn-obfuscation-configuration.ovpn'),
    profile: path.join(settingsFolder, 'profile.txt'),
    ovpnBinFolder: path.join(settingsFolder, 'ovpnBin/'),
    ovpnBinExe: path.join(settingsFolder, 'ovpnBin', 'bin', 'openvpn.exe'),
    ikev2Cert: path.join(settingsFolder, 'ikev2.crt'),
    device: path.join(settingsFolder, 'device.json'),
    wgConf: (serverType, serverDns) => {
        const slug = exports.wgConfSlug(serverType, serverDns);
        return path.join(settingsFolder, `${slug}.conf`);
    },
};

const baseAddress = 'https://www.serverlistvault.com/';
exports.settingsLink = {
    versions: baseAddress + 'versions.json',
    dns: baseAddress + 'dns.json',
    servers: baseAddress + 'servers.json',
    ovpn: baseAddress + 'openvpn-configuration.ovpn',
    ovpnObfucation: baseAddress + 'openvpn-obfuscation-configuration.ovpn'
};

exports.phoneBookPath = path.resolve(
    require('process').env.APPDATA
    + '\\Microsoft\\Network\\Connections\\Pbk\\rasphone.pbk'
);

const VpnType = {
    WireGuard: { label: 'WireGuard' },
    OpenVPN:   { label: 'OpenVPN' },
    IKEv2:     { label: 'IKEv2' },
    L2TP:      { label: 'L2TP' },
    PPTP:      { label: 'PPTP' },
};
exports.VpnType = VpnType;

exports.WG_AUTH_URL = 'https://clientcp.vpnuk.info/vpnuk/clients/wg_v2_app_api.php';
