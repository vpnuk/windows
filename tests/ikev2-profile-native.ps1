# Uses the actual Windows VpnClient cmdlets; never dials or sends credentials.
$ErrorActionPreference = 'Stop'
$name = 'VPNUK-EAP-Test-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
try {
    $command = & node -e "process.stdout.write(require('./app/modules/windows-ikev2').createIkev2ProfileCommand(process.argv[1], 'example.invalid'))" $name
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate IKEv2 profile command' }
    & ([scriptblock]::Create($command)) | Out-Null
    $profile = Get-VpnConnection -Name $name -ErrorAction Stop
    if ($profile.TunnelType -ne 'Ikev2') { throw 'Wrong tunnel type' }
    if (@($profile.AuthenticationMethod) -notcontains 'Eap') { throw 'EAP not selected' }
    [xml]$xml = $profile.EapConfigXmlStream
    $type = $xml.SelectSingleNode("//*[local-name()='EapMethod']/*[local-name()='Type']")
    if (-not $type -or $type.InnerText -ne '26') { throw 'Expected direct EAP-MSCHAPv2 type 26' }
    $winlogon = $xml.SelectSingleNode("//*[local-name()='UseWinLogonCredentials' or local-name()='UseWinlogonCredentials']")
    if (-not $winlogon -or $winlogon.InnerText -ne 'false') { throw 'Windows logon credentials must be disabled' }
    if ($profile.ServerAddress -ne 'example.invalid') { throw 'Server hostname changed' }
    if ($profile.SplitTunneling) { throw 'Full-tunnel routing changed' }
    Write-Host 'PASS native Windows IKEv2 profile uses EAP type 26 and disables Windows logon credentials'
} finally {
    if (Get-VpnConnection -Name $name -ErrorAction SilentlyContinue) {
        Remove-VpnConnection -Name $name -Force -ErrorAction Stop
    }
}
