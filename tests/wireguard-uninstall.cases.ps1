$ErrorActionPreference = 'Stop'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('vpnuk-uninstall-tests-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temporary | Out-Null
. (Join-Path $PSScriptRoot '..\nsis\wireguard-uninstall.ps1') -LogDirectory $temporary
$failures = 0
$count = 0

function Assert($Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Case([string]$Name, [scriptblock]$Body) {
    $script:count++
    try { & $Body; Write-Host "PASS $Name" }
    catch { $script:failures++; Write-Host "FAIL $Name`: $_" }
}
function Reset-Fakes {
    $script:products = @()
    $script:devices = @()
    $script:executables = @()
    $script:services = @()
    $script:calls = @()
    $script:msiCode = 0
    $script:deviceCode = 0
    $script:keepDevice = $false
    $script:keepRegistration = $false
    $script:stopFails = $false
    $script:enumerationFails = $false
    $script:signatureStatus = 'Valid'
    $script:Mode = 'RemoveWireGuard'
    $script:LogDirectory = $temporary
    $script:CleanupLog = Join-Path $temporary 'test.log'
}
function Get-WgProducts { return $script:products }
function Get-VerifiedWgDevices {
    if ($script:enumerationFails) { throw 'device enumeration denied' }
    return $script:devices
}
function Get-WgExecutablePaths { return $script:executables }
function Get-WgServices { return $script:services }
function Stop-WgServices([bool]$AllWireGuard, [string]$Directory) {
    $script:calls += 'stop:' + $AllWireGuard
    if ($script:stopFails) { throw 'stop failed' }
    $script:services = @()
}
function Get-AuthenticodeSignature {
    return [pscustomobject]@{ Status = $script:signatureStatus; SignerCertificate = [pscustomobject]@{ Subject = 'CN=WireGuard LLC, O=WireGuard LLC, C=US' } }
}
function Invoke-Native([string]$File, [string[]]$Arguments, [int]$Timeout = 60000) {
    $script:calls += $Arguments[0]
    if ($File -match 'pnputil') {
        if (-not $script:keepDevice -and $script:deviceCode -eq 0) { $script:devices = @() }
        return $script:deviceCode
    }
    if ($File -match 'msiexec') {
        if (-not $script:keepRegistration -and $script:msiCode -in @(0, 1605, 3010)) { $script:products = @(); $script:executables = @() }
        return $script:msiCode
    }
    return 0
}

try {
    Case 'exact ROOT and SWD device identities are accepted, not a fixed 0000 instance' {
        foreach ($id in @('ROOT\WIREGUARD\0000', 'ROOT\WIREGUARD\0042', 'SWD\WireGuard\{A-B}')) {
            Assert (Test-WgDevice ([pscustomobject]@{
                InstanceId = $id; ClassGuid = '4d36e972-e325-11ce-bfc1-08002be10318'
                HardwareIds = @('WireGuard'); Service = 'WireGuard'
            })) "Rejected verified WireGuard device $id"
        }
    }
    Case 'friendly names cannot authorize removing WiFi, Ethernet, OpenVPN or Wintun' {
        foreach ($id in @('PCI\WIREGUARD\0000', 'ROOT\NET\0000', 'ROOT\WINTUN\0000', 'ROOT\WIREGUARDOTHER\0000')) {
            Assert (-not (Test-WgDevice ([pscustomobject]@{
                InstanceId = $id; ClassGuid = '4d36e972-e325-11ce-bfc1-08002be10318'
                HardwareIds = @('WireGuard'); Service = 'WireGuard'
            }))) "Unsafe device accepted: $id"
        }
        Assert (-not (Test-WgDevice ([pscustomobject]@{
            InstanceId = 'ROOT\WIREGUARD\0000'; ClassGuid = '4d36e972-e325-11ce-bfc1-08002be10318'
            HardwareIds = @('OtherVendor'); Service = 'OtherVendor'
        }))) 'Name alone must not prove ownership'
    }
    Case 'already absent software and adapters is idempotent' {
        Reset-Fakes
        Assert ((Invoke-WireGuardRemoval) -eq 0) 'Absent software failed'
        Assert ($script:calls.Count -eq 1) 'Unnecessary native deletion'
    }
    Case 'orphan device is removed even when WireGuard and its services were already uninstalled' {
        Reset-Fakes
        $script:devices = @([pscustomobject]@{ InstanceId = 'ROOT\WIREGUARD\0042' })
        Assert ((Invoke-WireGuardRemoval) -eq 0) 'Orphan cleanup failed'
        Assert ($script:calls -contains '/remove-device') 'PnP removal was skipped'
    }
    Case 'checked shared removal stops tunnels, removes devices and uses the MSI product code' {
        Reset-Fakes
        $script:products = @([pscustomobject]@{ ProductCode = '{12345678-1234-1234-1234-123456789012}' })
        $script:devices = @([pscustomobject]@{ InstanceId = 'ROOT\WIREGUARD\0000' })
        $script:executables = @((Join-Path $temporary 'wireguard.exe'))
        Assert ((Invoke-WireGuardRemoval) -eq 0) 'Removal failed'
        Assert (($script:calls -join ',') -eq 'stop:True,/remove-device,/removedriver,/x') 'Unsafe ordering or unsupported uninstall command'
    }
    Case 'failed service stop prevents device and MSI removal' {
        Reset-Fakes
        $script:stopFails = $true
        try { Invoke-WireGuardRemoval; throw 'expected error' } catch { Assert ($_.Exception.Message -eq 'stop failed') 'Unexpected error' }
        Assert ($script:calls.Count -eq 1) 'Deletion continued after stop failure'
    }
    Case 'incomplete device discovery fails before stopping services or deleting anything' {
        Reset-Fakes
        $script:enumerationFails = $true
        Assert ((Start-Cleanup) -eq 1) 'Enumeration failure reported success'
        Assert ($script:calls.Count -eq 0) 'Mutation continued after discovery failure'
    }
    Case 'unregistered files and invalid executable signatures fail closed before device removal' {
        Reset-Fakes
        $script:executables = @((Join-Path $temporary 'wireguard.exe'))
        Assert ((Start-Cleanup) -eq 1) 'Unverified software was removed'
        Assert ($script:calls.Count -eq 0) 'Mutation continued without verified registration'
        $script:products = @([pscustomobject]@{ ProductCode = '{12345678-1234-1234-1234-123456789012}' })
        $script:signatureStatus = 'NotSigned'
        Assert ((Start-Cleanup) -eq 1) 'Invalid signature was accepted'
        Assert ($script:calls.Count -eq 0) 'Mutation continued after invalid signature'
    }
    Case 'failed PnP removal is not success and does not continue to MSI' {
        Reset-Fakes
        $script:devices = @([pscustomobject]@{ InstanceId = 'ROOT\WIREGUARD\0000' })
        $script:deviceCode = 5
        Assert ((Start-Cleanup) -eq 1) 'PnP failure reported success'
        Assert (-not ($script:calls -contains '/x')) 'MSI ran after device-removal failure'
    }
    Case 'MSI failure and still-registered software cannot report success' {
        foreach ($code in @(1603, 1618)) {
            Reset-Fakes
            $script:products = @([pscustomobject]@{ ProductCode = '{12345678-1234-1234-1234-123456789012}' })
            $script:msiCode = $code
            Assert ((Start-Cleanup) -eq 1) 'MSI error reported success'
        }
        Reset-Fakes
        $script:products = @([pscustomobject]@{ ProductCode = '{12345678-1234-1234-1234-123456789012}' })
        $script:keepRegistration = $true
        Assert ((Start-Cleanup) -eq 1) 'Remaining registration ignored'
    }
    Case 'zero PnP exit code is insufficient if the orphan is still present' {
        Reset-Fakes
        $script:devices = @([pscustomobject]@{ InstanceId = 'ROOT\WIREGUARD\0000' })
        $script:keepDevice = $true
        Assert ((Start-Cleanup) -eq 1) 'Remaining adapter ignored'
    }
    Case 'restart-required status is explicit, never converted into confirmed completion' {
        Reset-Fakes
        $script:devices = @([pscustomobject]@{ InstanceId = 'ROOT\WIREGUARD\0000' })
        $script:deviceCode = 3010
        $script:keepDevice = $true
        Assert ((Start-Cleanup) -eq 3010) 'Restart requirement lost'
        Assert ((Get-Content $script:CleanupLog -Raw) -match 'RESTART REQUIRED') 'Restart not recorded'
    }
    Case 'unchecked/default mode performs only VPNUK-owned tunnel cleanup' {
        Reset-Fakes
        $script:Mode = 'OwnedTunnels'
        $script:ConfigDirectory = $temporary
        Assert ((Start-Cleanup) -eq 0) 'Owned cleanup failed'
        Assert (($script:calls -join ',') -eq 'stop:False') 'Shared WireGuard removal ran without opt-in'
    }
    Case 'native SetupAPI enumeration helper compiles without invoking Windows APIs' {
        Add-Type -Path (Join-Path $PSScriptRoot '..\nsis\WireGuardDevices.cs')
        Assert ($null -ne ('VpnukWireGuardDevices' -as [type])) 'Native helper did not compile'
    }
} finally { Remove-Item -LiteralPath $temporary -Recurse -Force }
Write-Host "$($count - $failures)/$count uninstall checks passed."
if ($failures) { exit 1 }
exit 0
