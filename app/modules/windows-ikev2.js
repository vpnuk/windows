'use strict';

const psString = value => "'" + String(value).replace(/'/g, "''") + "'";

// Generate type 26 with Windows' supported VpnClient cmdlet. Do not wrap it
// in PEAP or use the signed-in Windows user's credentials.
function createIkev2ProfileCommand(name, server) {
    if (typeof server !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/i.test(server)) {
        throw new Error('IKEv2 requires a valid VPN server hostname.');
    }
    return [
        "$ErrorActionPreference = 'Stop'",
        '$eap = New-EapConfiguration -UseWinlogonCredential:$false -ErrorAction Stop',
    ].join('; ') + '; ' + [
        `Add-VpnConnection -Name ${psString(name)} -TunnelType Ikev2`,
        `-ServerAddress ${psString(server)} -AuthenticationMethod Eap`,
        '-EapConfigXmlStream $eap.EapConfigXmlStream',
        '-SplitTunneling:$false -Force -RememberCredential -PassThru -ErrorAction Stop',
    ].join(' ');
}

// Match the existing VPNUK server proposals. Group 2 and SHA-1 are legacy
// compatibility settings, not a recommendation for new server deployments.
function createIkev2IpsecCommand(name) {
    return [
        "$ErrorActionPreference = 'Stop'; Set-VpnConnectionIPsecConfiguration",
        `-ConnectionName ${psString(name)}`,
        '-AuthenticationTransformConstants SHA196',
        '-CipherTransformConstants AES256',
        '-DHGroup Group2',
        '-EncryptionMethod AES256',
        '-IntegrityCheckMethod SHA384',
        '-PfsGroup None',
        '-Force -ErrorAction Stop',
    ].join(' ');
}

module.exports = { createIkev2ProfileCommand, createIkev2IpsecCommand };
