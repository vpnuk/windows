
; ─────────────────────────────────────────────────────────────────────────────────
; extension.nsh — VPNUK custom NSIS hooks
;
; electron-builder v22.x template uses !ifmacrodef to check for custom macros.
; Only !macro definitions matter (not !define) for those checks.
;
; Template macro call sites confirmed from installSection.nsh analysis:
;   installSection.nsh  L78: !ifmacrodef customInstall  → !insertmacro customInstall
;   installer.nsi       L39: !insertmacro customHeader  (unconditional — must be defined)
;   installer.nsi       L68: !insertmacro customInit    (unconditional — must be defined)
;
; NOTE: customCreateDesktopIcon is NOT in any EB v22.x template. Shortcuts are
; created by EB's own code.  We fix them in customInstall and on app first launch.
; ─────────────────────────────────────────────────────────────────────────────────

; ─── customInstall ──────────────────────────────────────────────────────────────
; Called after file extraction by installSection.nsh.
; Creates the scheduled task and fixes both shortcuts to target schtasks.exe
; (so the UAC shield does not appear on the desktop icon).
!macro customInstall
    ; Write probe so CI can confirm this macro ran
    FileOpen $R9 "$INSTDIR\customInstall_ran.txt" w
    FileWrite $R9 "customInstall executed"
    FileClose $R9

    ; PSModulePath update — skip in silent mode (PowerShell startup is slow there)
    ${IfNot} ${Silent}
        nsExec::ExecToStack `powershell -NonInteractive -NoProfile -Command "[Environment]::SetEnvironmentVariable('PSModulePath', [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine') + [IO.Path]::PathSeparator + '$INSTDIR\PSModules', 'Machine')"`
        Pop $0
        Pop $0
    ${EndIf}

    ; ─── Task Scheduler via PowerShell ──────────────────────────────────────────
    ; Register-ScheduledTask is used instead of schtasks.exe CLI because the CLI
    ; /RL HIGHEST + /SC ONDEMAND combination can fail depending on Windows edition
    ; and group policy.  PowerShell's cmdlet handles all privilege configuration
    ; internally and handles paths-with-spaces cleanly.
    ;
    ; The task runs VPNUK.exe on demand at the highest available privilege for any
    ; member of BUILTIN\Administrators.  The shortcut targets schtasks.exe /Run
    ; so Windows does not show the UAC shield on the desktop icon.
    FileOpen $R9 "$TEMP\vpnuk_task.ps1" w
    FileWrite $R9 "$$action    = New-ScheduledTaskAction -Execute '$INSTDIR\VPNUK.exe'$\r$\n"
    FileWrite $R9 "$$principal = New-ScheduledTaskPrincipal -UserId $\"$$env:USERDOMAIN\$$env:USERNAME$\" -LogonType Interactive -RunLevel Highest$\r$\n"
    FileWrite $R9 "$$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries$\r$\n"
    FileWrite $R9 "Register-ScheduledTask -TaskName 'VPNUK' -Action $$action -Principal $$principal -Settings $$settings -Force | Out-Null$\r$\n"
    FileClose $R9
    nsExec::ExecToStack 'powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -File "$TEMP\vpnuk_task.ps1"'
    Pop $0  ; PS exit code (0 = success)
    Pop $0  ; discard stdout text
    Delete "$TEMP\vpnuk_task.ps1" 

    ; ─── Shortcuts → schtasks.exe ────────────────────────────────────────────────
    ; electron-builder creates shortcuts pointing to VPNUK.exe (which shows the UAC
    ; shield because VPNUK.exe has a requireAdministrator manifest).  We delete and
    ; recreate them here so they target schtasks.exe /Run /TN VPNUK instead.
    ; The app also self-heals these shortcuts on first launch (main.js) in case
    ; electron-builder's shortcut creation runs after this macro.
    SetShellVarContext all
    Delete "$DESKTOP\VPNUK.lnk"
    CreateShortCut "$DESKTOP\VPNUK.lnk" "$WINDIR\System32\schtasks.exe" '/Run /TN "VPNUK"' "$INSTDIR\VPNUK.exe" 0
    Delete "$SMPROGRAMS\VPNUK\VPNUK.lnk"
    CreateShortCut "$SMPROGRAMS\VPNUK\VPNUK.lnk" "$WINDIR\System32\schtasks.exe" '/Run /TN "VPNUK"' "$INSTDIR\VPNUK.exe" 0
