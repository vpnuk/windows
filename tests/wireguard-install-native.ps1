$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Native install test is restricted to disposable GitHub-hosted Windows runners.'
}
. (Join-Path $PSScriptRoot '..\nsis\wireguard-install.ps1') -LogDirectory (Join-Path $env:RUNNER_TEMP 'vpnuk-wg-install-check')
Initialize-ServiceController
$worker = Join-Path $PSScriptRoot '..\nsis\wireguard-install.ps1'
function Install-AndAssertClosed {
    $code = Invoke-Native "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $worker) 480000
    if ($code -ne 0) { throw "Quiet installation did not complete without a restart: $code" }
    $deadline = (Get-Date).AddSeconds(15)
    do {
        $processes = @(Get-Process -Name wireguard -ErrorAction SilentlyContinue)
        if (-not $processes.Count) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if ($processes.Count) { throw 'WireGuard processes remain after quiet installation without active tunnels.' }
    foreach ($service in @(Get-WgServices)) {
        try {
            if ($service.ServiceName -eq 'WireGuardManager' -and $service.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped) {
                throw 'WireGuard manager was left running after installation.'
            }
        } finally { $service.Dispose() }
    }
}
# Reproduce the official bootstrapper's legacy hash-only source filename.
# The original source is deliberately removed before running our helper.
$seed = Join-Path $env:RUNNER_TEMP ('vpnuk-wg-legacy-source-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $seed | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$manifest = Join-Path $seed 'latest.sig'
Invoke-WebRequest -UseBasicParsing -Uri 'https://download.wireguard.com/windows-client/latest.sig' -OutFile $manifest
$entry = Get-WgMsiEntry ([IO.File]::ReadAllText($manifest)) 'AMD64'
$legacyPackage = Join-Path $seed $entry.Hash
Invoke-WebRequest -UseBasicParsing -Uri ('https://download.wireguard.com/windows-client/' + $entry.Name) -OutFile $legacyPackage
Assert-WgMsi $legacyPackage $entry.Hash
$identity = Get-WgMsiIdentity $legacyPackage
$code = Invoke-Native "$env:SystemRoot\System32\msiexec.exe" @('/i', $legacyPackage, '/qn', '/norestart', 'DO_NOT_LAUNCH=1', '/L*v', (Join-Path $env:RUNNER_TEMP 'vpnuk-wg-legacy-seed.log')) 180000
if ($code -ne 0) { throw "Could not seed legacy WireGuard installation: $code" }
if ((Get-WgRegisteredSourceName $identity.ProductCode) -ne $entry.Hash) {
    throw 'Legacy test did not register the hash-only MSI source filename.'
}
Remove-Item -LiteralPath $seed -Recurse -Force
Install-AndAssertClosed
Write-Host 'PASS real silent WireGuard installation leaves standalone app closed'
$exe = 'C:\Program Files\WireGuard\wireguard.exe'
# Open the official manager deliberately, then exercise same-version reuse.
$code = Invoke-Native $exe @('/installmanagerservice') 45000
if ($code -ne 0) { throw "Could not start WireGuard manager for update test: $code" }
$service = New-Object System.ServiceProcess.ServiceController 'WireGuardManager'
try { $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(30)) }
finally { $service.Dispose() }
Install-AndAssertClosed
Write-Host 'PASS same-version reuse closes an existing WireGuard manager and does not reopen it'
$log = Join-Path $env:LOCALAPPDATA 'VPNUK-WireGuard-Recovery\wireguard-install.log'
if ((Get-Content -LiteralPath $log -Raw) -notmatch 'no MSI reinstallation needed') {
    throw 'Existing signed installation was not reused.'
}
# Force an actual repair, not just a same-version skip. The original cached
# source is gone, as on the customer machine; do not change installer policies.
Remove-Item -LiteralPath $exe -Force
Install-AndAssertClosed
if (-not (Test-Path -LiteralPath $exe)) { throw 'Repair did not restore wireguard.exe.' }
if ((Get-Content -LiteralPath $log -Raw) -notmatch 'Repairing existing WireGuard using its registered MSI source name') {
    throw 'Native regression did not exercise the legacy-source repair branch.'
}
Write-Host 'PASS real same-version repair restores missing files with hash-named MSI source absent'
exit 0
