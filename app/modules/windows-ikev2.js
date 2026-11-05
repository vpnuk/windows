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
        `$existing = Get-VpnConnection -Name ${psString(name)} -ErrorAction SilentlyContinue`,
        '$eap = New-EapConfiguration -UseWinlogonCredential:$false -ErrorAction Stop',
        '$validEap = $false',
        'if ($existing -and $existing.EapConfigXmlStream) { [xml]$saved = $existing.EapConfigXmlStream; $t = $saved.SelectSingleNode("//*[local-name()=\'EapMethod\']/*[local-name()=\'Type\']"); $w = $saved.SelectSingleNode("//*[local-name()=\'UseWinLogonCredentials\' or local-name()=\'UseWinlogonCredentials\']"); $validEap = ($t -and $t.InnerText -eq \'26\' -and $w -and $w.InnerText -eq \'false\') }',
    ].join('; ') + '; ' + [
        `if ($existing -and $existing.TunnelType -eq 'Ikev2' -and @($existing.AuthenticationMethod) -contains 'Eap' -and $validEap -and $existing.ServerAddress -eq ${psString(server)} -and -not $existing.SplitTunneling -and $existing.RememberCredential) { Write-Output 'IKEv2 profile reused' } elseif ($existing) {`,
        `Set-VpnConnection -Name ${psString(name)} -TunnelType Ikev2`,
        `-ServerAddress ${psString(server)} -AuthenticationMethod Eap`,
        '-EapConfigXmlStream $eap.EapConfigXmlStream',
        "-SplitTunneling:$false -RememberCredential:$true -Force -ErrorAction Stop; Write-Output 'IKEv2 profile updated in place'",
        '} else {',
    ].join(' ') + ' ' + [
        `Add-VpnConnection -Name ${psString(name)} -TunnelType Ikev2`,
        `-ServerAddress ${psString(server)} -AuthenticationMethod Eap`,
        '-EapConfigXmlStream $eap.EapConfigXmlStream',
        "-SplitTunneling:$false -Force -RememberCredential -PassThru -ErrorAction Stop; Write-Output 'IKEv2 profile created' }",
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
