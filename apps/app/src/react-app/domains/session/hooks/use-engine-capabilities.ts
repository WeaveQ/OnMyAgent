/**
 * Engine capabilities for a workspace — consumed to degrade UI surfaces that
 * the workspace's agent engine does not support (todo progress, MCP, skills
 * management, approvals).
 *
 * Data comes from GET /workspaces/:id/agent/capabilities (engine-agnostic).
 *
 * Client is injected (not read from a store) so the hook works anywhere the
 * SessionSurface server target is available; falls back to opencode defaults
 * (no degradation) while loading or when the endpoint is unavailable.
 */

import { useCallback, useEffect, useState } from "react";

import type { OnMyAgentAgentCapabilitiesResponse } from "../../../../app/lib/onmyagent-server";
import { shouldEnablePiEngineSwitcher } from "../../../../app/lib/pi-office-surface-gate";
import { isDesktopRuntime } from "../../../../app/utils";

/** Current office-loop facts. Flip only when events/abort/get are actually routed. */
const PI_OFFICE_LOOP = {
  hasEngineEventSse: false,
  hasEngineAbortRoute: false,
  hasPiReadWorkspaceSession: false,
  piOpencodeProxyReturns501: true,
} as const;

const POLL_MS = 30_000;

export type EngineCapabilitiesState = {
  engine: "opencode" | "pi" | null;
  capabilities: OnMyAgentAgentCapabilitiesResponse["capabilities"] | null;
  loading: boolean;
  /** True when the workspace runs an engine that lacks the given feature. */
  lacks: (feature: "todo" | "mcp" | "skills" | "approvals") => boolean;
  isExperimentalEngine: boolean;
  canOfferPiEngineSwitcher: boolean;
};

export function useEngineCapabilities(
  client: { getAgentCapabilities: (workspaceId: string) => Promise<OnMyAgentAgentCapabilitiesResponse> } | null | undefined,
  workspaceId: string | null | undefined,
): EngineCapabilitiesState {
  const [state, setState] = useState<{
    engine: "opencode" | "pi" | null;
    capabilities: OnMyAgentAgentCapabilitiesResponse["capabilities"] | null;
    loading: boolean;
  }>({ engine: null, capabilities: null, loading: false });

  const refresh = useCallback(async () => {
    if (!workspaceId || !client || !isDesktopRuntime()) return;
    try {
      setState((prev) => ({ ...prev, loading: true }));
      const response = await client.getAgentCapabilities(workspaceId);
      setState({
        engine: (response.engine === "pi" ? "pi" : "opencode") as "opencode" | "pi",
        capabilities: response.capabilities,
        loading: false,
      });
    } catch {
      // Non-fatal: fall back to opencode defaults (no degradation).
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [workspaceId, client]);

  useEffect(() => {
    void refresh();
    if (!workspaceId) return;
    const id = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, workspaceId]);

  const lacks = useCallback(
    (feature: "todo" | "mcp" | "skills" | "approvals"): boolean => {
      const cap = state.capabilities;
      if (!cap) return false;
      switch (feature) {
        case "todo":
          return !cap.todo;
        case "mcp":
          return !cap.mcp;
        case "skills":
          return !cap.skills;
        case "approvals":
          return cap.approvals === "none";
        default:
          return false;
      }
    },
    [state.capabilities],
  );

  return {
    engine: state.engine,
    capabilities: state.capabilities,
    loading: state.loading,
    lacks,
    isExperimentalEngine: state.engine === "pi",
    canOfferPiEngineSwitcher: shouldEnablePiEngineSwitcher(PI_OFFICE_LOOP),
  };
}
