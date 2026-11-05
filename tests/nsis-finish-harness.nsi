; Compile the custom finish page with electron-builder's existing launch contract.
Unicode true
RequestExecutionLevel admin
!include "MUI2.nsh"
!include "LogicLib.nsh"
!define isUpdated '"" == "--updated"'
; StdUtils belongs to electron-builder, unavailable in this compile-only harness.
; Verify the real macro invocation structurally in windows-1.4.0.cjs.
!macro StubExecShellAsUser RESULT LINK VERB ARGS
    StrCpy ${RESULT} "not-executed"
!macroend
!define StdUtils.ExecShellAsUser "!insertmacro StubExecShellAsUser"
Var launchLink
!include "..\nsis\extension.nsh"
Name "VPNUK finish page compile check"
!ifndef OUTPUT_FILE
    !define OUTPUT_FILE "vpnuk-finish-compile-check.exe"
!endif
OutFile "${OUTPUT_FILE}"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro customFinishPage
!insertmacro MUI_LANGUAGE "English"
Section
    DetailPrint "Compile-only harness. Do not install."
SectionEnd
