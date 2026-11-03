# VPNUK for Windows

## Version 1.3.9

Manage OpenVPN, WireGuard and IKEv2 connections, select servers and save named
connection profiles using your VPNUK account.

**[Download the signed Windows release](https://github.com/vpnuk/windows/releases/tag/v1.3.9)**

**[Read the full app overview and version 1.3.9 release notes](RELEASE-1.3.9.md)**

### App features

- Saved profiles with account, server and protocol-specific connection settings.
- OpenVPN TCP/UDP connections and scramble obfuscation.
- WireGuard connections with separate Allowed IPs settings.
- Launch at Startup, Auto-Connect, Kill Switch, and supported DNS/MTU settings.
- Connection logs, native WireGuard diagnostics and in-app Live Help.
- Signed application updates with download progress and a Restart Now prompt.

### What's new in 1.3.9

- **Split tunnelling:** per-profile IPv4 address/subnet bypass for OpenVPN and
  WireGuard. Listed destinations bypass both the VPN and the Kill Switch.
- **Profile saving:** an explicit Save Profile button and more reliable
  persistence when the app or PC closes unexpectedly.
- **ARM64 support:** native OpenVPN/WireGuard component selection and native
  ARM64 OpenVPN scramble packages, alongside x64 and x86 support.
- **Fresh WireGuard configs:** generate on connection and remove on disconnect,
  with device-specific server cleanup and pending-cleanup recovery.
- **Detailed WireGuard logs:** native tunnel and adapter diagnostics in the Log
  tab, with sensitive key material filtered.
- **Improved setup:** quiet WireGuard installation with visible progress status,
  existing-install reuse and repair, without opening the standalone WireGuard UI.
- **Optional component removal:** matching Yes/No choices for OpenVPN and
  WireGuard removal, including WireGuard's tunnel services and adapters.
- **User-data removal:** the uninstall choice now correctly removes saved app
  data; preserving app data remains a separate option.
- **Settings improvements:** expandable bypass settings, clearer text and
  corrected profile-dropdown highlighting.

### Installing and updating

- Existing users can use the in-app updater or install the signed update manually.
  The owner tested updating from version 1.3.8 to 1.3.9.
- Choose **VPNUK-Setup-1.3.9-build371.exe** for the full application installer,
  including x64, x86 and ARM64 application packages.
- **VPNUK-Web-Setup-1.3.9-build371.exe** is the smaller x64 web installer and
  downloads its application package during installation.
- Administrator permission is required. Disconnect the VPN before updating.
- Installing VPN components can require an internet connection and a Windows restart.
- WireGuard requires Windows 10 or later.

For support, use Live Help in the app, visit [vpnuk.net](https://www.vpnuk.net/)

"WireGuard" and the "WireGuard" logo are registered trademarks of Jason A. Donenfeld.
