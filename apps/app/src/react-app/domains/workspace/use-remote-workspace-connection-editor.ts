/** @jsxImportSource react */
import { useCallback, useMemo, useState } from "react";

import {
  workspaceUpdateRemote,
  type WorkspaceInfo,
} from "../../../app/lib/desktop";
import { buildOnMyAgentWorkspaceBaseUrl } from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import type { RemoteWorkspaceInput } from "./workspace-modal-types";

function describeEditorError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : t("app.unknown_error");
  } catch {
    return t("app.unknown_error");
  }
}

export function useRemoteWorkspaceConnectionEditor<TWorkspace extends WorkspaceInfo>(input: {
  workspaces: TWorkspace[];
  onSaved: (workspaceId: string) => void | Promise<void>;
}) {
  const { onSaved, workspaces } = input;
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workspace = useMemo(
    () =>
      workspaceId
        ? workspaces.find(
            (item) =>
              item.id === workspaceId && item.workspaceType === "remote",
          ) ?? null
        : null,
    [workspaces, workspaceId],
  );

  const initialValues = useMemo(
    () => {
      const hostUrl = workspace?.onmyagentHostUrl ?? workspace?.baseUrl ?? "";
      const mountedUrl = workspace?.remoteType === "onmyagent"
        ? buildOnMyAgentWorkspaceBaseUrl(hostUrl, workspace.onmyagentWorkspaceId) ?? hostUrl
        : hostUrl;
      return {
        onmyagentHostUrl: mountedUrl,
        onmyagentToken:
          workspace?.onmyagentToken ??
          workspace?.onmyagentClientToken ??
          workspace?.onmyagentHostToken ??
          "",
        directory: workspace?.directory ?? workspace?.path ?? "",
        displayName: workspace?.displayName ?? workspace?.name ?? "",
      };
    },
    [workspace],
  );

  const open = useCallback(
    (nextWorkspaceId: string) => {
      const next = workspaces.find((item) => item.id === nextWorkspaceId);
      if (!next || next.workspaceType !== "remote") return;
      setWorkspaceId(nextWorkspaceId);
      setError(null);
    },
    [workspaces],
  );

  const close = useCallback(() => {
    if (busy) return;
    setWorkspaceId(null);
    setError(null);
  }, [busy]);

  const save = useCallback(
    async (fields: RemoteWorkspaceInput) => {
      const id = workspaceId?.trim() ?? "";
      const baseUrl = fields.onmyagentHostUrl?.trim() ?? "";
      if (!id || !baseUrl) {
        setError(t("dashboard.remote_base_url_required"));
        return;
      }

      setBusy(true);
      setError(null);
      try {
        await workspaceUpdateRemote({
          workspaceId: id,
          baseUrl,
          onmyagentHostUrl: baseUrl,
          onmyagentToken: fields.onmyagentToken?.trim() ?? "",
          onmyagentClientToken: "",
          onmyagentHostToken: "",
          displayName: fields.displayName?.trim() || null,
          directory: fields.directory?.trim() || null,
          remoteType: "onmyagent",
        });
        await onSaved(id);
        setWorkspaceId(null);
      } catch (nextError) {
        setError(describeEditorError(nextError));
      } finally {
        setBusy(false);
      }
    },
    [onSaved, workspaceId],
  );

  return {
    workspace,
    busy,
    error,
    initialValues,
    open,
    close,
    save,
  };
}
