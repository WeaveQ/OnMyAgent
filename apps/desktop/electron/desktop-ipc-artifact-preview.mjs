export function registerDesktopArtifactPreviewIpc({ ipcMain, artifactPreviewController }) {
  ipcMain.on("onmyagent:artifact-preview:ready", (event) => {
    artifactPreviewController.sendFileTo(event.sender);
  });
  ipcMain.handle("onmyagent:artifact-preview:show", (_event, request) =>
    artifactPreviewController.show(request),
  );
  ipcMain.handle("onmyagent:artifact-preview:hide", () => artifactPreviewController.hide());
  ipcMain.handle("onmyagent:artifact-preview:bounds", (_event, bounds) =>
    artifactPreviewController.setBounds(bounds),
  );
}
