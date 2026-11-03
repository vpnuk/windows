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
    if (-not ('VpnukWireGuardHash' -as [type])) {
        Add-Type -Path (Join-Path $PSScriptRoot 'WireGuardHash.cs')
    }
    if ([VpnukWireGuardHash]::FileBlake2b256($File) -ine $ExpectedHash) {
        throw 'WireGuard MSI checksum verification failed. Nothing was installed.'
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $File
    if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or
        $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=WireGuard LLC(,|$)') {
        throw 'WireGuard MSI publisher verification failed. Nothing was installed.'
    }
}

function Get-WgMsiIdentity([string]$File) {
    $installer = $null
    $database = $null
    try {
        $installer = New-Object -ComObject WindowsInstaller.Installer
        $database = $installer.OpenDatabase($File, 0)
        $properties = @{}
        foreach ($property in @('ProductCode', 'ProductVersion')) {
            $view = $null
            $record = $null
            try {
                $view = $database.OpenView("SELECT ``Value`` FROM ``Property`` WHERE ``Property``='$property'")
                $view.Execute()
                $record = $view.Fetch()
                if (-not $record) { throw "Verified WireGuard MSI has no $property." }
                $properties[$property] = [string]$record.StringData(1)
            } finally {
                if ($record) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record) }
                if ($view) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view) }
            }
        }
        if ($properties.ProductCode -notmatch '^\{[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\}$') {
            throw 'Verified WireGuard MSI has an invalid product identity.'
        }
        return [pscustomobject]@{ ProductCode = $properties.ProductCode; Version = [version]$properties.ProductVersion }
    } finally {
        if ($database) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($database) }
        if ($installer) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer) }
    }
}

function Test-WgSameProductInstalled($Identity) {
    return @((Get-WgProducts) | Where-Object { $_.ProductCode -eq $Identity.ProductCode }).Count -eq 1
}

function Test-WgInstalledFiles($Identity) {
    foreach ($path in @(Get-WgExecutablePaths)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        $signature = Get-AuthenticodeSignature -LiteralPath $path
        if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or
            $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=WireGuard LLC(,|$)') { continue }
        $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($path)
        if ($version.FileMajorPart -eq $Identity.Version.Major -and
            $version.FileMinorPart -eq $Identity.Version.Minor -and
            $version.FileBuildPart -eq $Identity.Version.Build) { return $true }
    }
    return $false
}

function Assert-WgSourceName([string]$Name) {
    # The official bootstrapper can register a hash-only filename, without .msi.
    # Reuse only a safe basename, never an arbitrary registry-provided path.
    if ($Name -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$' -or
        $Name -ne [IO.Path]::GetFileName($Name)) {
        throw 'WireGuard has an unsafe registered MSI package name. No repair was attempted.'
    }
}

function Get-WgRegisteredSourceName([string]$ProductCode) {
    if (-not ('VpnukWireGuardMsiSource' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class VpnukWireGuardMsiSource {
    [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiSourceListGetInfoW")]
    private static extern uint GetInfo(string product, string userSid, uint context,
        uint options, string property, StringBuilder value, ref uint length);
    public static string PackageName(string product) {
        uint length = 0;
        uint result = GetInfo(product, null, 4, 0, "PackageName", null, ref length);
        if (result != 0 && result != 234) throw new Win32Exception((int)result);
        var value = new StringBuilder(checked((int)length + 1));
        length++;
        result = GetInfo(product, null, 4, 0, "PackageName", value, ref length);
        if (result != 0) throw new Win32Exception((int)result);
        return value.ToString();
    }
}
'@
    }
    $name = [VpnukWireGuardMsiSource]::PackageName($ProductCode)
    Assert-WgSourceName $name
    return $name
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
    # BLAKE2b-256. Authenticode independently verifies the downloaded MSI publisher.
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
    $identity = Get-WgMsiIdentity $file
    $sameProduct = Test-WgSameProductInstalled $identity
    if ($sameProduct -and (Test-WgInstalledFiles $identity)) {
        Assert-NoActiveWgTunnels
        Stop-WgManager
        Remove-Item -LiteralPath $temporary -Recurse -Force
        Write-CleanupLog "WireGuard $($identity.Version) is already installed and verified; no MSI reinstallation needed. Standalone app left closed."
        return 0
    }
    $repairArguments = @()
    if ($sameProduct) {
        $sourceName = Get-WgRegisteredSourceName $identity.ProductCode
        $sourceFile = Join-Path $temporary $sourceName
        if ($sourceFile -ine $file) {
            Move-Item -LiteralPath $file -Destination $sourceFile
            $file = $sourceFile
        }
        # Supply the registered source name and recache the verified MSI.
        # Do not weaken Windows Installer's SecureRepair policy.
        $repairArguments = @('REINSTALL=ALL', 'REINSTALLMODE=vomus')
        Write-CleanupLog 'Repairing existing WireGuard using its registered MSI source name.'
    }
    # Recheck after downloading: a user could have connected in the meantime.
    Assert-NoActiveWgTunnels
    Stop-WgManager
    $msiLog = Join-Path $LogDirectory 'wireguard-install-msi.log'
    $arguments = @('/i', $file, '/qn', '/norestart', 'DO_NOT_LAUNCH=1', '/L*v', $msiLog) + $repairArguments
    $code = Invoke-Native "$env:SystemRoot\System32\msiexec.exe" $arguments 180000
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