!macroend

; ─── customWelcomePage ──────────────────────────────────────────────────────────
!include MUI2.nsh
!macro customWelcomePage
!insertMacro MUI_PAGE_WELCOME
!macroEnd

; ────────────────────────────────────────────────────────────────────────────────
; COMMON
; ────────────────────────────────────────────────────────────────────────────────
!include nsDialogs.nsh
!include WordFunc.nsh
!include x64.nsh

!macro ClearStack
    ${Do}
        Pop $0
        IfErrors send
    ${Loop}
send:
!macroend
!define ClearStack "!insertmacro ClearStack"

!macro uninstallOvpn
    ; old versions
    ReadRegStr $0 HKLM SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\OpenVPN UninstallString
    ${If} $0 != ""
        nsExec::ExecToStack "$0 /S"  uninstall
        Pop $0
        Pop $0 ; Ruin inetc::get call if no pops made here
        MessageBox MB_OK "Deleting OpenVPN"
        Sleep 5000 ; Exec doesn't wait old uninstaller for some reason.
                   ; May conflict with installer later.
    ${EndIf}
    ; new versions (2.5.x+)
    nsExec::ExecToStack `wmic product where "name like 'OpenVPN _._.%'" get LocalPackage /format:list` 
    Pop $0
    Pop $0 ; LocalPackage=C:\Windows\Installer\1fb7bb.msi // No Instance(s) Available
    ${WordFind} $0 "LocalPackage=" "E-1" $0
    ${WordFind} $0 ".msi" "E+1{*" $0
    StrLen $1 $0
    ${If} $1 > 1
        nsExec::ExecToStack "MsiExec.exe /x $0 /passive"
    ${EndIf}
!macroend
!define uninstallOvpn "!insertmacro uninstallOvpn"

!macro cleanupVpnukTunnels
    ; Stop only services whose actual config belongs to VPNUK, even if the
    ; WireGuard application has already been uninstalled. Wait for STOPPED;
    ; never delete a live driver service after an arbitrary sleep.
    nsExec::ExecToStack `powershell -NoProfile -NonInteractive -Command "$$ErrorActionPreference = 'Stop'; $$owned = Get-CimInstance Win32_Service | Where-Object { $$_.Name.StartsWith(('WireGuardTunnel' + [char]36)) -and $$_.PathName.ToLowerInvariant().Contains(([char]92 + 'vpnuk' + [char]92)) }; foreach ($$item in $$owned) { $$service = Get-Service -Name $$item.Name; if ($$service.Status -ne 'Stopped') { $$service.Stop(); $$service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20)) }; sc.exe delete $$item.Name | Out-Null; if ($$LASTEXITCODE -ne 0) { throw 'Cannot delete stopped VPNUK tunnel' } }"`
    Pop $0
    ${If} $0 != 0
        Pop $0
        MessageBox MB_OK "A VPNUK tunnel could not be stopped safely. Close VPNUK, disconnect the VPN and try again."
        Abort
    ${EndIf}
    Pop $0
!macroend

; Runs for interactive uninstall AND silent upgrades, before EB removes files
; or --delete-app-data. Page callbacks are not lifecycle hooks.
!macro customRemoveFiles
    SetShellVarContext current
    ; Preserve only the identity even if Electron cannot launch. This directory
    ; intentionally survives "Clear application user data".
    IfFileExists "$APPDATA\VPNUK\device.json" 0 vpnuk_identity_saved
    CreateDirectory "$LOCALAPPDATA\VPNUK-WireGuard-Recovery"
    ClearErrors
    CopyFiles /SILENT "$APPDATA\VPNUK\device.json" "$LOCALAPPDATA\VPNUK-WireGuard-Recovery\device.json"
    IfErrors 0 vpnuk_identity_saved
    MessageBox MB_OK "Cannot preserve the WireGuard cleanup record. No application files were removed. Check disk permissions and try again."
    Abort
