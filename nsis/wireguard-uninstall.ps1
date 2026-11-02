param(
    [ValidateSet('OwnedTunnels', 'RemoveWireGuard')][string]$Mode = 'OwnedTunnels',
    [string]$ConfigDirectory,
    [string]$LogDirectory = (Join-Path $env:LOCALAPPDATA 'VPNUK-WireGuard-Recovery')
)
$ErrorActionPreference = 'Stop'

function Write-CleanupLog([string]$Message) {
    $line = '{0:u} {1}' -f (Get-Date), $Message
    Write-Host $line
    Add-Content -LiteralPath $script:CleanupLog -Value $line -Encoding UTF8
}

function ConvertTo-NativeArgument([string]$Argument) {
    if ($Argument -match '["\r\n]') { throw 'Invalid native argument.' }
    # NSIS requires bare switches: "/S" does not enable silent mode.
    # Quote only empty/whitespace-containing arguments; protect trailing slashes.
    if ($Argument -eq '' -or $Argument -match '[ \t]') {
        return '"' + [regex]::Replace($Argument, '(\\+)$', '$1$1') + '"'
    }
    return $Argument
}

function Invoke-Native([string]$File, [string[]]$Arguments, [int]$Timeout = 60000) {
    # Arguments originate in verified service names, PnP IDs or MSI product IDs.
    # Do not execute registry UninstallString values or pass commands to a shell.
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $File
    $start.Arguments = ($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $process = [Diagnostics.Process]::Start($start)
    try {
        if (-not $process.WaitForExit($Timeout)) {
            # In particular, do not kill an in-progress Windows Installer.
            throw "Timed out waiting for $([IO.Path]::GetFileName($File)); removal is not confirmed. Check the cleanup log before retrying."
        }
        return $process.ExitCode
    } finally { $process.Dispose() }
}

function Get-WgServices {
    return @([System.ServiceProcess.ServiceController]::GetServices() |
        Where-Object { $_.ServiceName -eq 'WireGuardManager' -or $_.ServiceName -match '^WireGuardTunnel\$[a-zA-Z0-9_=+.-]{1,64}$' })
}

function Test-OwnedTunnel([string]$Name, [string]$Directory) {
    if ($Name -notmatch '^WireGuardTunnel\$[a-zA-Z0-9_=+.-]{1,64}$') { return $false }
    $key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey("SYSTEM\CurrentControlSet\Services\$Name")
    if (-not $key) { throw "Could not verify tunnel ownership: $Name" }
    try { $command = [string]$key.GetValue('ImagePath') } finally { $key.Dispose() }
    $argument = [regex]::Match($command, '(?i)/tunnelservice[ \t]+(?:"([^"]+)"|([^ \t\r\n]+))')
    if (-not $argument.Success) { return $false }
    $file = $argument.Groups[1].Value
    if (-not $file) { $file = $argument.Groups[2].Value }
    return [string]::Equals([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($file)).TrimEnd('\'),
        [IO.Path]::GetFullPath($Directory).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
}

function Stop-WgServices([bool]$AllWireGuard, [string]$Directory) {
    foreach ($service in @(Get-WgServices)) {
        try {
            $name = $service.ServiceName
            if (-not $AllWireGuard -and -not (Test-OwnedTunnel $name $Directory)) { continue }
            Write-CleanupLog "Stopping service $name"
            $service.Refresh()
            if ($service.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped) {
                if ($service.Status -ne [ServiceProcess.ServiceControllerStatus]::StopPending) { $service.Stop() }
                $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))
            }
            $code = Invoke-Native "$env:SystemRoot\System32\sc.exe" @('delete', $name)
            if ($code -notin @(0, 1060, 1072)) { throw "Service removal failed for $name (code $code)." }
        } finally { $service.Dispose() }
    }
    $deadline = (Get-Date).AddSeconds(30)
    do {
        $remaining = @()
        foreach ($service in @(Get-WgServices)) {
            try {
                if ($AllWireGuard -or (Test-OwnedTunnel $service.ServiceName $Directory)) { $remaining += $service.ServiceName }
            } finally { $service.Dispose() }
        }
        if (-not $remaining.Count) { return }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    throw 'WireGuard services remain pending removal. Close WireGuard and retry; removal is not confirmed.'
}

function Get-WgProducts {
    $result = @{}
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, $view)
        try {
            $root = $base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')
            if (-not $root) { continue }
            try {
                foreach ($name in $root.GetSubKeyNames()) {
                    $key = $root.OpenSubKey($name)
                    if (-not $key) { throw 'Cannot inspect an installed software record.' }
                    try {
                        if ($key.GetValue('DisplayName') -ne 'WireGuard') { continue }
                        if ($key.GetValue('Publisher') -ne 'WireGuard LLC' -or
                            $key.GetValue('WindowsInstaller') -ne 1 -or
                            $name -notmatch '^\{[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\}$') {
                            throw 'WireGuard has an unrecognized uninstall record. Refusing to run an unverified uninstall command.'
                        }
                        $result[$name] = [pscustomobject]@{ ProductCode = $name }
                    } finally { $key.Dispose() }
                }
            } finally { $root.Dispose() }
        } finally { $base.Dispose() }
    }
    return @($result.Values)
}

function Get-WgExecutablePaths {
    $paths = @()
    foreach ($folder in @($env:ProgramW6432, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($folder) { $paths += Join-Path $folder 'WireGuard\wireguard.exe' }
    }
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, $view)
        try {
            $key = $base.OpenSubKey('SOFTWARE\WireGuard')
            if ($key) {
                try {
                    $directory = [string]$key.GetValue('InstallationDirectory')
                    if ($directory -and [IO.Path]::IsPathRooted($directory)) { $paths += Join-Path $directory 'wireguard.exe' }
                } finally { $key.Dispose() }
            }
        } finally { $base.Dispose() }
    }
    return @($paths | Select-Object -Unique | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
}

