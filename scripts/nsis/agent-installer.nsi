; Game-Servum Agent — NSIS Installer Script
; Installs the Agent as a Windows Service using WinSW
;
; Expected staging layout (set via STAGING_DIR define):
;   node.exe, agent.mjs, agent.mjs.map, sql-wasm.wasm
;   GameServumAgent.exe (WinSW), GameServumAgent.xml (WinSW config)
;   .env.example

; ──────────────────────────────────────────────────────────
;  Build-time defines (passed via makensis -D flags)
; ──────────────────────────────────────────────────────────
;   PRODUCT_VERSION  — e.g. "1.2.0"
;   STAGING_DIR      — path to staging directory with all files
;   OUTPUT_FILE      — path to output installer .exe

!ifndef PRODUCT_VERSION
  !define PRODUCT_VERSION "0.0.0"
!endif
!ifndef OUTPUT_FILE
  !define OUTPUT_FILE "Game-Servum-Agent-Setup-v${PRODUCT_VERSION}.exe"
!endif

; ──────────────────────────────────────────────────────────
;  Constants
; ──────────────────────────────────────────────────────────
!define PRODUCT_NAME        "Game-Servum Agent"
!define SERVICE_NAME        "GameServumAgent"
!define INSTALL_DIR         "$PROGRAMFILES64\Game-Servum Agent"
!define DEFAULT_DATA_DIR    "$%ProgramData%\Game-Servum"
!define UNINSTALL_REG_KEY   "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SERVICE_NAME}"
!define ENV_REG_KEY         "SYSTEM\CurrentControlSet\Control\Session Manager\Environment"
!define FIREWALL_RULE_NAME  "Game-Servum Agent (TCP 3001)"

; ──────────────────────────────────────────────────────────
;  Installer attributes
; ──────────────────────────────────────────────────────────
Name "${PRODUCT_NAME} v${PRODUCT_VERSION}"
OutFile "${OUTPUT_FILE}"
InstallDir "${INSTALL_DIR}"
RequestExecutionLevel admin
ShowInstDetails show
ShowUninstDetails show
BrandingText "${PRODUCT_NAME} v${PRODUCT_VERSION}"

; ──────────────────────────────────────────────────────────
;  Includes
; ──────────────────────────────────────────────────────────
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

; ──────────────────────────────────────────────────────────
;  Code signing (uninstaller)
; ──────────────────────────────────────────────────────────
; When ENABLE_SIGNING is defined, sign the uninstaller during compilation
; using the sign.bat created by the build script in the staging directory
!ifdef ENABLE_SIGNING
  !uninstfinalize '"${STAGING_DIR}\sign.bat" "%1"'
!endif

; ──────────────────────────────────────────────────────────
;  Variables
; ──────────────────────────────────────────────────────────
Var DataDir
Var DataDirField
Var IsUpgrade

; ──────────────────────────────────────────────────────────
;  Modern UI
; ──────────────────────────────────────────────────────────
!define MUI_ABORTWARNING
!define MUI_ICON "${STAGING_DIR}\agent-icon.ico"
!define MUI_UNICON "${STAGING_DIR}\agent-icon.ico"

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${STAGING_DIR}\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
Page custom DataDirPageCreate DataDirPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Language
!insertmacro MUI_LANGUAGE "English"

; ──────────────────────────────────────────────────────────
;  Data directory custom page
; ──────────────────────────────────────────────────────────
Function DataDirPageCreate
  !insertmacro MUI_HEADER_TEXT "Data Directory" "Choose where game server data will be stored."

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 36u "Select the directory for game server data (database, game servers, SteamCMD, logs).$\r$\n$\r$\nThis can be on any drive with sufficient disk space."
  Pop $0

  ${NSD_CreateGroupBox} 0 42u 100% 34u "Data Directory"
  Pop $0

  ${NSD_CreateDirRequest} 6u 55u 73% 13u "$DataDir"
  Pop $DataDirField

  ${NSD_CreateBrowseButton} 77% 54u 21% 15u "Browse..."
  Pop $0
  ${NSD_OnClick} $0 OnDataDirBrowse

  nsDialogs::Show
FunctionEnd

Function OnDataDirBrowse
  nsDialogs::SelectFolderDialog "Select Data Directory" "$DataDir"
  Pop $0
  ${If} $0 != error
    ${NSD_SetText} $DataDirField "$0"
  ${EndIf}
FunctionEnd

Function DataDirPageLeave
  ${NSD_GetText} $DataDirField $DataDir
  ; Validate: must not be empty
  StrCmp $DataDir "" 0 +3
    MessageBox MB_OK|MB_ICONEXCLAMATION "Please select a data directory."
    Abort
FunctionEnd

