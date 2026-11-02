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
Install-AndAssertClosed
Write-Host 'PASS real silent WireGuard installation leaves standalone app closed'
$exe = 'C:\Program Files\WireGuard\wireguard.exe'
# Open the official manager deliberately, then exercise same-version repair.
$code = Invoke-Native $exe @('/installmanagerservice') 45000
if ($code -ne 0) { throw "Could not start WireGuard manager for update test: $code" }
$service = New-Object System.ServiceProcess.ServiceController 'WireGuardManager'
try { $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(30)) }
finally { $service.Dispose() }
Install-AndAssertClosed
Write-Host 'PASS real repair/update closes an existing WireGuard manager and does not reopen it'
exit 0
