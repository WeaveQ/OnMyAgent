export const LINUX_SOFTWARE_RENDER_ARGS = Object.freeze([
  "--disable-gpu",
  "--disable-gpu-compositing",
  "--disable-gpu-sandbox",
  "--in-process-gpu",
]);

export function resolveElectronExtraLaunchArgs({
  platform = process.platform,
  extraLaunchArgs = "",
  resetHttpCache = false,
} = {}) {
  const operator = String(extraLaunchArgs ?? "").trim();
  const linuxDefaults =
    platform === "linux" && !operator
      ? LINUX_SOFTWARE_RENDER_ARGS.join(" ")
      : "";
  return [operator || linuxDefaults, resetHttpCache ? "--disable-http-cache" : ""]
    .filter(Boolean)
    .join(" ");
}

export function resolveLinuxDesktopEnvDefaults({
  platform = process.platform,
  env = process.env,
} = {}) {
  if (platform !== "linux") return {};
  const extras = {};
  if (!String(env.GSETTINGS_BACKEND ?? "").trim()) {
    extras.GSETTINGS_BACKEND = "memory";
  }
  return extras;
}

export function applyElectronLaunchArgString(app, raw) {
  const extraLaunchArgs = String(raw ?? "").trim();
  if (!extraLaunchArgs) return;
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

export async function configureDesktopStartupFlags(app, options = {}) {
  if (process.env.ONMYAGENT_DEV_MODE === "1") {
    app.commandLine.appendSwitch(
      "proxy-bypass-list",
      "<-loopback>;<local>;localhost;127.0.0.1;::1;[::1]",
    );
  }

  const platform = options.platform ?? process.platform;
  const resolved = resolveElectronExtraLaunchArgs({
    platform,
    extraLaunchArgs:
      options.extraLaunchArgs ?? process.env.ELECTRON_EXTRA_LAUNCH_ARGS,
  });
  applyElectronLaunchArgString(app, resolved);

  return {};
}