; ──────────────────────────────────────────────────────────
;  Installer functions
; ──────────────────────────────────────────────────────────
Function .onInit
  ; Default data directory
  StrCpy $DataDir "${DEFAULT_DATA_DIR}"

  ; If already installed, restore previous data directory
  ReadRegStr $0 HKLM "${UNINSTALL_REG_KEY}" "DataDirectory"
  StrCmp $0 "" done_init
    StrCpy $DataDir $0
    Goto check_upgrade

  check_upgrade:
  ; Check if an older version is installed — offer upgrade
  ReadRegStr $0 HKLM "${UNINSTALL_REG_KEY}" "InstallLocation"
  StrCmp $0 "" done_init

  ; Use existing install location for upgrade (may differ from new default)
  StrCpy $INSTDIR $0
  StrCpy $IsUpgrade "1"

  ; Check if the service is currently running
  nsExec::ExecToStack 'cmd /c sc query ${SERVICE_NAME} | find "RUNNING"'
  Pop $0
  Pop $1
  StrCmp $0 "0" service_is_running

  ; Service is not running — simple upgrade dialog
  MessageBox MB_OKCANCEL|MB_ICONINFORMATION \
    "${PRODUCT_NAME} is already installed.$\n$\nThe installer will upgrade files and restart the service." \
    IDOK done_init
  Abort

  service_is_running:
  ; Service is running — warn about active game servers
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
    "${PRODUCT_NAME} is currently running and may be managing active game servers.$\n$\nAll running game servers will be gracefully stopped during the upgrade.$\n$\nDo you want to continue?" \
    IDOK do_upgrade
  Abort

  do_upgrade:
    ; Send stop signal now — the Install section will wait for completion
    nsExec::ExecToLog 'sc stop ${SERVICE_NAME}'
    Goto done_init

  done_init:
FunctionEnd

