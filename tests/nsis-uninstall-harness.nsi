; Compile-only integration harness. Do not run this dummy installer.
Unicode true
RequestExecutionLevel admin
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "nsDialogs.nsh"
!define isUpdated '"" == "--updated"'
!include "..\nsis\extension.nsh"
Name "VPNUK uninstall compile check"
!ifndef OUTPUT_FILE
    !define OUTPUT_FILE "vpnuk-uninstall-compile-check.exe"
!endif
OutFile "${OUTPUT_FILE}"
InstallDir "$TEMP\VPNUK-Uninstall-Compile-Check"
!insertmacro customUninstallPage
UninstPage instfiles
!insertmacro MUI_LANGUAGE "English"
Function un.onInit
    !insertmacro customUnInit
FunctionEnd
Section
    SetOutPath "$INSTDIR"
    WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd
Section Uninstall
    !insertmacro customRemoveFiles
SectionEnd