function Get-VerifiedWgDevices {
    if (-not ('VpnukWireGuardDevices' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'WireGuardDevices.cs') }
    return @([VpnukWireGuardDevices]::Candidates() | ForEach-Object {
        if (-not (Test-WgDevice $_)) { throw "Cannot safely identify leftover device $($_.InstanceId); it was not removed." }
        $_
    })
}

function Test-WgDevice($Device) {
    $idMatches = $Device.InstanceId -match '^(ROOT|SWD)\\WIREGUARD\\[^"\r\n]+$'
    $netClass = [string]$Device.ClassGuid -eq '4d36e972-e325-11ce-bfc1-08002be10318'
    $hardwareMatches = @($Device.HardwareIds | Where-Object { $_ -match '^(ROOT\\)?WireGuard$' }).Count -gt 0
    return $idMatches -and $netClass -and ($hardwareMatches -or $Device.Service -eq 'WireGuard')
}

function Remove-WgDevices {
    $restart = $false
    foreach ($device in @(Get-VerifiedWgDevices)) {
        Write-CleanupLog "Removing verified WireGuard device $($device.InstanceId)"
        $code = Invoke-Native "$env:SystemRoot\System32\pnputil.exe" @('/remove-device', $device.InstanceId)
        if ($code -eq 3010) { $restart = $true }
        elseif ($code -ne 0) {
            # Removing a parent can also remove another enumerated device.
            # Only its actual absence makes a nonzero result harmless.
            $stillPresent = @(Get-VerifiedWgDevices | Where-Object { $_.InstanceId -eq $device.InstanceId })
            if ($stillPresent.Count) { throw "Device removal failed (code $code): $($device.InstanceId)" }
        }
    }
    return $restart
}

function Invoke-WireGuardRemoval {
    # Check discovery/registration before mutating anything.
    $products = @(Get-WgProducts)
    $null = @(Get-VerifiedWgDevices)
    $executables = @(Get-WgExecutablePaths)
    # Keep custom-location paths after MSI removes its installation registry key.
    $knownFiles = @($executables)
    foreach ($exe in $executables) {
        $knownFiles += Join-Path ([IO.Path]::GetDirectoryName($exe)) 'wg.exe'
    }
    if (-not $products.Count -and $executables.Count) {
        throw 'WireGuard files exist without a verified MSI registration. Refusing to delete software files manually.'
    }
    foreach ($exe in $executables) {
        $signature = Get-AuthenticodeSignature -LiteralPath $exe
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=WireGuard LLC(,|$)') {
            throw 'WireGuard executable signature could not be verified. No executable was run.'
        }
    }
    Stop-WgServices $true ''
    $restart = Remove-WgDevices
    foreach ($exe in $executables) {
        # This is WireGuard's supported driver command, not /uninstall.
        if (@(Get-VerifiedWgDevices).Count) {
            if (-not $restart) { throw 'WireGuard devices remain; driver removal was not attempted.' }
            Write-CleanupLog 'Adapter removal requires restart; driver removal deferred.'
            break
        }
        $code = Invoke-Native $exe @('/removedriver')
        if ($code -eq 3010) { $restart = $true }
        elseif ($code -ne 0) { throw "WireGuard driver removal failed (code $code)." }
    }
    foreach ($product in $products) {
        $msiLog = Join-Path $LogDirectory ('wireguard-msi-' + $product.ProductCode.Trim('{}') + '.log')
        Write-CleanupLog "Uninstalling verified WireGuard MSI $($product.ProductCode)"
        $code = Invoke-Native "$env:SystemRoot\System32\msiexec.exe" @('/x', $product.ProductCode, '/qn', '/norestart', '/L*v', $msiLog) 180000
        if ($code -eq 3010) { $restart = $true }
        elseif ($code -notin @(0, 1605)) { throw "Windows Installer did not complete WireGuard removal (code $code). Log: $msiLog" }
    }
    # MSI success alone does not prove its adapter custom action succeeded.
    if (Remove-WgDevices) { $restart = $true }
    if (@(Get-WgProducts).Count) { throw 'WireGuard is still registered as installed.' }
    if (@(Get-WgServices).Count) { throw 'WireGuard services still exist.' }
    $remainingFiles = @($knownFiles | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
    if ($remainingFiles.Count -or @(Get-WgExecutablePaths).Count -or @(Get-VerifiedWgDevices).Count) {
        if (-not $restart) { throw 'WireGuard files or adapters remain. Removal is not complete.' }
    }
    if ($restart) {
        Write-CleanupLog 'RESTART REQUIRED: WireGuard removal is pending, not confirmed complete until Windows restarts.'
        return 3010
    }
    Write-CleanupLog 'VERIFIED: WireGuard software, services and identified WireGuard devices are absent.'
    return 0
}

function Start-Cleanup {
    New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
    $script:CleanupLog = Join-Path $LogDirectory 'wireguard-uninstall.log'
    try {
        Write-CleanupLog "Beginning cleanup mode $Mode"
        if ($Mode -eq 'OwnedTunnels') {
            if (-not $ConfigDirectory -or -not [IO.Path]::IsPathRooted($ConfigDirectory)) { throw 'An absolute VPNUK config directory is required.' }
            Stop-WgServices $false $ConfigDirectory
            return 0
        }
        return Invoke-WireGuardRemoval
    } catch {
        Write-CleanupLog ('NOT COMPLETE: ' + $_.Exception.Message)
        return 1
    }
}

# Dot-sourcing exposes the functions to isolated, non-Windows mocked tests.
if ($MyInvocation.InvocationName -ne '.') { exit (Start-Cleanup) }