; ──────────────────────────────────────────────────────────
;  Install section
; ──────────────────────────────────────────────────────────
Section "Install"
  ; --- Upgrade: wait for service to fully stop before overwriting files ---
  StrCmp $IsUpgrade "1" 0 skip_service_wait

    StrCpy $2 0
    service_wait_loop:
      ; Check if service has reached STOPPED state
      nsExec::ExecToStack 'cmd /c sc query ${SERVICE_NAME} | find "STOPPED"'
      Pop $0
      Pop $1
      StrCmp $0 "0" service_wait_done

      ; Not stopped yet — wait and retry
      IntOp $2 $2 + 1
      DetailPrint "Waiting for service to stop... ($2s)"
      Sleep 1000
      IntCmp $2 45 service_wait_timeout service_wait_loop service_wait_timeout

    service_wait_timeout:
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
        "The ${PRODUCT_NAME} service did not stop within 45 seconds.$\n$\nPlease close any programs that may be using the Agent, then click Retry.$\n$\nClick Cancel to abort the installation." \
        IDRETRY service_wait_retry
      Abort

    service_wait_retry:
      ; Re-send stop signal and reset counter
      nsExec::ExecToLog 'sc stop ${SERVICE_NAME}'
      StrCpy $2 0
      Goto service_wait_loop

    service_wait_done:
      DetailPrint "Service stopped successfully."

  skip_service_wait:
  SetOutPath "$INSTDIR"

  ; Copy application files
  File "${STAGING_DIR}\node.exe"
  File "${STAGING_DIR}\agent.mjs"
  File "${STAGING_DIR}\agent.mjs.map"
  File "${STAGING_DIR}\sql-wasm.wasm"
  File "${STAGING_DIR}\GameServumAgent.exe"
  File "${STAGING_DIR}\GameServumAgent.xml"
  File "${STAGING_DIR}\agent-icon.ico"
  File /nonfatal "${STAGING_DIR}\.env.example"

  ; Patch WinSW config: replace placeholders with actual data directory paths
  ; (WinSW cannot expand system env vars reliably on first install)
  DetailPrint "Patching service configuration with data directory..."
  FileOpen $0 "$TEMP\patch-winsw.ps1" w
  FileWrite $0 "$$c = Get-Content -Raw '$INSTDIR\GameServumAgent.xml'$\r$\n"
  FileWrite $0 "$$c = $$c.Replace('{{LOGPATH}}', '$DataDir\logs').Replace('{{DATA_DIR}}', '$DataDir')$\r$\n"
  FileWrite $0 "Set-Content -Path '$INSTDIR\GameServumAgent.xml' -Value $$c -Encoding UTF8 -NoNewline$\r$\n"
  FileClose $0
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$TEMP\patch-winsw.ps1"'
  Pop $0
  DetailPrint "Config patch returned: $0"
  Delete "$TEMP\patch-winsw.ps1"

  ; Create data directories
  CreateDirectory "$DataDir"
  CreateDirectory "$DataDir\data"
  CreateDirectory "$DataDir\servers"
  CreateDirectory "$DataDir\steamcmd"
  CreateDirectory "$DataDir\logs"

  ; Copy .env.example to data directory if no .env exists yet
  IfFileExists "$DataDir\.env" +2
    CopyFiles /SILENT "$INSTDIR\.env.example" "$DataDir\.env"

  ; Set system environment variable GAME_SERVUM_ROOT
  ; Useful for external tools/scripts; WinSW config is already patched with the actual path
  ReadRegStr $0 HKLM "${ENV_REG_KEY}" "GAME_SERVUM_ROOT"
  StrCmp $0 $DataDir env_unchanged

    DetailPrint "Setting GAME_SERVUM_ROOT = $DataDir"
    WriteRegExpandStr HKLM "${ENV_REG_KEY}" "GAME_SERVUM_ROOT" "$DataDir"
    ; Broadcast change so running processes pick it up (reduced timeout)
    SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=1000
    Goto env_done

  env_unchanged:
    DetailPrint "GAME_SERVUM_ROOT unchanged, skipping environment broadcast."

  env_done:

  ; Install Windows Service via WinSW
  DetailPrint "Installing Windows Service..."
  nsExec::ExecToLog '"$INSTDIR\GameServumAgent.exe" install'
  Pop $0
  DetailPrint "WinSW install returned: $0"

  ; Start the service
  DetailPrint "Starting ${PRODUCT_NAME} service..."
  nsExec::ExecToLog 'sc start ${SERVICE_NAME}'

  ; Add Windows Firewall rule (TCP inbound port 3001) only if not already present
  nsExec::ExecToLog 'netsh advfirewall firewall show rule name="${FIREWALL_RULE_NAME}"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Adding firewall rule..."
    nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${FIREWALL_RULE_NAME}" dir=in action=allow protocol=TCP localport=3001'
  ${Else}
    DetailPrint "Firewall rule already exists, skipping..."
  ${EndIf}

  ; Write uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Register in Add/Remove Programs
  WriteRegStr HKLM "${UNINSTALL_REG_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "${UNINSTALL_REG_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "${UNINSTALL_REG_KEY}" "DisplayIcon" "$INSTDIR\agent-icon.ico"
  WriteRegStr HKLM "${UNINSTALL_REG_KEY}" "Publisher" "xscr33mLabs"
  WriteRegStr HKLM "${UNINSTALL_REG_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINSTALL_REG_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTALL_REG_KEY}" "DataDirectory" "$DataDir"
  WriteRegDWORD HKLM "${UNINSTALL_REG_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTALL_REG_KEY}" "NoRepair" 1

  ; Calculate installed size
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${UNINSTALL_REG_KEY}" "EstimatedSize" $0
SectionEnd

; ──────────────────────────────────────────────────────────
;  Uninstall section
; ──────────────────────────────────────────────────────────
Section "Uninstall"
  ; Read data directory from registry
  ReadRegStr $DataDir HKLM "${UNINSTALL_REG_KEY}" "DataDirectory"
  StrCmp $DataDir "" 0 +2
    StrCpy $DataDir "${DEFAULT_DATA_DIR}"

  ; Stop and uninstall the service
  DetailPrint "Stopping ${PRODUCT_NAME} service..."
  nsExec::ExecToLog 'sc stop ${SERVICE_NAME}'

  ; Wait for service to fully stop (max 45 seconds)
  StrCpy $2 0
  uninst_wait_loop:
    nsExec::ExecToStack 'cmd /c sc query ${SERVICE_NAME} | find "STOPPED"'
    Pop $0
    Pop $1
    StrCmp $0 "0" uninst_wait_done

    DetailPrint "Waiting for service to stop... ($2s)"
    Sleep 1000
    IntOp $2 $2 + 1
    IntCmp $2 45 uninst_wait_done uninst_wait_loop uninst_wait_done

  uninst_wait_done:

  DetailPrint "Uninstalling Windows Service..."
  nsExec::ExecToLog '"$INSTDIR\GameServumAgent.exe" uninstall'
  Sleep 2000

  ; Remove firewall rule
  DetailPrint "Removing firewall rule..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FIREWALL_RULE_NAME}"'

  ; Remove system environment variable
  DeleteRegValue HKLM "${ENV_REG_KEY}" "GAME_SERVUM_ROOT"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=1000

  ; Remove installation directory
  RMDir /r "$INSTDIR"

  ; Remove registry entries
  DeleteRegKey HKLM "${UNINSTALL_REG_KEY}"

  ; NOTE: Data directory ($DataDir) is intentionally preserved
  ; to keep user data (database, servers, steamcmd, logs)
  MessageBox MB_OK|MB_ICONINFORMATION \
    "Uninstallation complete.$\n$\nYour data has been preserved at:$\n$DataDir$\n$\nYou can delete this folder manually if you no longer need it."
SectionEnd
