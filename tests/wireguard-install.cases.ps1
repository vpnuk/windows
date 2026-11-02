$ErrorActionPreference = 'Stop'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('vpnuk-quiet-install-tests-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temporary | Out-Null
. (Join-Path $PSScriptRoot '..\nsis\wireguard-install.ps1') -LogDirectory $temporary
Initialize-ServiceController
$script:CleanupLog = Join-Path $temporary 'test.log'
$script:count = 0
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Case([string]$Name, [scriptblock]$Test) { & $Test; $script:count++; Write-Host "PASS $Name" }
function Throws([scriptblock]$Test) { try { & $Test } catch { return }; throw 'Expected failure was not raised' }
$manifest = ('a' * 64) + "  wireguard-amd64-1.1.1.msi`r`n" +
    ('b' * 64) + "  wireguard-arm64-1.1.1.msi`n" + ('c' * 64) + "  wireguard-x86-1.1.1.msi"
try {
    Case 'official MSI selection follows native architecture, not emulated app architecture' {
        Assert ((Get-WgMsiEntry $manifest AMD64).Name -eq 'wireguard-amd64-1.1.1.msi') 'Wrong x64 MSI'
        Assert ((Get-WgMsiEntry $manifest ARM64).Name -eq 'wireguard-arm64-1.1.1.msi') 'Wrong ARM64 MSI'
        Assert ((Get-WgMsiEntry $manifest x86).Name -eq 'wireguard-x86-1.1.1.msi') 'Wrong x86 MSI'
    }
    Case 'missing, ambiguous and path-injection MSI entries fail closed' {
        Throws { Get-WgMsiEntry $manifest MIPS }
        Throws { Get-WgMsiEntry '' ARM64 }
        Throws { Get-WgMsiEntry ($manifest + "`n" + $manifest) AMD64 }
        Throws { Get-WgMsiEntry (('a' * 64) + '  ../wireguard-amd64-1.1.1.msi') AMD64 }
    }
    $file = Join-Path $temporary 'test.msi'
    [IO.File]::WriteAllText($file, 'synthetic MSI')
    Add-Type -Path (Join-Path $PSScriptRoot '..\nsis\WireGuardHash.cs')
    Case 'BLAKE2b-256 matches independent empty, partial, full and multiple-block vectors' {
        $vectors = @{
            0 = '0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8'
            127 = 'f2fe67ff342e21b8f45e8f2e0bcd1d9243245d50ee6c78042e9c491388791c72'
            128 = 'c3582f71ebb2be66fa5dd750f80baae97554f3b015663c8be377cfcb2488c1d1'
            129 = 'f7f3c46ba2564ff4c4c162da1f5b605f9f1c4aa6a20652a9f9a337c1a2f5b9c9'
            256 = '582f782226018ec33076bd8d1c42413530ac7e1126260ffc0f306ba3befc3f24'
            1024 = 'd75edc54bb5acee4cc8610568e82872ce79758afd38c51dfe6ccfab01c2d191f'
        }
        foreach ($length in $vectors.Keys) {
            $bytes = New-Object byte[] $length
            for ($i = 0; $i -lt $length; $i++) { $bytes[$i] = $i % 251 }
            [IO.File]::WriteAllBytes($file, $bytes)
            Assert ([VpnukWireGuardHash]::FileBlake2b256($file) -eq $vectors[$length]) "BLAKE2b-256 vector failed at length $length"
        }
    }
    [IO.File]::WriteAllText($file, 'synthetic MSI')
    $hash = [VpnukWireGuardHash]::FileBlake2b256($file)
    $script:signature = [pscustomobject]@{ Status = 'Valid'; SignerCertificate = [pscustomobject]@{ Subject = 'CN=WireGuard LLC, O=WireGuard LLC, C=US' } }
    function Get-AuthenticodeSignature { param($LiteralPath); return $script:signature }
    Case 'MSI hash and publisher are both required' {
        Assert-WgMsi $file $hash
        Throws { Assert-WgMsi $file ('0' * 64) }
        $script:signature.Status = 'NotSigned'
        Throws { Assert-WgMsi $file $hash }
        $script:signature.Status = 'Valid'
        $script:signature.SignerCertificate.Subject = 'CN=Another Vendor, O=Another Vendor'
        Throws { Assert-WgMsi $file $hash }
    }
    $script:services = @()
    function Get-WgServices { return $script:services }
    Case 'active and stop-pending WireGuard tunnels block installation' {
        foreach ($status in @('Running', 'StopPending', 'StartPending')) {
            $service = [pscustomobject]@{ ServiceName = 'WireGuardTunnel$other'; Status = [Enum]::Parse([ServiceProcess.ServiceControllerStatus], $status) }
            $service | Add-Member ScriptMethod Dispose {}
            $script:services = @($service)
            Throws { Assert-NoActiveWgTunnels }
        }
        $service.Status = [ServiceProcess.ServiceControllerStatus]::Stopped
        Assert-NoActiveWgTunnels
    }
    Case 'manager closure does not stop or delete tunnel services' {
        $manager = [pscustomobject]@{ ServiceName = 'WireGuardManager'; Status = [ServiceProcess.ServiceControllerStatus]::Running; Stopped = $false }
        $manager | Add-Member ScriptMethod Refresh {}
        $manager | Add-Member ScriptMethod Stop { $this.Stopped = $true; $this.Status = [ServiceProcess.ServiceControllerStatus]::Stopped }
        $manager | Add-Member ScriptMethod WaitForStatus { param($Status, $Timeout); if ($this.Status -ne $Status) { throw 'Not stopped' } }
        $manager | Add-Member ScriptMethod Dispose {}
        $tunnel = [pscustomobject]@{ ServiceName = 'WireGuardTunnel$other' }
        $tunnel | Add-Member ScriptMethod Dispose {}
        $script:services = @($manager, $tunnel)
        Stop-WgManager
        Assert $manager.Stopped 'Manager was not closed'
    }
    Case 'manager stop failure cannot be treated as closed' {
        $manager = $script:services[0]
        $manager.Status = [ServiceProcess.ServiceControllerStatus]::Running
        $manager | Add-Member ScriptMethod Stop { throw 'Stop denied' } -Force
        $script:services = @($manager)
        Throws { Stop-WgManager }
    }
    $oldArch = $env:PROCESSOR_ARCHITECTURE
    $oldWow = $env:PROCESSOR_ARCHITEW6432
    $script:downloadFolders = @()
    $script:manifest = $manifest
    $script:installCode = 3010
    function Invoke-WebRequest {
        param($Uri, $OutFile, $TimeoutSec, [switch]$UseBasicParsing)
        $script:downloadFolders += [IO.Path]::GetDirectoryName($OutFile)
        if ($Uri -like '*/latest.sig') {
            $script:installCalls += 'manifest'
            [IO.File]::WriteAllText($OutFile, $script:manifest)
        } else {
            Assert ($Uri -eq 'https://download.wireguard.com/windows-client/wireguard-arm64-1.1.1.msi') 'Download did not use native ARM64'
            $script:installCalls += 'download'
            [IO.File]::WriteAllText($OutFile, 'synthetic MSI')
        }
    }
    function Assert-NoActiveWgTunnels { $script:installCalls += 'check' }
    function Assert-WgMsi { param($File, $ExpectedHash); $script:installCalls += 'verify' }
    function Stop-WgManager { $script:installCalls += 'stop' }
    function Get-WgProducts { return @([pscustomobject]@{ ProductCode = 'verified-test-product' }) }
    function Get-WgExecutablePaths { return @('verified-test-executable') }
    function Invoke-Native {
        param($File, [string[]]$Arguments, $Timeout)
        Assert ($Arguments[0] -eq '/i') 'Unexpected MSI action'
        Assert ($Arguments -contains '/qn') 'MSI must have no UI'
        Assert ($Arguments -contains '/norestart') 'MSI must not restart Windows'
        Assert ($Arguments -contains 'DO_NOT_LAUNCH=1') 'MSI must not launch WireGuard'
        $script:installCalls += 'msi'
        return $script:installCode
    }
    try {
        $env:PROCESSOR_ARCHITECTURE = 'x86'
        $env:PROCESSOR_ARCHITEW6432 = 'ARM64'
        Case 'quiet MSI preserves restart result, checks twice and closes manager before and after' {
            $script:installCalls = @()
            Assert ((Invoke-QuietWgInstall) -eq 3010) 'Restart-required result was lost'
            Assert (($script:installCalls -join ',') -eq 'check,manifest,download,verify,check,stop,msi,stop') 'Unsafe install order'
        }
        Case 'MSI failure is reported even when manager closure succeeds' {
            $script:installCalls = @()
            $script:installCode = 1603
            Throws { Invoke-QuietWgInstall }
            Assert ($script:installCalls[-1] -eq 'stop') 'Manager was not closed after MSI failure'
        }
        Case 'failed downloads never launch an installer or stop the manager' {
            function Invoke-WebRequest { param($Uri, $OutFile, $TimeoutSec, [switch]$UseBasicParsing); throw 'Download failed' }
            $script:installCalls = @()
            Throws { Invoke-QuietWgInstall }
            Assert (($script:installCalls -join ',') -eq 'check') 'Download failure continued to mutation'
        }
    } finally {
        $env:PROCESSOR_ARCHITECTURE = $oldArch
        $env:PROCESSOR_ARCHITEW6432 = $oldWow
        foreach ($folder in @($script:downloadFolders | Select-Object -Unique)) {
            if (Test-Path -LiteralPath $folder) { Remove-Item -LiteralPath $folder -Recurse -Force }
        }
    }
    Write-Host "$script:count/$script:count quiet-install checks passed."
} finally { Remove-Item -LiteralPath $temporary -Recurse -Force }
# Pure PowerShell/mocked cases do not necessarily set LASTEXITCODE. Return an
# explicit success status for the workflow, including when an old status exists.
exit 0
