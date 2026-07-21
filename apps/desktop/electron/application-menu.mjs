export function createApplicationMenuController(input) {
  const {
    appName,
    docsPageUrl,
    Menu,
    BrowserWindow,
    shell,
    createMainWindow,
    openSettingsEvent,
    toggleSidebarEvent,
  } = input;
  // macOS keeps the system menu bar (setMenuBarVisibility is a no-op there).
  // On Windows/Linux hide the native File/Edit/View strip by default — the app
  // chrome already has settings/navigation, and the native bar looks redundant.
  let applicationMenuVisible = process.platform === "darwin";

  async function openSettingsFromNativeMenu() {
    const win = await createMainWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send(openSettingsEvent);
  }

  async function toggleSidebarFromNativeMenu() {
    const win = await createMainWindow();
    win.webContents.send(toggleSidebarEvent);
  }

  function installApplicationMenu() {
    const isMac = process.platform === "darwin";
    const fileSubmenu = isMac
      ? [
          {
            label: "Settings...",
            accelerator: "CommandOrControl+,",
            click: () => {
              void openSettingsFromNativeMenu();
            },
          },
          { type: "separator" },
          { role: "close" },
        ]
      : [
          {
            label: "Settings...",
            accelerator: "CommandOrControl+,",
            click: () => {
              void openSettingsFromNativeMenu();
            },
          },
          { type: "separator" },
          { role: "quit" },
        ];
    const viewSubmenu = [
      {
        label: "Toggle Sidebar",
        accelerator: "CommandOrControl+B",
        click: () => {
          void toggleSidebarFromNativeMenu();
        },
      },
      { type: "separator" },
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ];
    const windowSubmenu = [
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { role: "close" },
    ];
    const template = [
      ...(isMac
        ? [
            {
              label: appName,
              submenu: [
                { role: "about" },
                { type: "separator" },
                {
                  label: "Settings...",
                  accelerator: "CommandOrControl+,",
                  click: () => {
                    void openSettingsFromNativeMenu();
                  },
                },
                { type: "separator" },
                { role: "services" },
                { type: "separator" },
                { role: "hide" },
                { role: "hideOthers" },
                { role: "unhide" },
                { type: "separator" },
                { role: "quit" },
              ],
            },
          ]
        : []),
      {
        label: "File",
        submenu: fileSubmenu,
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          ...(isMac
            ? [
                { role: "pasteAndMatchStyle" },
                { role: "delete" },
                { role: "selectAll" },
                { type: "separator" },
                {
                  label: "Speech",
                  submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }],
                },
              ]
            : [{ role: "delete" }, { type: "separator" }, { role: "selectAll" }]),
        ],
      },
      {
        label: "View",
        submenu: viewSubmenu,
      },
      isMac
        ? { role: "windowMenu" }
        : {
            label: "Window",
            submenu: windowSubmenu,
          },
      {
        role: "help",
        submenu: [
          {
            label: "Docs",
            click: async () => {
              await shell.openExternal(docsPageUrl);
            },
          },
        ],
      },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  function applyApplicationMenuVisibility(window) {
    if (process.platform === "darwin") return;
    window.setAutoHideMenuBar(false);
    window.setMenuBarVisibility(applicationMenuVisible);
  }

  function setApplicationMenuVisible(visible) {
    applicationMenuVisible = visible === true;
    for (const window of BrowserWindow.getAllWindows()) {
      applyApplicationMenuVisibility(window);
    }
    return applicationMenuVisible;
  }

  return {
    installApplicationMenu,
    applyApplicationMenuVisibility,
    setApplicationMenuVisible,
  };
}
