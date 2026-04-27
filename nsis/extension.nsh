!include MUI2.nsh
!macro customWelcomePage
	!insertMacro MUI_PAGE_WELCOME
!macroEnd

; ---------------------------------- COMMON -----------------------------------
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

!macro radioBtnClick
    Pop $hwnd
    nsDialogs::GetUserData $hwnd
!macroend
!define radioBtnClick "!insertmacro radioBtnClick"

; ---------------------------------- INSTALL ----------------------------------
; ------------- PSModule --------------
!macro customInstall
    nsExec::ExecToStack `powershell [Environment]::SetEnvironmentVariable(\"PSModulePath\", [Environment]::GetEnvironmentVariable(\"PSModulePath\", \"Machine\") + [System.IO.Path]::PathSeparator + \"$INSTDIR\PSModules\", \"Machine\")`
    Pop $0
    ${If} $0 != 0
        Pop $0
        MessageBox MB_OK "Error setting PSModulePath:$\n$0"
    ${EndIf}
!macroend

; --------------- OVPN ----------------
!macro customPageAfterChangeDir
    !pragma warning disable 6040 ; Disable 'LangString is not set in language table of language <lang>'
    LangString title 1033 "OpenVPN"
    LangString subtitle 1033 "OpenVPN installation"
    Page custom ovpnPageCreate ovpnPageLeave

    Var ovpnVersion
    Var ovpnPath
    Var installedOvpnVer
    Var ovpnInstallerUrl
    Var ovpnDialog
    Var hwnd
    Var radioValue
    Var height
    Function ovpnPageCreate
        StrCpy $height 12
        !insertmacro MUI_HEADER_TEXT $(title) $(subtitle)
        nsDialogs::Create 1018
        Pop $ovpnDialog
        ${If} $ovpnDialog == error
            Abort
        ${EndIf} 

        ReadRegStr $ovpnPath HKLM SOFTWARE\OpenVPN exe_path
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
        nsExec::ExecToStack "$ovpnPath --version"
        Pop $0
        Pop $0
        ${If} $0 != ""
            ${WordFind2X} $0 "OpenVPN " " " "+1" $1
            StrCpy $installedOvpnVer $1
        ${Else}
            MessageBox MB_OK "Error getting openvpn version:$\n$0"
            StrCpy $installedOvpnVer ""
        ${EndIf}
    FunctionEnd

    Function getFromVerionsJson
        ${ClearStack}
        inetc::get /NOCANCEL /SILENT "https://www.serverlistvault.com/versions.json" "$TEMP\versions.json" /END
        Pop $0
        ${If} $0 == "OK"
            nsJSON::Set /file "$TEMP\versions.json"
            
            nsJSON::Get "openvpn" "version" /end
            Pop $ovpnVersion

            ${If} ${RunningX64}
                StrCpy $1 "win64"
            ${Else}
                StrCpy $1 "win32"
            ${EndIf}

            nsJSON::Get "openvpn" "original" $1 /end
            Pop $ovpnInstallerUrl
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
                nsExec::ExecToStack 'cmd /c "$TEMP\ovpnInstaller.msi" \
                    ADDLOCAL=OpenVPN,OpenVPN.Service,Drivers,Drivers.TAPWindows6 \
                    SELECT_ASSOCIATIONS=0 /passive'
                Pop $0
                
                ${If} $0 != 0
                    Pop $0
                    MessageBox MB_OK "Error installing openvpn:$\n$0"
                    Abort
                ${EndIf}
            ${Else}
                MessageBox MB_OK "Error loading openvpn:$\n$1"
                Abort
            ${EndIf}

            GetDlgItem $0 $hWndParent 1 ; 'Next' button handle
            EnableWindow $0 1
        ${EndIf}
    FunctionEnd
    !pragma warning enable 6040 ; Enable back
!macroend

; --------------------------------- UNINSTALL ---------------------------------
!macro customUninstallPage

; ------------- PSModule --------------
Function un.StrRep
    Exch $R2 ;new
    Exch 1
    Exch $R1 ;old
    Exch 2
    Exch $R0 ;string
    Push $R3
    Push $R4
    Push $R5
    Push $R6
    Push $R7
    Push $R8
    Push $R9

    StrCpy $R3 0
    StrLen $R4 $R1
    StrLen $R6 $R0
    StrLen $R9 $R2
    loop:
        StrCpy $R5 $R0 $R4 $R3
        StrCmp $R5 $R1 found
        StrCmp $R3 $R6 done
        IntOp $R3 $R3 + 1 ;move offset by 1 to check the next character
        Goto loop
    found:
        StrCpy $R5 $R0 $R3
        IntOp $R8 $R3 + $R4
        StrCpy $R7 $R0 "" $R8
        StrCpy $R0 $R5$R2$R7
        StrLen $R6 $R0
        IntOp $R3 $R3 + $R9 ;move offset by length of the replacement string
        Goto loop
    done:

    Pop $R9
    Pop $R8
    Pop $R7
    Pop $R6
    Pop $R5
    Pop $R4
    Pop $R3
    Push $R0
    Push $R1
    Pop $R0
    Pop $R1
    Pop $R0
    Pop $R2
    Exch $R1
FunctionEnd

Var psmDir

Function un.PSModulePath
    Push "$INSTDIR\PSModules"
    Push "\"
    Push "\\"
    Call un.StrRep
    pop $psmDir

    nsExec::ExecToStack `powershell [Environment]::SetEnvironmentVariable(\"PSModulePath\", [Environment]::GetEnvironmentVariable(\"PSModulePath\", \"Machine\") -replace \"$([System.IO.Path]::PathSeparator)$psmDir\", \"Machine\")`
    Pop $0
    ${If} $0 != 0
        Pop $0
        MessageBox MB_OK "Error setting PSModulePath:$\n$0"
    ${EndIf}
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
        ${If} $0 == ""
            Abort
        ${EndIf}

        !insertmacro MUI_HEADER_TEXT $(title) $(subtitle)
        nsDialogs::Create 1018
        Pop $ovpnDialog
        ${If} $ovpnDialog == error
            Abort
        ${EndIf}

    ; -------------- OpenVPN --------------
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
        
        ; ------------- User data -------------
        ${If} $userDataFlag == true
            RMDir /r "$APPDATA\VPNUK"
        ${EndIf}
        
        SetShellVarContext all

        ; ----------- PSModulePath ------------
        call un.PSModulePath

        GetDlgItem $0 $hWndParent 1 ; 'Next' button handle
        EnableWindow $0 1
    FunctionEnd
    !pragma warning enable 6040
!macroend