vpnuk_identity_saved:
    !insertmacro cleanupVpnukTunnels
    ; No credentials on the command line. Failure/offline/timeout leaves the
    ; durable device-label record for authenticated cleanup after reinstall.
    nsExec::ExecToStack '"$INSTDIR\VPNUK.exe" --cleanup-wireguard'
    Pop $0
    Pop $1
    ${If} $0 != 0
        DetailPrint "WireGuard server cleanup pending; the device identity is retained for recovery after reinstall."
    ${EndIf}
    Delete "$APPDATA\VPNUK\vpnuk-*.conf"
    Delete "$APPDATA\VPNUK\shared.conf"
    Delete "$APPDATA\VPNUK\dedicated.conf"
    Delete "$APPDATA\VPNUK\11dedicated.conf"
    ${If} $userDataFlag == true
        RMDir /r "$APPDATA\VPNUK"
    ${EndIf}
    SetShellVarContext all
    RMDir /r "$INSTDIR"
!macroend

!macro uninstallWg
    !insertmacro cleanupVpnukTunnels

    ; Step 2 — Locate wireguard.exe from known install paths and call /uninstall.
    StrCpy $1 ""
    IfFileExists "$PROGRAMFILES64\WireGuard\wireguard.exe" 0 +2
    StrCpy $1 "$PROGRAMFILES64\WireGuard\wireguard.exe"
    ${If} $1 == ""
        IfFileExists "$PROGRAMFILES\WireGuard\wireguard.exe" 0 +2
        StrCpy $1 "$PROGRAMFILES\WireGuard\wireguard.exe"
    ${EndIf}
    ${If} $1 == ""
        ReadRegStr $1 HKLM "SOFTWARE\WireGuard" "InstallationDirectory"
        ${If} $1 != ""
            StrCpy $1 "$1\wireguard.exe"
        ${EndIf}
    ${EndIf}
    ${If} $1 != ""
        nsExec::ExecToStack '"$1" /uninstall'
        Pop $0
        Pop $0
        Sleep 5000
    ${EndIf}
!macroend
!define uninstallWg "!insertmacro uninstallWg"

!macro radioBtnClick
    Pop $hwnd
    nsDialogs::GetUserData $hwnd
!macroend
!define radioBtnClick "!insertmacro radioBtnClick"

