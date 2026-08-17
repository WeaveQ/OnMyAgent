import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import {
  collectWindowsAppInstallDirs,
  installDirFromUninstallFields,
} from "./windows-app-locate.mjs";

test("installDirFromUninstallFields prefers an existing InstallLocation", () => {
  const home = process.env.USERPROFILE || process.env.HOME || process.cwd();
  assert.equal(installDirFromUninstallFields({ installLocation: home }), home);
});

test("installDirFromUninstallFields recovers Electron DisplayIcon and UninstallString", () => {
  const exe = process.execPath;
  const dir = exe.replace(/[\\/][^\\/]+$/, "");
  assert.equal(
    installDirFromUninstallFields({
      installLocation: "",
      displayIcon: `${exe},0`,
      uninstallString: "",
    }),
    dir,
  );
  assert.equal(
    installDirFromUninstallFields({
      uninstallString: `"${exe}" /currentuser`,
    }),
    dir,
  );
  assert.equal(installDirFromUninstallFields({ uninstallString: "MsiExec.exe /I{GUID}" }), "");
});

test("collectWindowsAppInstallDirs skips registry when a default dir exists", () => {
  if (process.platform !== "win32") return;
  const home = process.env.USERPROFILE || process.cwd();
  const started = Date.now();
  const dirs = collectWindowsAppInstallDirs({
    namePattern: /definitely-not-a-real-app-zzzz/i,
    defaultDirs: [home],
  });
  assert.ok(dirs.some((dir) => dir.replaceAll("/", "\\").toLowerCase() === home.replaceAll("/", "\\").toLowerCase()));
  assert.ok(Date.now() - started < 750, "default-dir hit must not wait on PowerShell");
});

test("Windows WorkBuddy custom install is found via uninstall registry or Start Menu", () => {
  if (process.platform !== "win32") return;
  const custom = "D:\\soft\\workbuddy";
  if (!existsSync(custom)) return;
  const dirs = collectWindowsAppInstallDirs({
    namePattern: /workbuddy/i,
    defaultDirs: [`${process.env.LOCALAPPDATA}\\Programs\\WorkBuddy`],
  });
  assert.ok(
    dirs.some((dir) => dir.replaceAll("/", "\\").toLowerCase() === custom.toLowerCase()),
    `expected ${custom} in ${JSON.stringify(dirs)}`,
  );
});
