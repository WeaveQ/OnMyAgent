import { existsSync } from "node:fs";

export const LINUX_SOFTWARE_RENDER_ARGS = Object.freeze([
  "--disable-gpu",
  "--disable-gpu-compositing",
  "--disable-gpu-sandbox",
  "--in-process-gpu",
  "--disable-features=Dbus",
]);

export const LINUX_DUMMY_SESSION_BUS = "unix:path=/tmp/onmyagent-no-session-bus";
export const LINUX_DUMMY_SYSTEM_BUS = "unix:path=/tmp/onmyagent-no-system-bus";

/**
 * @param {{
 *   platform?: string,
 *   extraLaunchArgs?: string,
 *   resetHttpCache?: boolean,
 * }} [options]
 */
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

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   uid?: number,
 *   existsSync?: (path: string) => boolean,
 * }} [options]
 */
export function resolveLinuxSessionBusAddress({
  env = process.env,
  uid = typeof process.getuid === "function" ? process.getuid() : undefined,
  existsSync: exists = existsSync,
} = {}) {
  const existing = String(env.DBUS_SESSION_BUS_ADDRESS ?? "").trim();
  if (existing) return existing;
  if (typeof uid !== "number") return "";
  const socketPath = `/run/user/${uid}/bus`;
  if (exists(socketPath)) return `unix:path=${socketPath}`;
  return "";
}

/**
 * @param {{
 *   platform?: string,
 *   env?: NodeJS.ProcessEnv,
 *   uid?: number,
 *   existsSync?: (path: string) => boolean,
 * }} [options]
 */
export function resolveLinuxDesktopEnvDefaults({
  platform = process.platform,
  env = process.env,
  uid,
  existsSync: exists = existsSync,
} = {}) {
  if (platform !== "linux") return {};
  const extras = {};
  if (!String(env.GSETTINGS_BACKEND ?? "").trim()) {
    extras.GSETTINGS_BACKEND = "memory";
  }
  if (!String(env.DBUS_FATAL_WARNINGS ?? "").trim()) {
    extras.DBUS_FATAL_WARNINGS = "0";
  }
  if (!String(env.DBUS_SESSION_BUS_ADDRESS ?? "").trim()) {
    const address = resolveLinuxSessionBusAddress({ env, uid, existsSync: exists });
    extras.DBUS_SESSION_BUS_ADDRESS = address || LINUX_DUMMY_SESSION_BUS;
  }
  if (!String(env.DBUS_SYSTEM_BUS_ADDRESS ?? "").trim()) {
    const systemSocket = "/run/dbus/system_bus_socket";
    if (!exists(systemSocket)) {
      extras.DBUS_SYSTEM_BUS_ADDRESS = LINUX_DUMMY_SYSTEM_BUS;
    }
  }
  // Missing system/session bus sockets must not fail startup.
  return extras;
}

/**
 * @param {NodeJS.ProcessEnv} [targetEnv]
 * @param {{
 *   platform?: string,
 *   uid?: number,
 *   existsSync?: (path: string) => boolean,
 * }} [options]
 */
export function applyLinuxDesktopEnvDefaults(targetEnv = process.env, options = {}) {
  const extras = resolveLinuxDesktopEnvDefaults({
    platform: options.platform ?? process.platform,
    env: targetEnv,
    uid: options.uid,
    existsSync: options.existsSync,
  });
  Object.assign(targetEnv, extras);
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

/**
 * @param {any} app
 * @param {{
 *   platform?: string,
 *   extraLaunchArgs?: string,
 * }} [options]
 */
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
