# VPNUK for Windows — Changelog

## 1.4.0

### IKEv2
- Fixed IKEv2 connections from within the app.
- Improved account and server switching.
- Retained the Windows VPN profile for reliable reconnection after disconnecting or restarting the app.
- Improved IKEv2 connection error reporting.

### Installer
- Added a version-by-version changelog.
- Added a changelog link to the final setup screen alongside the Run VPNUK option.

## 1.3.9

### Split tunnelling
- Added IP address and IPv4 subnet bypass rules for OpenVPN and WireGuard.
- Listed destinations bypass the VPN and kill switch.
- Added expandable Split Tunnelling settings.

### Profiles
- Added a Save Profile button.
- Improved profile saving, including when the app or Windows closes unexpectedly.
- Improved profile dropdown styling.

### WireGuard
- Added fresh configuration generation on connection and configuration cleanup on disconnect.
- Added pending server cleanup when the server cannot be reached.
- Added native WireGuard diagnostics to the connection log.
- Improved installation, updating and repair.
- Added quiet installation with a visible progress message.
- Added optional removal of WireGuard and its adapters when uninstalling VPNUK.

### ARM64
- Added ARM64 OpenVPN installation and scramble obfuscation support.

### Installation and updating
- Improved installer dependency handling and cleanup.
- Fixed removal of saved application data when selected during uninstall.
- Improved the update process from version 1.3.8.

For help, use the Live Help tab in VPNUK or visit https://www.vpnuk.net/.
