# OpenVPN 2.6.12 scramble — ARM64 preparation

## Status

The native ARM64 archive is hosted and its `openvpn.patch.arm64` entry is live.
The hosted ZIP SHA256 is:
`9858f5d7d46c37194b3f1fa60c5895b6a27eb5cb510ddbdbf09e85cdbe02cbd3`.
The executable identifies OpenVPN 2.6.12 and contains the scramble option.
It and all four supporting DLLs are native ARM64.

The package includes the owner's Microsoft ARM64 `vcruntime140.dll`.
The original four binary payloads remain byte-for-byte unchanged; 924 imported
symbols were checked against the packaged DLL exports. Remaining imported DLLs
are Windows system libraries or API-set contracts. Archive CRC checks pass.
No ARM64 execution or live VPN connection has been tested here. These package
checks do not establish runtime VPN compatibility.

The supplied x86 and x64 archives both use `bin/` at the ZIP root. Each contains
16 PE executables/libraries plus `c_rehash`; all native files match their
advertised architecture. The new package preserves the `bin/openvpn.exe` layout
and includes the native runtime files it actually builds. It does not copy
x86/x64 DLLs or promise an identical set of unrelated GUI/tool executables.

## Source and build

- Official OpenVPN 2.6.12 commit:
  `038a94bae57a446cc74be9c8386ee475246836f1`.
- Tunnelblick-derived five-file XOR/scramble patch set:
  https://github.com/luzrain/openvpn-xorpatch/tree/2c70045374a39bfb47cada0f797ba97c9f963c19/patches/v2.6.12
- Every patch has a pinned SHA256, checked before application.
- vcpkg is pinned to the revision used by upstream OpenVPN 2.6.12's Windows CI.
- The prepared workflow uses upstream's Windows ARM64 CMake preset and requests
  a static C runtime. Its import check rejects unbundled dynamic runtime DLLs.
- Every packaged EXE and DLL must be native ARM64.
- An import check rejects missing non-system DLL dependencies.
- No eSigner, code-signing secrets, release creation or server upload.

After owner approval to push, manually run the workflow
**Build unsigned OpenVPN 2.6.12 scramble ARM64 package**.
It uploads a private Actions artifact containing:

- `openvpn-2612-arm64.zip`
- `build-manifest.json`, including source pins, file hashes and the explicit
  `runtimeTested: false` status.

An x64 build host can cross-compile the package; that is not an ARM64 execution
test. Native execution, dependency loading, and a connection to VPNUK's actual
scramble server still need checking. Source compilation does not prove the
administrator's custom build and this patch are identical.

## App changes

- ARM64 uses `openvpn.patch.arm64` (`win_arm64` remains a legacy alias).
- Missing optional ARM64 patches do not prevent standard TCP/UDP VPN use.
- Wrong-architecture cached executables or DLLs do not enable Obfuscation.
- Package downloads are staged and validated before replacing a good install.
- Failed downloads or invalid packages preserve the previous install.
- Newly added or changed architecture-specific patch URLs trigger a download.
- Obfuscation uses the patched executable on ARM64; it never silently falls
  back to stock OpenVPN.
- Scramble runs with `--disable-dco`; the existing scramble configuration is
  unchanged. This keeps scrambling in OpenVPN's userspace data path.
- Driver installation remains the job of the official native OpenVPN MSI.

## Upload and versions.json

Do not add a dead URL to the live manifest. First build and check the archive,
then upload it to the existing `openvpn2612/` directory:

`https://www.serverlistvault.com/openvpn2612/openvpn-2612-arm64.zip`

Retain the current x86 and x64 links:

```json
"patch": {
  "win32": "https://www.serverlistvault.com/openvpn2612/openvpn-2612-32.zip",
  "win64": "https://www.serverlistvault.com/openvpn2612/openvpn-2612-64.zip",
  "arm64": "https://www.serverlistvault.com/openvpn2612/openvpn-2612-arm64.zip"
}
```

The owner uploaded the corrected archive and updated `versions.json`; Agent
verified their public responses without changing the live server files.
The release README describes ARM64 scramble support and the bundled runtime,
while remaining an owner-review draft until public-release approval.
