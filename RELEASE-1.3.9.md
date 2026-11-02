# VPNUK for Windows 1.3.9

**Review draft — not approved for public release.**

## Application functions

VPNUK provides saved VPN connection profiles for OpenVPN, WireGuard and IKEv2.
Profiles retain account credentials, server selection and protocol-specific
settings. The app includes startup/auto-connect controls, a kill switch,
connection logs, configuration tools and Live Help.

## Improvements in 1.3.9

### Split tunnelling
- Destination IPv4 addresses and CIDR subnets can bypass OpenVPN or WireGuard.
- Rules are saved separately for each profile.
- The expandable **SPLIT TUNNELLING — BYPASS IP ADDRESSES** section has a
  four-row input and a **Save Bypass Rules** button.
- Bypass destinations also bypass the kill switch.
- WireGuard's existing Allowed IPs setting remains separate.
- App selection, domain rules and IPv6 bypass are not included.

### Reliable saved profiles
- **Save Profile** explicitly saves changes with success/error feedback.
- Automatic persistence no longer depends on a clean disconnect or closing
  the application normally.
- Profile dropdowns highlight the selected profile rather than every entry.

### WireGuard connection lifecycle
- A fresh configuration and keys are generated on each connection.
- Previous server configurations are reclaimed using this device's identity;
  other devices' configurations must not be deleted.
- Disconnect stops the tunnel before deleting its local configuration and
  releases its server-side configuration.
- If remote cleanup is unavailable, credential-free recovery information is
  retained so cleanup can be retried. Offline cleanup is not reported complete.
- Startup and external-uninstall handling identify VPNUK-owned tunnels by their
  configuration directory; unrelated tunnels are not swept up.

### Detailed troubleshooting logs
- The app's Log tab includes native WireGuard tunnel/adapter diagnostics,
  including failures before a tunnel reaches its running state.
- Sensitive keys are redacted; unrelated tunnels' entries are excluded.
- Adapter startup errors are distinguished from credential errors.

### Quiet WireGuard installation and updates
- Use the official, native-architecture WireGuard MSI rather than launching
  the bootstrap EXE with unsupported quiet/no-launch expectations.
- Verify its SHA256 and Authenticode WireGuard publisher before installing.
- Install without MSI windows or an automatic restart; do not launch the
  standalone WireGuard app afterward.
- Close the existing WireGuard manager before installation and leave it closed
  after installation or repair.
- Require users to disconnect active WireGuard tunnels first; do not force-kill
  tunnel processes or remove standalone configurations during an update.
- Report installation failures and restart-required results rather than
  presenting every completed process as a successful install.

### Optional WireGuard removal
- Uninstall offers a simple unchecked **Uninstall WireGuard** checkbox.
- Leaving it unchecked preserves shared WireGuard software and unrelated tunnels.
- Selecting it removes shared WireGuard software, its tunnels and verified
  WireGuard adapters. **Export standalone configurations before selecting it.**
- Ordinary VPNUK upgrades do not select shared-software removal.
- Cleanup verifies results and distinguishes failures or restart-required
  removal from completed removal.
- Pending remote peer cleanup retains recovery information.

### ARM64 installation
- Detect native ARM64 Windows, including an emulated app process.
- Select the ARM64 OpenVPN MSI from versions.json rather than x64/x86 drivers.
- Do not silently substitute an incompatible driver when ARM downloads are absent.
- Obfuscation is unavailable on ARM because no ARM patch is supplied.
- Physical ARM64 testing has not been performed.

## Private test build

This candidate is unsigned. It does not use eSigner, is not a public release,
and is intended for manual installation, not the signed automatic updater.
Windows may display publisher/security warnings.

### Full functionality checklist
- Create and save profiles for each protocol; switch between profiles.
- Change a setting, exit/relaunch and confirm it persists. Test forced-exit
  persistence on a disposable test setup, not during important work.
- Connect/disconnect OpenVPN and WireGuard; test a fresh WireGuard reconnect.
- Confirm WireGuard local/server config cleanup and no accumulating config slots.
- Test split tunnelling for both protocols, including with the kill switch.
- Check native WireGuard diagnostics in the Log tab.
- Check startup, auto-connect, DNS/MTU and existing protocol controls.
- Install WireGuard on a clean setup and confirm it does not open afterward.
- With the WireGuard manager open but tunnels disconnected, select installation/
  update in VPNUK Setup and confirm the manager closes and remains closed.
- An active WireGuard tunnel must block dependency installation with a request
  to disconnect first, not be forcibly killed.
- On a disposable Windows setup, uninstall with WireGuard removal unchecked:
  shared WireGuard and an unrelated tunnel must remain.
- Reinstall, export any standalone configurations, then uninstall with removal
  checked: WireGuard software and its adapters must be removed, or a specific
  failure/restart-required result must be shown.
- Offline server cleanup must remain recoverable after reinstall.

Automated tests supplement this checklist; they do not prove every real-world
network connection or interactive installer path. The signed 1.3.8-to-1.3.9
automatic update must be checked with the final signed candidate. Existing
signature/publisher protection is not disabled for unsigned testing.

## Publication approval

The owner reviews this overview and completes unsigned testing before approving
paid signing. Public publication requires explicit owner approval.
