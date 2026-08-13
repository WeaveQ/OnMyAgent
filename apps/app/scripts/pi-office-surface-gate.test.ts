import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { shouldEnablePiEngineSwitcher } from "../src/app/lib/pi-office-surface-gate";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function inspectShippedPiOfficeLoop() {
  const server = readFileSync(join(appRoot, "../server/src/server.ts"), "utf8");
  const sessions = readFileSync(
    join(appRoot, "../server/src/services/workspace-sessions.ts"),
    "utf8",
  );
  const routes = readFileSync(
    join(appRoot, "../server/src/routes/workspace-session-routes.ts"),
    "utf8",
  );
  const surface = readFileSync(
    join(appRoot, "src/react-app/domains/session/surface/session-surface.tsx"),
    "utf8",
  );
  return {
    hasEngineEventSse: /engine\.onEvent\(/.test(server),
    hasEngineAbortRoute: /engine\.abort\(/.test(routes),
    hasPiReadWorkspaceSession:
      /export async function readWorkspaceSession[\s\S]*resolveEngineId\(config, workspace\) === "pi"/.test(
        sessions,
      ),
    piOpencodeProxyReturns501: /pi_unsupported_opencode_surface/.test(server),
    switcherMounted: /<EngineSwitcher[\s>/]/.test(surface) || /\bEngineSwitcher\(/.test(surface),
  };
}

describe("Pi office surface gate", () => {
  test("decision is false while events/abort/get are missing or proxy 501s", () => {
    expect(
      shouldEnablePiEngineSwitcher({
        hasEngineEventSse: false,
        hasEngineAbortRoute: false,
        hasPiReadWorkspaceSession: false,
        piOpencodeProxyReturns501: true,
      }),
    ).toBe(false);
    expect(
      shouldEnablePiEngineSwitcher({
        hasEngineEventSse: true,
        hasEngineAbortRoute: true,
        hasPiReadWorkspaceSession: true,
        piOpencodeProxyReturns501: false,
      }),
    ).toBe(true);
  });

  test("session surface does not enable a Pi switch while those routes 501", () => {
    const loop = inspectShippedPiOfficeLoop();
    const allowed = shouldEnablePiEngineSwitcher(loop);
    expect(allowed).toBe(false);
    expect(loop.piOpencodeProxyReturns501).toBe(true);
    expect(loop.switcherMounted && loop.piOpencodeProxyReturns501).toBe(false);
    if (loop.switcherMounted) {
      expect(allowed).toBe(true);
    }
  });
});
