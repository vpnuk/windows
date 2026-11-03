# VPNUK for Windows
## Version 1.3.9 — Features and Release Notes

> **Owner review draft. Not yet publicly released.**
> This document accompanies the private release candidate for testing and
> wording review. Public publication requires the owner's separate approval.

VPNUK for Windows brings your VPN connections, saved profiles, server selection
and connection settings together in one desktop application.

Version **1.3.9** adds IP-based split tunnelling for OpenVPN and WireGuard,
more reliable profile saving, refreshed WireGuard configuration management,
detailed WireGuard diagnostics, ARM64 installer and OpenVPN scramble support, and improved dependency
installation and removal.

## What the app does

### VPN connections

- Connect using **OpenVPN, WireGuard or IKEv2** with your VPNUK account.
- Select a server and save its settings in a named connection profile.
- Connect and disconnect from the main screen, with connection status and
  progress messages.
- Use OpenVPN over **TCP or UDP**, with protocol-specific port choices.
- Use OpenVPN obfuscation where the required components are available.
- Configure WireGuard's **Allowed IPs** separately from split-tunnelling bypass
  rules.

### Saved profiles

- Create, name, select and delete profiles.
- Keep credentials, server selection and connection settings with each profile.
- Maintain separate profiles for different servers, accounts and VPN protocols.
- Use **Save Profile** to save changes explicitly.

### Connection settings

- **Launch at Startup:** start VPNUK with Windows.
- **Auto-Connect:** connect automatically when the app launches.
- **Kill Switch:** enable traffic-blocking protection if the VPN disconnects.
- Choose DNS and MTU settings where supported by the selected connection.
- Use profile-specific IP bypass rules with OpenVPN and WireGuard.

Available settings depend on the VPN protocol and installed components.
Destinations explicitly added to split tunnelling bypass both the VPN and
the kill switch.

### Configuration, updates and support

- Access connection configuration tools and logs from the settings screen.
- View native WireGuard tunnel and adapter diagnostics in the **Log** tab.
- Access **Live Help** from within the app.
- Check for application updates and show download progress and a
  **Restart Now** prompt when an update is ready to install.
- Install required VPN components through VPNUK Setup.

## What's new in version 1.3.9

### 1. Split tunnelling for OpenVPN and WireGuard

Choose specific destination **IPv4 addresses or CIDR subnets** that should use
your normal internet connection instead of the VPN.

- Available separately for each OpenVPN or WireGuard profile.
- Open **SPLIT TUNNELLING — BYPASS IP ADDRESSES** in the Connection settings.
- Enter comma-separated IP addresses or subnets, then select
  **Save Bypass Rules**.
- The section expands when needed, keeping the Connection screen compact.
- WireGuard's existing **Allowed IPs** setting remains separate.

Example:

```text
192.168.1.10, 10.0.0.0/8
```

**Important:** saved bypass destinations also bypass the kill switch. This
release supports destination IPv4 addresses and subnets, not domain names,
application selection or IPv6 bypass rules.

### 2. More reliable profile saving

Profile persistence no longer depends on disconnecting or closing the app
normally.

- Added a dedicated **Save Profile** button.
- Profile changes are also saved automatically.
- Saving provides success or error feedback rather than reporting success
  when the write fails.
- Improved persistence when the app exits unexpectedly or Windows shuts down.
- Corrected profile dropdown styling so the selected entry is highlighted,
  rather than the entire list.

### 3. Fresh WireGuard configurations and improved cleanup

WireGuard now requests a fresh configuration and keys for each connection.

- Stops the tunnel before removing its local configuration on disconnect.
- Releases the associated server-side configuration when the server is
  reachable.
- Reclaims previous configurations associated with this device when preparing
  a new connection.
- Identifies VPNUK-owned tunnels by their configuration location, rather than
  deleting unrelated tunnels based only on a matching name.
- Improves handling of externally removed WireGuard services.

If server-side cleanup cannot finish, recovery information is retained so
cleanup can be retried. An unavailable server is not reported as a successful
remote deletion.

