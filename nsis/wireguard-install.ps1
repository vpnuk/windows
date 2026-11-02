param([string]$LogDirectory = (Join-Path $env:LOCALAPPDATA 'VPNUK-WireGuard-Recovery'))
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'wireguard-uninstall.ps1') -LogDirectory $LogDirectory

function Get-WgMsiEntry([string]$Manifest, [string]$Architecture) {
    $architectureName = @{ AMD64 = 'amd64'; ARM64 = 'arm64'; X86 = 'x86' }[$Architecture.ToUpperInvariant()]
    if (-not $architectureName) { throw "Unsupported Windows architecture: $Architecture" }
    $pattern = '(?m)^([a-fA-F0-9]{64})[ \t]+(wireguard-' + $architectureName + '-[0-9]+(?:\.[0-9]+){1,3}\.msi)\r?$'
    $entries = [regex]::Matches($Manifest, $pattern)
    if ($entries.Count -ne 1) { throw 'No unique WireGuard MSI for this Windows architecture was found.' }
    return [pscustomobject]@{ Hash = $entries[0].Groups[1].Value; Name = $entries[0].Groups[2].Value }
}

function Assert-WgMsi([string]$File, [string]$ExpectedHash) {
    if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ine $ExpectedHash) {
        throw 'WireGuard MSI checksum verification failed. Nothing was installed.'
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $File
    if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or
        $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=WireGuard LLC(,|$)') {
        throw 'WireGuard MSI publisher verification failed. Nothing was installed.'
    }
}

function Assert-NoActiveWgTunnels {
    foreach ($service in @(Get-WgServices)) {
        try {
            if ($service.ServiceName -like 'WireGuardTunnel$*' -and
                $service.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped) {
                throw 'Disconnect all WireGuard tunnels before installing or updating WireGuard, then retry.'
            }
        } finally { $service.Dispose() }
    }
}

function Stop-WgManager {
    foreach ($service in @(Get-WgServices)) {
        try {
            if ($service.ServiceName -ne 'WireGuardManager') { continue }
            $service.Refresh()
            if ($service.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped) {
                if ($service.Status -ne [ServiceProcess.ServiceControllerStatus]::StopPending) { $service.Stop() }
                $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))
            }
            Write-CleanupLog 'WireGuard manager stopped; standalone UI is closed.'
        } finally { $service.Dispose() }
    }
}

function Invoke-QuietWgInstall {
    Initialize-ServiceController
    Assert-NoActiveWgTunnels
    $architecture = $env:PROCESSOR_ARCHITEW6432
    if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    # WireGuard's official manifest supplies the architecture-specific MSI and
    # SHA256. Authenticode independently verifies the downloaded MSI publisher.
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ('vpnuk-wg-install-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $temporary | Out-Null
    # latest.sig has a non-text Content-Type. Read the saved bytes explicitly;
    # Windows PowerShell can otherwise expose Content as a byte[].
    $manifestFile = Join-Path $temporary 'latest.sig'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://download.wireguard.com/windows-client/latest.sig' -OutFile $manifestFile -TimeoutSec 60
    $entry = Get-WgMsiEntry ([IO.File]::ReadAllText($manifestFile)) $architecture
    $file = Join-Path $temporary $entry.Name
    Write-CleanupLog "Downloading official $($entry.Name)"
    Invoke-WebRequest -UseBasicParsing -Uri ('https://download.wireguard.com/windows-client/' + $entry.Name) -OutFile $file -TimeoutSec 120
    Assert-WgMsi $file $entry.Hash
    # Recheck after downloading: a user could have connected in the meantime.
    Assert-NoActiveWgTunnels
    Stop-WgManager
    $msiLog = Join-Path $LogDirectory 'wireguard-install-msi.log'
    $code = Invoke-Native "$env:SystemRoot\System32\msiexec.exe" @('/i', $file, '/qn', '/norestart', 'DO_NOT_LAUNCH=1', '/L*v', $msiLog) 180000
    # MSI can restart an existing manager during repair/upgrade. Close that UI
    # too, without deleting service registrations, configurations or adapters.
    Stop-WgManager
    if ($code -notin @(0, 3010)) { throw "WireGuard MSI installation failed (code $code). See $msiLog" }
    if (-not @(Get-WgProducts).Count -or -not @(Get-WgExecutablePaths).Count) {
        throw 'WireGuard installation could not be verified. See the MSI log.'
    }
    Remove-Item -LiteralPath $temporary -Recurse -Force
    Write-CleanupLog "WireGuard installed quietly, standalone app left closed (code $code)."
    return $code
}

if ($MyInvocation.InvocationName -ne '.') {
    New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
    $script:CleanupLog = Join-Path $LogDirectory 'wireguard-install.log'
    try { exit (Invoke-QuietWgInstall) }
    catch {
        Write-CleanupLog ("INSTALL NOT COMPLETE: " + $_.Exception.Message)
        exit 1
    }
}
