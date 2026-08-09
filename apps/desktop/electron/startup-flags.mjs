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

  return {};
}