### 4. Detailed WireGuard troubleshooting logs

The app's **Log** tab now includes native WireGuard diagnostics, not just
VPNUK's connection progress messages.

- Includes tunnel-service and network-adapter startup diagnostics.
- Captures errors even when a tunnel fails before reaching its running state.
- Distinguishes adapter and service failures from account-credential errors.
- Redacts sensitive keys and excludes unrelated tunnels' log entries.

This makes connection failures easier to investigate without finding
WireGuard's diagnostic log separately.

### 5. Improved WireGuard installation and updates

WireGuard installation runs quietly while VPNUK Setup displays
**Installing WireGuard...**

- Downloads the official MSI for the native Windows architecture.
- Verifies the published checksum and WireGuard publisher signature before
  installation.
- Closes the existing WireGuard manager before installation or repair.
- Does not automatically open the standalone WireGuard application afterward.
- Does not automatically restart Windows.
- Reports installation errors and any restart requirement.

Active WireGuard tunnels must be disconnected before installing or updating
the dependency; VPNUK does not force-kill them to continue.

### 6. Optional WireGuard removal during uninstall

VPNUK's uninstaller now offers **Uninstall WireGuard** with **Yes/No radio
buttons**, matching the OpenVPN removal controls.

- **No** is selected by default and preserves the shared WireGuard installation.
- **Yes** stops WireGuard tunnels and removes its software, services and
  identified WireGuard adapters.
- Removal checks the final result and reports failures or a required restart
  instead of claiming that incomplete removal succeeded.
- Ordinary VPNUK upgrades preserve the shared WireGuard installation.
- OpenVPN removal and clearing VPNUK application data remain separate choices.

**Important:** WireGuard is shared software. Choosing **Yes** can affect tunnels
used outside VPNUK. Export any standalone configurations you wish to keep before
removing it.

### 7. ARM64-aware installation

The installer now recognises native **ARM64 Windows**, including when an app
process is running under emulation.

- Selects the ARM64 OpenVPN installer rather than an x86 or x64 driver package.
- Uses native architecture when selecting the WireGuard MSI.
- Does not silently substitute an incompatible OpenVPN driver when an ARM64
  download is unavailable.
- Adds native ARM64 **OpenVPN obfuscation using scramble**, alongside the
  existing x86 and x64 packages.
- Checks the architecture of patched OpenVPN executables and supporting DLLs
  before enabling Obfuscation.
- Preserves a working patch installation if a replacement download fails.
- Disables OpenVPN DCO for obfuscated connections so scramble processes traffic
  in OpenVPN's userspace data path.

The ARM64 scramble package includes the required Microsoft ARM64
`vcruntime140.dll` alongside its OpenVPN and supporting libraries. Its download
is listed in the live server manifest.

Physical ARM64 hardware and live scramble connection testing have not been
performed here; package architecture and dependency checks are not a substitute
for those runtime tests.

### 8. Interface improvements

- Compact, expandable split-tunnelling settings.
- Clearer split-tunnelling text and a four-row input area.
- Removed the unwanted orange/beige mouse-click outline from the
  split-tunnelling heading.
- Consistent selected-item and hover styling in profile dropdowns.
- Matching Yes/No controls for optional OpenVPN and WireGuard removal.
- Visible installation status while WireGuard installs quietly.

## Installation and updating

- Use the official VPNUK Windows installer.
- Administrator permission is required to install the app and VPN components.
- Disconnect active VPN connections before installing an update.
- Existing users can use the in-app update prompt when the signed public update
  becomes available, or install the official update manually.
- A Windows restart may be required after VPN component installation or removal.
- WireGuard requires Windows 10 or later.

Private unsigned test installers are not intended for the signed automatic
updater and are not the public release.

## Help and support

Use the **Live Help** tab in the app or visit
[vpnuk.net](https://www.vpnuk.net/).

For connection problems, include the app version, selected VPN protocol and
relevant Log tab output. Do not share passwords or private keys.

---

WireGuard and the WireGuard logo are registered trademarks of Jason A. Donenfeld.