; ────────────────────────────────────────────────────────────────────────────────
; INSTALL PAGES (OpenVPN + WireGuard)
; ────────────────────────────────────────────────────────────────────────────────
!macro customPageAfterChangeDir
    !pragma warning disable 6040 ; Disable 'LangString is not set in language table of language <lang>'
    LangString title 1033 "OpenVPN"
    LangString subtitle 1033 "OpenVPN installation"
    Page custom ovpnPageCreate ovpnPageLeave

    LangString wgTitle 1033 "WireGuard"
    LangString wgSubtitle 1033 "WireGuard installation"
    Page custom wgPageCreate wgPageLeave

    Var ovpnVersion
    Var ovpnPath
    Var installedOvpnVer
    Var ovpnInstallerUrl
    Var ovpnDialog
    Var hwnd
    Var radioValue
    Var height

    Var wgVersion
    Var wgInstallerUrl
    Var wgPath
    Var installedWgVer
    Var wgDialog
    Var wgHwnd
    Var wgRadioValue
    Var wgHeight

    Function ovpnPageCreate
        ${If} ${Silent}
            Abort  ; skip page (and its internet download) in silent mode
        ${EndIf}
        StrCpy $height 12
        !insertmacro MUI_HEADER_TEXT $(title) $(subtitle)
        nsDialogs::Create 1018
        Pop $ovpnDialog
        ${If} $ovpnDialog == error
            Abort
        ${EndIf} 

        ReadRegStr $ovpnPath HKLM SOFTWARE\OpenVPN exe_path
        ; Some installations store a quoted exe_path. Normalize only the outer
        ; quotes; preserve spaces and the actual file path.
        StrCpy $0 $ovpnPath 1
        ${If} $0 == '$\"'
            StrCpy $0 $ovpnPath 1 -1
            ${If} $0 == '$\"'
                StrLen $1 $ovpnPath
                IntOp $1 $1 - 2
                StrCpy $ovpnPath $ovpnPath $1 1
            ${EndIf}
        ${EndIf}
        ${If} $ovpnPath != ""
            Call getOvpnVersion ; => $installedOvpnVer
        ${EndIf}
        Call getFromVerionsJson
        
        ${NSD_CreateLabel} 0u 0u 100% 12u "Select OpenVPN to use:"
        Pop $hwnd
        
        StrCmp $ovpnPath "" +2 0
        StrCmp $ovpnVersion $installedOvpnVer install_option_end 0
        ${NSD_CreateRadioButton} 12u "$height\u" 100% 12u "Install OpenVPN $ovpnVersion"
        pop $hwnd
        nsDialogs::SetUserData $hwnd "true"
        ${NSD_OnClick} $hwnd radioBtnClick
        IntOp $height $height + 12
        StrCpy $radioValue "true"
    install_option_end:

        StrCmp $ovpnPath "" use_option_end 0
        ${NSD_CreateRadioButton} 12u "$height\u" 100% 12u "Use installed OpenVPN $installedOvpnVer"
        pop $hwnd
        nsDialogs::SetUserData $hwnd "false"
        ${NSD_OnClick} $hwnd radioBtnClick
        StrCpy $radioValue "false"
    use_option_end:

        ${NSD_Check} $hwnd

        nsDialogs::Show
    FunctionEnd

    Function radioBtnClick
        ${radioBtnClick}
        Pop $radioValue
    FunctionEnd

    Function getOvpnVersion
        StrCpy $installedOvpnVer ""
        IfFileExists "$ovpnPath" 0 ovpn_version_missing
        nsExec::ExecToStack /TIMEOUT=10000 '"$ovpnPath" --version'
        Pop $R0 ; process exit status (or error/timeout)
        Pop $R1 ; captured output; do not overwrite the exit status
        ${If} $R0 == "0"
        ${AndIf} $R1 != ""
            ${WordFind2X} $R1 "OpenVPN " " " "+1" $1
            StrCpy $installedOvpnVer $1
        ${EndIf}
        ${If} $installedOvpnVer == ""
            DetailPrint "OpenVPN version command unavailable (status $R0); checking the existing file's version resource."
            ClearErrors
            GetDLLVersion "$ovpnPath" $R2 $R3
            ${IfNot} ${Errors}
                IntOp $R4 $R2 >> 16
                IntOp $R5 $R2 & 0xFFFF
                IntOp $R6 $R3 >> 16
                StrCpy $installedOvpnVer "$R4.$R5.$R6"
            ${Else}
                StrCpy $installedOvpnVer "version unavailable"
                DetailPrint "Keeping the existing OpenVPN option; its version could not be determined."
            ${EndIf}
        ${EndIf}
        Return
    ovpn_version_missing:
        DetailPrint "The registered OpenVPN executable is absent; ignoring the stale registry path."
        StrCpy $ovpnPath ""
    FunctionEnd

    Function getFromVerionsJson
        ${ClearStack}
        inetc::get /NOCANCEL /SILENT "https://www.serverlistvault.com/versions.json" "$TEMP\versions.json" /END
        Pop $0
        ${If} $0 == "OK"
            nsJSON::Set /file "$TEMP\versions.json"
            
            nsJSON::Get "openvpn" "version" /end
            Pop $ovpnVersion

            ; Detect the native OS even when this installer is emulated on ARM.
            ReadEnvStr $1 PROCESSOR_ARCHITEW6432
            ${If} $1 == ""
                ReadEnvStr $1 PROCESSOR_ARCHITECTURE
            ${EndIf}
            ${If} $1 == "ARM64"
                StrCpy $1 "arm64"
            ${ElseIf} ${RunningX64}
                StrCpy $1 "win64"
            ${Else}
                StrCpy $1 "win32"
            ${EndIf}

            nsJSON::Get "openvpn" "original" $1 /end
            Pop $ovpnInstallerUrl

            nsJSON::Get "windows" "wireguard" "version" /end
            Pop $wgVersion

            nsJSON::Get "windows" "wireguard" "installer" /end
            Pop $wgInstallerUrl
        ${Else}
            MessageBox MB_OK "Error loading versions.json:$\n$0"
        ${EndIf}
    FunctionEnd

    Function ovpnPageLeave
        ${If} $radioValue == ""
            MessageBox MB_OK "Please specify your choice"
            Abort
        ${ElseIf} $radioValue == true
            GetDlgItem $0 $hWndParent 1 ; 'Next' button handle
            EnableWindow $0 0

            ${If} $ovpnPath != ""
                ${uninstallOvpn}
            ${EndIf}

            ${ClearStack}
            inetc::get $ovpnInstallerUrl "$TEMP\ovpnInstaller.msi" /nocancel
            Pop $1
            
            ${If} $1 == "OK"
                ReadEnvStr $0 PROCESSOR_ARCHITEW6432
                ${If} $0 == ""
                    ReadEnvStr $0 PROCESSOR_ARCHITECTURE
                ${EndIf}
                ${If} $0 == "ARM64"
                    ; Let the ARM MSI select its own native driver features.
                    nsExec::ExecToStack 'msiexec.exe /i "$TEMP\ovpnInstaller.msi" SELECT_ASSOCIATIONS=0 /passive /norestart'
                ${Else}
                    nsExec::ExecToStack 'msiexec.exe /i "$TEMP\ovpnInstaller.msi" \
                        ADDLOCAL=OpenVPN,OpenVPN.Service,Drivers,Drivers.TAPWindows6 \
                        SELECT_ASSOCIATIONS=0 /passive /norestart'
                ${EndIf}
                Pop $0
                
                ${If} $0 != 0
                ${AndIf} $0 != 3010
                    Pop $0
                    MessageBox MB_OK "Error installing openvpn:$\n$0"
                    Abort
                ${EndIf}
                ; Write versions.json so the app doesn't prompt to update on first run
                CreateDirectory "$APPDATA\VPNUK"
                FileOpen $0 "$APPDATA\VPNUK\versions.json" w
                FileWrite $0 '{"openvpn":{"version":"$ovpnVersion"}}'
                FileClose $0
            ${Else}
                MessageBox MB_OK "Error loading openvpn:$\n$1"
                Abort
            ${EndIf}

            GetDlgItem $0 $hWndParent 1 ; 'Next' button handle
            EnableWindow $0 1
        ${EndIf}
    FunctionEnd

    ; =================== WireGuard functions ===================

    Function wgPageCreate
        ${If} ${Silent}
            Abort  ; skip page in silent mode
        ${EndIf}
        StrCpy $wgHeight 12
        !insertmacro MUI_HEADER_TEXT $(wgTitle) $(wgSubtitle)
        nsDialogs::Create 1018
        Pop $wgDialog
        ${If} $wgDialog == error
            Abort
        ${EndIf}

        StrCpy $wgPath ""
        IfFileExists "$PROGRAMFILES\WireGuard\wireguard.exe" 0 wg_check64
        StrCpy $wgPath "$PROGRAMFILES\WireGuard\wireguard.exe"
        Goto wg_version_check
    wg_check64:
        IfFileExists "$PROGRAMFILES64\WireGuard\wireguard.exe" 0 wg_no_install
        StrCpy $wgPath "$PROGRAMFILES64\WireGuard\wireguard.exe"
    wg_version_check:
        ReadRegStr $installedWgVer HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\WireGuard" "DisplayVersion"
        ${If} $installedWgVer == ""
            StrCpy $installedWgVer "unknown"
        ${EndIf}
    wg_no_install:

        ${NSD_CreateLabel} 0u 0u 100% 12u "Select WireGuard to use:"
        Pop $wgHwnd

        StrCmp $wgPath "" +2 0
        StrCmp $wgVersion $installedWgVer wg_install_end 0
        ${NSD_CreateRadioButton} 12u "$wgHeight\u" 100% 12u "Install WireGuard $wgVersion"
        Pop $wgHwnd
        nsDialogs::SetUserData $wgHwnd "true"
        ${NSD_OnClick} $wgHwnd wgRadioBtnClick
        IntOp $wgHeight $wgHeight + 12
        StrCpy $wgRadioValue "true"
    wg_install_end:

        StrCmp $wgPath "" wg_use_end 0
        ${NSD_CreateRadioButton} 12u "$wgHeight\u" 100% 12u "Use Existing WireGuard"
        Pop $wgHwnd
        nsDialogs::SetUserData $wgHwnd "false"
        ${NSD_OnClick} $wgHwnd wgRadioBtnClick
        ${NSD_Check} $wgHwnd
        StrCpy $wgRadioValue "false"
    wg_use_end:

        nsDialogs::Show
    FunctionEnd

    Function wgRadioBtnClick
        Pop $wgHwnd
        nsDialogs::GetUserData $wgHwnd
        Pop $wgRadioValue
    FunctionEnd

    Function wgPageLeave
        ${If} $wgRadioValue == ""
            MessageBox MB_OK "Please specify your choice"
            Abort
        ${ElseIf} $wgRadioValue == true
            GetDlgItem $0 $hWndParent 1
            EnableWindow $0 0

            ${If} $wgPath != ""
                ${uninstallWg}
            ${EndIf}

            ${ClearStack}
            inetc::get /NOCANCEL "$wgInstallerUrl" "$TEMP\wgInstaller.exe" /END
            Pop $1

            ${If} $1 == "OK"
                nsExec::ExecToStack '"$TEMP\wgInstaller.exe" /S'
                Pop $0
                ${If} $0 != 0
                    Pop $0
                    MessageBox MB_OK "Error installing WireGuard:$\n$0"
                    Abort
                ${EndIf}
                ; Close WireGuard UI if it auto-launched after silent install
                nsExec::ExecToStack 'taskkill /F /IM wireguard.exe'
                Pop $0
                Pop $0
            ${Else}
                MessageBox MB_OK "Error downloading WireGuard:$\n$1"
                Abort
            ${EndIf}

            GetDlgItem $0 $hWndParent 1
            EnableWindow $0 1
        ${EndIf}
    FunctionEnd

    !pragma warning enable 6040 ; Enable back
