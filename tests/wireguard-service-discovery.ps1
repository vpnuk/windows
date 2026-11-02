$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This read-only service discovery check requires Windows.' }
. (Join-Path $PSScriptRoot '..\nsis\wireguard-uninstall.ps1') -LogDirectory $env:TEMP
# Run in a fresh powershell.exe -NoProfile process, exactly as the packaged
# helper does. Do not preload ServiceController via service cmdlets or mocks.
Initialize-ServiceController
# Also cover direct construction used by the packaged preservation test,
# which runs in another fresh PowerShell process.
$controller = New-Object System.ServiceProcess.ServiceController 'WireGuardManager'
$controller.Dispose()
$services = @(Get-WgServices)
try {
    if (-not ('System.ServiceProcess.ServiceController' -as [type])) {
        throw 'ServiceController remains unavailable after discovery.'
    }
    foreach ($service in $services) {
        if ($service.ServiceName -notmatch '^WireGuard(Manager|Tunnel\$[a-zA-Z0-9_=+.-]{1,64})$') {
            throw 'Discovery returned a service outside WireGuard.'
        }
    }
    Write-Host 'PASS cold Windows PowerShell ServiceController initialization and read-only discovery'
} finally {
    foreach ($service in $services) { $service.Dispose() }
}
