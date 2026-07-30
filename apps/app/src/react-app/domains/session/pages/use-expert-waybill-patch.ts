/**
 * Expert waybill preview “保存修改”: persist into waybill-data.json directly.
 * Do NOT auto-send an agent turn — regenerating show_widget would wipe the
 * live edited preview and look like “save reverted my edit”.
 */
import { useEffect, useRef } from "react";

import { t } from "../../../../i18n";
import {
  applyWaybillDataPatch,
  waybillDataPathCandidates,
} from "../artifacts/waybill-preview-patch";

type WaybillSession = {
  id: string;
  directory?: string | null;
};

type WaybillServerClient = {
  readWorkspaceFile: (
    workspaceId: string,
    path: string,
  ) => Promise<{ content?: string }>;
  writeWorkspaceFile: (
    workspaceId: string,
    input: { path: string; content: string; force?: boolean },
  ) => Promise<unknown>;
};

export function useExpertWaybillPatch(input: {
  client: WaybillServerClient | null | undefined;
  workspaceId: string;
  selectedSessionId: string | null | undefined;
  selectedWorkspaceRoot: string | null | undefined;
  catalogRoot: string | null | undefined;
  rawWorkspaceSessions: WaybillSession[];
  currentAgentSessions: WaybillSession[];
  showToast: (toast: { tone: "warning"; title: string }) => void;
}): void {
  const lastWaybillPatchRef = useRef<string>("");

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ patch?: Record<string, unknown> }>)
        .detail;
      const patch = detail?.patch;
      if (!patch || typeof patch !== "object") return;
      const fingerprint = JSON.stringify(patch);
      if (!fingerprint || fingerprint === lastWaybillPatchRef.current) return;
      lastWaybillPatchRef.current = fingerprint;

      const client = input.client;
      const workspaceId = input.workspaceId.trim();
      if (!client || !workspaceId) return;

      const selectedSession =
        input.rawWorkspaceSessions.find(
          (session) => session.id === input.selectedSessionId,
        ) ??
        input.currentAgentSessions.find(
          (session) => session.id === input.selectedSessionId,
        ) ??
        null;
      const candidates = waybillDataPathCandidates({
        catalogRoot: String(input.catalogRoot ?? "").trim(),
        sessionRoot: input.selectedWorkspaceRoot ?? null,
        sessionDirectory: selectedSession?.directory ?? null,
      });

      void (async () => {
        let saved = false;
        for (const path of candidates) {
          try {
            let parsed: unknown = {};
            try {
              const file = await client.readWorkspaceFile(workspaceId, path);
              const content =
                typeof file.content === "string" ? file.content : "";
              parsed = content.trim() ? JSON.parse(content) : {};
            } catch {
              // Missing file is fine for the preferred session path — create it.
              parsed = {};
            }
            const next = applyWaybillDataPatch(parsed, patch);
            await client.writeWorkspaceFile(workspaceId, {
              path,
              content: `${JSON.stringify(next, null, 2)}\n`,
              force: true,
            });
            saved = true;
            break;
          } catch {
            // try next candidate path
          }
        }
        if (!saved) {
          input.showToast({
            tone: "warning",
            title: t("session.waybill_patch_save_failed"),
          });
        }
      })();
    };
    window.addEventListener("onmyagent-waybill-fields-patch", handler);
    return () =>
      window.removeEventListener("onmyagent-waybill-fields-patch", handler);
  }, [
    input.catalogRoot,
    input.client,
    input.currentAgentSessions,
    input.rawWorkspaceSessions,
    input.selectedSessionId,
    input.selectedWorkspaceRoot,
    input.showToast,
    input.workspaceId,
  ]);
}
