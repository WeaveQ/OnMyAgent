import net from "node:net";

function probePort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen({ port, host: "127.0.0.1" }, () => {
      srv.close(() => resolve(true));
    });
  });
}

async function findFreeCdpPort(candidates) {
  for (const port of candidates) {
    if (await probePort(port)) return port;
  }
  return 0;
}

export async function configureDesktopStartupFlags(app) {
  const explicitCdpPort = Number.parseInt(
    process.env.ONMYAGENT_ELECTRON_REMOTE_DEBUG_PORT?.trim() ?? "",
    10,
  );
  const remoteDebugPort =
    Number.isFinite(explicitCdpPort) && explicitCdpPort > 0
      ? explicitCdpPort
      : await findFreeCdpPort([9223, 9224, 9225, 9226, 9227]);
  if (remoteDebugPort > 0) {
    app.commandLine.appendSwitch(
      "remote-debugging-port",
      String(remoteDebugPort),
    );
    app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  }
  process.env.ONMYAGENT_ELECTRON_REMOTE_DEBUG_PORT = String(remoteDebugPort);

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

  return { remoteDebugPort };
}
