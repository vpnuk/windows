param([Parameter(Mandatory = $true)][string]$PackagedInstaller)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Destructive native test is restricted to disposable GitHub-hosted Windows runners.'
}
$temporary = Join-Path $env:RUNNER_TEMP ('vpnuk-wg-removal-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temporary | Out-Null
. (Join-Path $PSScriptRoot '..\nsis\wireguard-uninstall.ps1') -Mode RemoveWireGuard -LogDirectory $temporary
Initialize-ServiceController
. (Join-Path $PSScriptRoot 'wireguard-uninstall-dialog.ps1')
$exe = 'C:\Program Files\WireGuard\wireguard.exe'
$name = 'vpnuk-uninstall-check'
$config = Join-Path $temporary ($name + '.conf')
$appExe = 'C:\Program Files\VPNUK\VPNUK.exe'
if (-not (Test-Path -LiteralPath $appExe)) { throw 'VPNUK must be installed before the packaged uninstall test.' }
function Invoke-PackagedUninstall([bool]$RemoveWireGuard) {
    $uninstallers = @(Get-ChildItem -LiteralPath ([IO.Path]::GetDirectoryName($appExe)) -Filter '*uninstall*.exe')
    if ($uninstallers.Count -ne 1) { throw 'Expected one packaged VPNUK uninstaller.' }
    $message = "Starting real interactive packaged uninstall; radio removal = $RemoveWireGuard"
    Write-Host $message
    Add-Content -LiteralPath (Join-Path $temporary 'packaged-test.log') -Value $message
    Invoke-RadioUninstall $uninstallers[0].FullName $appExe $RemoveWireGuard (Join-Path $temporary 'packaged-test.log')
}
function New-TestKey {
    $bytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    return [Convert]::ToBase64String($bytes)
}
try {
    # Disposable Windows CI only. No live server, default route, DNS or user config.
    @"
[Interface]
PrivateKey = $(New-TestKey)
Address = 10.254.254.253/32
[Peer]
PublicKey = $(New-TestKey)
AllowedIPs = 198.18.0.1/32
Endpoint = 127.0.0.1:9
"@ | Set-Content -LiteralPath $config -Encoding ASCII
    $code = Invoke-Native $exe @('/installtunnelservice', $config)
    if ($code -ne 0) { throw "Could not create test tunnel: $code" }
    $deadline = (Get-Date).AddSeconds(30)
    do {
        $devices = @(Get-VerifiedWgDevices)
        if ($devices.Count) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if (-not $devices.Count) { throw 'Native test did not create an identifiable WireGuard adapter.' }
    Invoke-PackagedUninstall $false
    if (-not (Test-Path -LiteralPath $exe) -or -not @(Get-WgProducts).Count -or -not @(Get-VerifiedWgDevices).Count) {
        throw 'Default VPNUK uninstall removed shared WireGuard or its unrelated adapter.'
    }
    $service = New-Object System.ServiceProcess.ServiceController ('WireGuardTunnel$' + $name)
    try {
        if ($service.Status -ne [ServiceProcess.ServiceControllerStatus]::Running) {
            throw 'Default uninstall interrupted an unrelated WireGuard tunnel.'
        }
    } finally { $service.Dispose() }
    Write-Host 'PASS default packaged uninstall preserves shared WireGuard and its running tunnel'

    $code = Invoke-Native $PackagedInstaller @('/S') 480000
    if ($code -ne 0 -or -not (Test-Path -LiteralPath $appExe)) { throw "VPNUK reinstall failed: $code" }
    Invoke-PackagedUninstall $true
    if (@(Get-WgProducts).Count -or @(Get-WgServices).Count -or @(Get-VerifiedWgDevices).Count) {
        throw 'Packaged optional removal left WireGuard registration, services or adapters.'
    }
    if (Test-Path -LiteralPath $exe) { throw 'WireGuard executable remains after native uninstall.' }
    $log = Join-Path $env:LOCALAPPDATA 'VPNUK-WireGuard-Recovery\wireguard-uninstall.log'
    if (-not (Test-Path -LiteralPath $log)) { throw 'Packaged removal did not save its diagnostic log.' }
    Copy-Item -LiteralPath $log -Destination (Join-Path $temporary 'packaged-wireguard-uninstall.log')
    $logText = [IO.File]::ReadAllText($log)
    if ($logText -match 'NOT COMPLETE:|RESTART REQUIRED:' -or $logText -notmatch 'VERIFIED:') {
        throw 'Packaged cleanup did not report verified completion.'
    }
    if ($logText -notmatch 'WireGuard removal selection=1' -or $logText -notmatch 'Beginning cleanup mode RemoveWireGuard') {
        throw 'Actual radio selection did not reach the full WireGuard removal worker.'
    }
    Write-Host 'PASS packaged optional WireGuard MSI uninstall, active-tunnel stop and adapter/software absence verification'
} catch {
    $_ | Out-String | Add-Content -LiteralPath (Join-Path $temporary 'packaged-test.log')
    # Record window titles, not command lines, environment variables or keys.
    Get-Process | Where-Object { $_.ProcessName -match 'VPNUK|uninstall|Au_|wireguard|powershell|msiexec' } |
        Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize |
        Out-String | Add-Content -LiteralPath (Join-Path $temporary 'packaged-test.log')
    throw
} finally {
    $log = Join-Path $env:LOCALAPPDATA 'VPNUK-WireGuard-Recovery\wireguard-uninstall.log'
    if (Test-Path -LiteralPath $log) { Copy-Item -LiteralPath $log -Destination (Join-Path $temporary 'packaged-wireguard-uninstall.log') -Force }
    if (Test-Path -LiteralPath $config) { Remove-Item -LiteralPath $config -Force }
    # Preserve diagnostic logs as CI artifacts; never preserve synthetic private keys.
}
exit 0
