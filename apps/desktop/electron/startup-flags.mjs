export async function configureDesktopStartupFlags(app) {
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

  // Dev renderer loads Vite from localhost. Chromium's HTTP cache can keep
  // module graphs that import optimize-deps chunks deleted after a re-opt,
  // which paints a permanent blank window. Always disable HTTP cache in dev.
  if (process.env.ONMYAGENT_DEV_MODE === "1") {
    app.commandLine.appendSwitch("disable-http-cache");
  }

  return {};
}
