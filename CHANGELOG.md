# VPNUK for Windows — Changelog

## 1.4.0 — In testing

### IKEv2
- Corrected Windows IKEv2 profiles to use EAP-MSCHAPv2 username/password authentication instead of plain MSCHAPv2.
- Generate the EAP settings using Windows' supported VPN configuration tools, with Windows logon credentials disabled.
- Stop and report an error if the EAP profile cannot be created.
- Continue using the VPN server's DNS hostname for IKEv2 connections.
- Match the existing server proposals: IKE AES-256 / SHA-384 / DH Group 2; ESP AES-256 / SHA-1 (96-bit authentication tag); no PFS.
- Stop and report an error if Windows cannot apply the IPsec settings, rather than attempting a connection with unknown settings.
- Compatibility note: DH Group 2 and ESP SHA-1 are legacy settings used by the existing servers; this does not upgrade the network's cryptographic security.

### Installer
- Added this version-by-version changelog, available offline after installation.
- Added a changelog link to the final setup screen alongside the existing Run VPNUK option.

OpenVPN and WireGuard connection code is unchanged in this update. This version is an unsigned test candidate, not a public release. Live IKEv2 connection and installer tests must pass before public release.

## 1.3.9

### Split tunnelling
- Added IP address and IPv4 subnet bypass rules for OpenVPN and WireGuard.
- Saved bypass destinations use the normal internet connection and bypass the kill switch.
- Added compact, expandable Split Tunnelling settings.

### Profiles
- Added Save Profile and more reliable saving of profile changes.
- Improved profile persistence when the app or Windows closes unexpectedly.
- Corrected profile dropdown selection and hover styling.

### WireGuard
- Generate a fresh WireGuard configuration for each connection.
- Remove the local configuration and request server-side removal on disconnect.
- Track pending server cleanup when the server cannot be reached.
- Include native WireGuard diagnostics in the app's connection log.
- Install WireGuard quietly with visible installation status, without opening its standalone interface.
- Improved installation repair and updating of existing WireGuard installations.
- Added optional removal of WireGuard and its adapters during VPNUK uninstall.

### ARM64 and OpenVPN obfuscation
- Added ARM64-aware OpenVPN installation.
- Added ARM64 OpenVPN scramble support and the required matching runtime library.
- Retained x86 and x64 OpenVPN scramble support.

### Installation and updating
- Improved installer dependency handling and cleanup.
- Corrected removal of saved application data when selected during uninstall.
- Kept application-data removal independent of OpenVPN and WireGuard removal.
- Verified the signed update from VPNUK 1.3.8 to 1.3.9.

For help, use the Live Help tab in VPNUK or visit https://www.vpnuk.net/.
