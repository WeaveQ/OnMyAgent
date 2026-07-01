import { spawnAcpClient } from "./acp-client.mjs";

export async function probeAcpCommand({ command, args = [], cwd = process.cwd(), timeoutMs = 10_000 }) {
  const events = [];
  const { child, client } = spawnAcpClient({
    command,
    args,
    cwd,
    env: process.env,
    appendEvent: (event) => events.push(event),
  });
  try {
    const initialized = await client.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "onmyagent-acp-probe", version: "0.1.0" },
      clientCapabilities: {},
    }, timeoutMs);
    return { ok: true, initialized, events };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), events };
  } finally {
    client.dispose();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
}
