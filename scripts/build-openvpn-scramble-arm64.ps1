param(
    [Parameter(Mandatory=$true)][string]$SourceDirectory,
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$sourceCommit = '038a94bae57a446cc74be9c8386ee475246836f1'
$patchCommit = '2c70045374a39bfb47cada0f797ba97c9f963c19'
$vcpkgCommit = '8d3649ba34aab36914ddd897958599aa0a91b08e'
$patches = [ordered]@{
    '02-tunnelblick-openvpn_xorpatch-a.diff' = 'ad4fd8266dfb05069c5fc39e5fd08a12cad1c0db3eb578bd9acea061012f6aea'
    '03-tunnelblick-openvpn_xorpatch-b.diff' = '3df3c0c19b32c3a2773fa4a537a4137a0da9cdaf6e4a50e7ce226dad7f5fb88d'
    '04-tunnelblick-openvpn_xorpatch-c.diff' = 'e73f44a106a25797ff21d9c55d6b6468c3548b4c902eba89df232f8171d18244'
    '05-tunnelblick-openvpn_xorpatch-d.diff' = '468df92c0397445558c5d1869a7d54c21de907a7cf5064db0ee39c6f94fadbab'
    '06-tunnelblick-openvpn_xorpatch-e.diff' = '5f37bd3a7f6381abed1e2915ddef52f760aaa7559215b0d4d11f13f12e9ecb1e'
}
function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}
function Assert-Arm64([string]$File) {
    $bytes = [IO.File]::ReadAllBytes($File)
    if ($bytes.Length -lt 64 -or [BitConverter]::ToUInt16($bytes, 0) -ne 0x5a4d) {
        throw "Not a PE executable: $File"
    }
    $pe = [BitConverter]::ToInt32($bytes, 60)
    if ($pe -lt 0 -or $pe -gt $bytes.Length - 6 -or
        [BitConverter]::ToUInt32($bytes, $pe) -ne 0x4550 -or
        [BitConverter]::ToUInt16($bytes, $pe + 4) -ne 0xaa64) {
        throw "Not native ARM64: $File"
    }
}
if ($env:OS -ne 'Windows_NT') { throw 'Build requires Windows with MSVC ARM64 tools.' }
if (-not $env:VCPKG_ROOT) { throw 'VCPKG_ROOT must name the pinned vcpkg checkout.' }
$SourceDirectory = (Resolve-Path $SourceDirectory).Path
$actualSource = (& git -C $SourceDirectory rev-parse HEAD).Trim()
$actualVcpkg = (& git -C $env:VCPKG_ROOT rev-parse HEAD).Trim()
if ($actualSource -ne $sourceCommit -or $actualVcpkg -ne $vcpkgCommit) {
    throw 'Source or dependency toolchain revision differs from the reviewed pins.'
}
if (Test-Path $OutputDirectory) { throw 'Use a fresh output directory; stale binaries must not be packaged.' }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
$patchDirectory = Join-Path $OutputDirectory 'patches'
New-Item -ItemType Directory -Path $patchDirectory | Out-Null
Push-Location $SourceDirectory
try {
    if (@(& git status --porcelain).Count) { throw 'OpenVPN source checkout must be clean.' }
    foreach ($entry in $patches.GetEnumerator()) {
        $file = Join-Path $patchDirectory $entry.Key
        Invoke-WebRequest "https://raw.githubusercontent.com/luzrain/openvpn-xorpatch/$patchCommit/patches/v2.6.12/$($entry.Key)" -OutFile $file
        if ((Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) {
            throw "Patch checksum mismatch: $($entry.Key)"
        }
        Invoke-Checked 'git' @('apply', '--check', $file)
        Invoke-Checked 'git' @('apply', $file)
    }
    # Use a static C runtime in both the executable and its rebuilt DLLs;
    # don't assume the user already has an ARM64 Visual C++ redistributable.
    Copy-Item (Join-Path $PSScriptRoot 'arm64-windows-ovpn.cmake') 'contrib/vcpkg-triplets/arm64-windows-ovpn.cmake'
    Invoke-Checked (Join-Path $env:VCPKG_ROOT 'bootstrap-vcpkg.bat') @('-disableMetrics')
    Invoke-Checked 'cmake' @('--preset', 'win-arm64-release', '-DBUILD_TESTING=OFF',
        '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded')
    Invoke-Checked 'cmake' @('--build', '--preset', 'win-arm64-release', '--parallel', '2')
    $build = Join-Path $SourceDirectory 'out/build/win-arm64-release'
    $stage = Join-Path $OutputDirectory 'package'
    $bin = Join-Path $stage 'bin'
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    $files = @(Get-ChildItem $build -Recurse -File | Where-Object {
        $_.Extension -in @('.exe', '.dll') -and
        $_.FullName -notmatch '[\\/](CMakeFiles|vcpkg_installed)[\\/]' -and
        $_.Name -notlike 'test_*'
    })
    $runtime = Join-Path $build 'vcpkg_installed/arm64-windows-ovpn/bin'
    if (Test-Path $runtime) { $files += @(Get-ChildItem $runtime -File -Filter '*.dll') }
    foreach ($file in $files) {
        Assert-Arm64 $file.FullName
        $target = Join-Path $bin $file.Name
        if ((Test-Path $target) -and
            (Get-FileHash $target).Hash -ne (Get-FileHash $file.FullName).Hash) {
            throw "Conflicting runtime files: $($file.Name)"
        }
        Copy-Item $file.FullName $target -Force
    }
    $exe = Join-Path $bin 'openvpn.exe'
    if (-not (Test-Path $exe)) { throw 'Build did not produce bin/openvpn.exe.' }
    if ((Get-AuthenticodeSignature $exe).Status -ne 'NotSigned') {
        throw 'This build must remain unsigned; no signing is permitted.'
    }
    # Verify every imported non-system DLL is present, including transitive
    # dependencies. Never distribute a ZIP that merely contains openvpn.exe.
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    $vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.ARM64 -property installationPath
    if (-not $vs) { throw 'MSVC ARM64 tools not found.' }
    $tools = Get-ChildItem (Join-Path $vs 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
    $dumpbin = Join-Path $tools.FullName 'bin/Hostx64/arm64/dumpbin.exe'
    foreach ($file in Get-ChildItem $bin -File | Where-Object { $_.Extension -in @('.exe', '.dll') }) {
        $imports = & $dumpbin /nologo /imports $file.FullName
        if ($LASTEXITCODE -ne 0) { throw "Cannot inspect imports: $($file.Name)" }
        foreach ($line in $imports) {
            if ($line -match '^\s+([a-zA-Z0-9_.-]+\.dll)\s*$') {
                $dll = $Matches[1]
                if ((Test-Path (Join-Path $bin $dll)) -or $dll -match '^(api|ext)-ms-') { continue }
                if ($dll -match '^(vcruntime|msvcp|concrt)') { throw "Unexpected dynamic C++ runtime: $dll" }
                if (-not (Test-Path (Join-Path "$env:SystemRoot/System32" $dll))) {
                    throw "Missing runtime DLL $dll required by $($file.Name)"
                }
            }
        }
    }
    $archive = Join-Path $OutputDirectory 'openvpn-2612-arm64.zip'
    Compress-Archive -Path $bin -DestinationPath $archive
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        if (-not ($zip.Entries.FullName -contains 'bin/openvpn.exe')) { throw 'Incorrect ZIP layout.' }
        if (@($zip.Entries | Where-Object { $_.FullName -notlike 'bin/*' }).Count) { throw 'Unexpected ZIP root.' }
    } finally { $zip.Dispose() }
    $manifest = [ordered]@{
        version = '2.6.12'; architecture = 'arm64'; unsigned = $true
        openvpnCommit = $sourceCommit; patchCommit = $patchCommit; vcpkgCommit = $vcpkgCommit
        archiveSHA256 = (Get-FileHash $archive).Hash.ToLowerInvariant()
        runtimeTested = $false
        files = @(Get-ChildItem $bin -File | ForEach-Object {
            @{ name = "bin/$($_.Name)"; sha256 = (Get-FileHash $_.FullName).Hash.ToLowerInvariant() }
        })
    }
    $manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $OutputDirectory 'build-manifest.json') -Encoding utf8
    Write-Host "PREPARED unsigned ARM64 package: $archive"
    Write-Host 'ARM64 execution and a live scramble connection still require testing.'
} finally { Pop-Location }
exit 0