!macroend

; ────────────────────────────────────────────────────────────────────────────────
; UNINSTALL
; ────────────────────────────────────────────────────────────────────────────────
!macro customUninstallPage

; un.PSModulePath — remove our PSModules dir from the machine-wide PSModulePath.
; Uses a temp .ps1 file to avoid NSIS mangling the PowerShell quoting on the
; command line (the old one-liner caused "Missing ')' in method call" errors).
Var psmDir

Function un.PSModulePath
    StrCpy $psmDir "$INSTDIR\PSModules"

    FileOpen $R9 "$TEMP\vpnuk_rm_psmod.ps1" w
    FileWrite $R9 "$$modPath = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')$\r$\n"
    FileWrite $R9 "$$sep     = [IO.Path]::PathSeparator$\r$\n"
    FileWrite $R9 "$$remove  = '$psmDir'$\r$\n"
    FileWrite $R9 "$$newPath = ($$modPath -split [regex]::Escape($$sep) | Where-Object { $$_ -ne $$remove }) -join $$sep$\r$\n"
    FileWrite $R9 "[Environment]::SetEnvironmentVariable('PSModulePath', $$newPath, 'Machine')$\r$\n"
    FileClose $R9

    nsExec::ExecToStack 'powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -File "$TEMP\vpnuk_rm_psmod.ps1"'
    Pop $0
    ${If} $0 != 0
        Pop $0
        MessageBox MB_OK "Error setting PSModulePath:$\n$0"
    ${Else}
        Pop $0
    ${EndIf}
    Delete "$TEMP\vpnuk_rm_psmod.ps1"
