export async function configureDesktopStartupFlags(app) {
  if (process.env.ONMYAGENT_DEV_MODE === "1") {
    // Before ready. Chromium otherwise sends Vite (127.0.0.1:5173) through
    // the OS proxy (FlClash / Clash for Windows) and the window stays white
    // on empty 502. Command-line bypass keeps system proxy for remote APIs.
    app.commandLine.appendSwitch(
      "proxy-bypass-list",
      "<-loopback>;<local>;localhost;127.0.0.1;::1;[::1]",
    );
  }

  const extraLaunchArgs = (process.env.ELECTRON_EXTRA_LAUNCH_ARGS ?? "").trim();
  if (extraLaunchArgs) {
    for (const arg of extraLaunchArgs.split(/\s+/)) {
      const cleaned = arg.replace(/^--/, "");
      if (!cleaned) continue;
      const eqIdx = cleaned.indexOf("=");
      if (eqIdx > 0) {
        app.commandLine.appendSwitch(
          cleaned.slice(0, eqIdx),
          cleaned.slice(eqIdx + 1),
        );
      } else {
        app.commandLine.appendSwitch(cleaned);
      }
    }
  }

  return {};
}
