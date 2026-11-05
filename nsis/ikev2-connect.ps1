# Credentials arrive over the parent's stdin pipe, never argv or a disk file.
param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$stage = 'initialization'
try {
    [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $name = [string]$request.name
    if ($name -ne 'VPNUK-IKEv2' -and $name -notmatch '^VPNUK-EAP-Test-[a-f0-9]+$') {
        throw 'Unexpected connection name'
    }
    $stage = 'EAP credential preparation'
    Add-Type -Path (Join-Path $PSScriptRoot 'Ikev2Credentials.cs') -ErrorAction Stop
    $profile = Get-VpnConnection -Name $name -ErrorAction Stop
    $phonebook = Join-Path $env:APPDATA 'Microsoft\Network\Connections\Pbk\rasphone.pbk'
    [VpnukIkev2.Credentials]::Store($phonebook, $name,
        $profile.EapConfigXmlStream.OuterXml, [string]$request.username, [string]$request.password)
    $request.password = $null
    Write-Output 'IKEv2 EAP credentials prepared for the current Windows user (non-interactive)'
    if ($PrepareOnly) { exit 0 }
    $stage = 'RAS connection'
    # EAP identity has been prepared explicitly above, including on first use.
    # No username/password is exposed to process inspection.
    & "$env:SystemRoot\System32\rasdial.exe" $name
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Write-Output "IKEv2 RAS failure code $code"
        exit $code
    }
    exit 0
} catch {
    # .NET's wrapper message can include an API code, but never print request
    # values, XML, PowerShell invocation details or a stack dump.
    $inner = $_.Exception
    while ($inner.InnerException) { $inner = $inner.InnerException }
    $code = [regex]::Match($inner.Message, 'Windows code (\d+)').Groups[1].Value
    if ($code) { [Console]::Error.WriteLine("IKEv2 $stage failed (Windows code $code)") }
    else { [Console]::Error.WriteLine("IKEv2 $stage failed; no credentials were logged") }
    exit 1
} finally {
    if ($request) { $request.password = $null }
}
