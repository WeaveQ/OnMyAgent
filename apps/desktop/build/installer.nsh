; Custom NSIS hooks for OnMyAgent Windows installer.
; Show the InstFiles details log (not an empty pane): enable printing and
; keep the details list open during the large 7z extract.

!macro customHeader
  ; Always show the log list under the progress bar.
  ShowInstDetails show
  ShowUninstDetails show
  !define MUI_INSTFILESPAGE_HEADINGTEXT "Installing OnMyAgent"
  !define MUI_INSTFILESPAGE_SUBHEADINGTEXT "Extracting runtimes and agents. Log lines appear below; the bar may pause during 7z extract."
!macroend

!macro customInit
  SetDetailsPrint both
  DetailPrint "Preparing OnMyAgent installer..."
!macroend

!macro customInstall
  ; Stock installSection may set SetDetailsPrint none at section start —
  ; scripts/patch-nsis-install-details.mjs forces "both". Re-assert here for
  ; post-extract steps.
  SetDetailsPrint both
  DetailPrint "Package extracted to $INSTDIR"
  DetailPrint "Writing shortcuts and registry entries..."
  DetailPrint "OnMyAgent installation complete."
!macroend