FunctionEnd

; -------------- Extras ---------------
    !pragma warning disable 6040
    LangString title 1033 "Uninstallation extras"
    LangString subtitle 1033 "Choose additional options"
    UninstPage custom un.OvpnPageCreate un.OvpnPageLeave

    Var ovpnDialog
    Var hwnd
    Var ovpnFlag
    Var userDataFlag

    Function un.OvpnPageCreate
        ReadRegStr $0 HKLM SOFTWARE\OpenVPN exe_path

        ; Pre-initialise flags so validation in Leave never sees empty string
        StrCpy $ovpnFlag "false"
        StrCpy $userDataFlag "false"

        !insertmacro MUI_HEADER_TEXT $(title) $(subtitle)
        nsDialogs::Create 1018
        Pop $ovpnDialog
        ${If} $ovpnDialog == error
            Abort
        ${EndIf}

    ; -------------- OpenVPN --------------
        ${If} $0 != ""
            ${NSD_CreateLabel} 0u 0u 100% 12u "Uninstall OpenVPN"
            Pop $hwnd

            ${NSD_CreateRadioButton} 12u 12u 100% 12u "Yes"
            pop $hwnd
            nsDialogs::SetUserData $hwnd "true"
            ${NSD_OnClick} $hwnd un.ovpnRadioClick
            ${NSD_AddStyle} $hwnd ${WS_GROUP}

            ${NSD_CreateRadioButton} 12u 24u 100% 12u "No"
            pop $hwnd
            nsDialogs::SetUserData $hwnd "false"
            ${NSD_OnClick} $hwnd un.ovpnRadioClick

            ${NSD_Check} $hwnd
            StrCpy $ovpnFlag "false"
        ${EndIf}

    ; ------------- User data -------------
        ${NSD_CreateLabel} 0u 36u 100% 12u "Clear application user data"
        Pop $hwnd

        ${NSD_CreateRadioButton} 12u 48u 100% 12u "Yes"
        pop $hwnd
        nsDialogs::SetUserData $hwnd "true"
        ${NSD_OnClick} $hwnd un.dataRadioClick
        ${NSD_AddStyle} $hwnd ${WS_GROUP}

        ${NSD_CreateRadioButton} 12u 60u 100% 12u "No"
        pop $hwnd
        nsDialogs::SetUserData $hwnd "false"
        ${NSD_OnClick} $hwnd un.dataRadioClick

        ${NSD_Check} $hwnd
        StrCpy $userDataFlag "false"

    ; -------------------------------------
        nsDialogs::Show
    FunctionEnd

    Function un.ovpnRadioClick
        ${radioBtnClick}
        Pop $ovpnFlag
    FunctionEnd

    Function un.dataRadioClick
        ${radioBtnClick}
        Pop $userDataFlag
    FunctionEnd

    Function un.OvpnPageLeave
        ${If} $ovpnFlag == ""
        ${OrIf} $userDataFlag == ""
            MessageBox MB_OK "Please specify your choice"
            Abort
        ${EndIf}
        
        GetDlgItem $0 $hWndParent 1 ; 'Next' button handle
        EnableWindow $0 0

        SetShellVarContext current

        ; ----------- Updater cache -----------
        RMDir /r "$LOCALAPPDATA\vpnuk-updater"

        ; -------------- OpenVPN --------------
        ${If} $ovpnFlag == true
            ${uninstallOvpn}
        ${EndIf}

        ; Tunnel/key/server cleanup and optional data removal run in
        ; customRemoveFiles, not this interactive-only page callback.
        
        SetShellVarContext all

        ; ─── Task Scheduler cleanup ─────────────────────────────────────
        nsExec::ExecToStack 'schtasks /Delete /TN "VPNUK" /F'
        Pop $0
        Pop $0
        nsExec::ExecToStack 'schtasks /Delete /TN "VPNUK-Startup" /F'
        Pop $0
        Pop $0

        ; ─── PSModulePath cleanup ───────────────────────────────────────────
        call un.PSModulePath

        GetDlgItem $0 $hWndParent 1 ; 'Next' button handle
        EnableWindow $0 1
    FunctionEnd
    !pragma warning enable 6040
!macroend
