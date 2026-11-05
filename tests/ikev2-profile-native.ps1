# Uses actual Windows VpnClient/EAP APIs with dummy credentials; never dials.
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
    $ipsecCommand = & node -e "process.stdout.write(require('./app/modules/windows-ikev2').createIkev2IpsecCommand(process.argv[1]))" $name
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate IKEv2 IPsec command' }
    & ([scriptblock]::Create($ipsecCommand)) | Out-Null
    Write-Host 'PASS native Windows accepts IKE AES256/SHA384/Group2 and ESP AES256/SHA196 with no PFS (no live connection attempted)'
    $originalGuid = (Get-VpnConnection -Name $name).Guid
    $request = @{ name = $name; username = 'dummy-user'; password = 'dummy-p@ss<&"-first' } | ConvertTo-Json -Compress
    $request | & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File nsis/ikev2-connect.ps1 -PrepareOnly
    if ($LASTEXITCODE -ne 0) { throw 'First-use non-interactive EAP credential preparation failed' }
    & ([scriptblock]::Create($command)) | Out-Null
    if ((Get-VpnConnection -Name $name).Guid -ne $originalGuid) { throw 'Existing profile was recreated' }
    $request = @{ name = $name; username = 'different-user'; password = 'updated-p@ss<&"-second' } | ConvertTo-Json -Compress
    $request | & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File nsis/ikev2-connect.ps1 -PrepareOnly
    if ($LASTEXITCODE -ne 0) { throw 'Updated EAP credentials could not be prepared' }
    $switchCommand = $command.Replace('example.invalid', 'another.invalid')
    & ([scriptblock]::Create($switchCommand)) | Out-Null
    $switched = Get-VpnConnection -Name $name
    if ($switched.Guid -ne $originalGuid -or $switched.ServerAddress -ne 'another.invalid') { throw 'Server switch did not update in place' }
    Write-Host 'PASS fresh EAP identity without a dialogue, credential replacement, profile reuse and server update in place (no server authentication attempted)'
} finally {
    if (Get-VpnConnection -Name $name -ErrorAction SilentlyContinue) {
        Remove-VpnConnection -Name $name -Force -ErrorAction Stop
    }
}
