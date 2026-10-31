; Compile-only check of the include in electron-builder's installer pass.
; No BUILD_UNINSTALLER define: uninstall-only globals must not leak here.
Unicode true
RequestExecutionLevel admin
!include "..\nsis\extension.nsh"
Name "VPNUK installer include compile check"
!ifndef OUTPUT_FILE
    !define OUTPUT_FILE "vpnuk-install-include-compile-check.exe"
!endif
OutFile "${OUTPUT_FILE}"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section
    DetailPrint "Compile-only harness. Do not install."
SectionEnd
