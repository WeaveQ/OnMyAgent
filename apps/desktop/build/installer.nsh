; Custom NSIS hooks for OnMyAgent Windows installer.
; Improves the install page copy so large 7z extraction does not feel "stuck".

!macro customHeader
  ShowInstDetails show
  ; InstFiles page titles (shown while extracting the embedded app package).
  !define MUI_INSTFILESPAGE_HEADINGTEXT "Installing OnMyAgent"
  !define MUI_INSTFILESPAGE_SUBHEADINGTEXT "Extracting a large package (~1 GB of runtimes and agents). The progress bar may pause for a while — please wait."
!macroend

!macro customInit
  ; Prefer showing detail lines when electron-builder does not suppress them.
  SetDetailsPrint both
!macroend

!macro customInstall
  DetailPrint "Writing shortcuts and registry entries..."
  DetailPrint "OnMyAgent installation complete."
!macroend
