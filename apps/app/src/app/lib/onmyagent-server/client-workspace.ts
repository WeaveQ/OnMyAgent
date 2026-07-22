/** Domain methods: Workspace for OnMyAgent server HTTP client. */
import type { ExecResult, OpencodeConfigFile, WorkspaceInfo, WorkspaceList } from "../desktop";
import {
  arrayBufferToBase64,
  OnMyAgentServerError,
  requestBinary,
  requestJson,
  requestMultipartRaw,
  type OnMyAgentServerClientContext,
  type OnMyAgentWorkspaceFileCatalogEntry,
  type OnMyAgentWorkspaceList,
  type OnMyAgentWorkspaceInfo,
  type OnMyAgentWorkspaceExport,
  type OnMyAgentWorkspaceExportSensitiveMode,
  type OnMyAgentWorkspaceImportPreview,
  type OnMyAgentBlueprintSessionsMaterializeResult,
  type OnMyAgentWorkspaceFileContent,
  type OnMyAgentWorkspaceFileWriteResult,
  type OnMyAgentWorkspaceFileStat,
  type OnMyAgentWorkspaceFileCatalog,
  type OnMyAgentInboxList,
  type OnMyAgentInboxUploadResult,
  type OnMyAgentArtifactList,
  type OnMyAgentResolvedArtifactTarget,
} from "./client-shared";

export function createWorkspaceClientMethods(ctx: OnMyAgentServerClientContext) {
  const { baseUrl, token, hostToken, timeouts, requestOpenCodeRouter, routerPath } = ctx;

  return {
    listWorkspaces: () => requestJson<OnMyAgentWorkspaceList>(baseUrl, "/workspaces", { token, hostToken, timeoutMs: timeouts.listWorkspaces }),
    createLocalWorkspace: (payload: { folderPath: string; name: string; preset: string }) =>
      requestJson<WorkspaceList>(baseUrl, "/workspaces/local", {
        token,
        hostToken,
        method: "POST",
        body: payload,
        timeoutMs: timeouts.activateWorkspace,
      }),
    updateWorkspaceDisplayName: (workspaceId: string, displayName: string | null) =>
      requestJson<WorkspaceList>(baseUrl, `/workspaces/${encodeURIComponent(workspaceId)}/display-name`, {
        token,
        hostToken,
        method: "PATCH",
        body: { displayName },
        timeoutMs: timeouts.activateWorkspace,
      }),
    activateWorkspace: (workspaceId: string) =>
      requestJson<{ activeId: string; workspace: OnMyAgentWorkspaceInfo }>(
        baseUrl,
        `/workspaces/${encodeURIComponent(workspaceId)}/activate`,
        { token, hostToken, method: "POST", timeoutMs: timeouts.activateWorkspace },
      ),
    deleteWorkspace: (workspaceId: string) =>
      requestJson<{ ok: boolean; deleted: boolean; persisted: boolean; activeId: string | null; items: OnMyAgentWorkspaceInfo[]; workspaces?: WorkspaceInfo[] }>(
        baseUrl,
        `/workspaces/${encodeURIComponent(workspaceId)}`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.deleteWorkspace },
      ),
    exportWorkspace: (
      workspaceId: string,
      options?: { sensitiveMode?: OnMyAgentWorkspaceExportSensitiveMode },
    ) => {
      const query = new URLSearchParams();
      if (options?.sensitiveMode) {
        query.set("sensitive", options.sensitiveMode);
      }
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<OnMyAgentWorkspaceExport>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/export${suffix}`, {
        token,
        hostToken,
        timeoutMs: timeouts.workspaceExport,
      });
    },
    importWorkspace: (workspaceId: string, payload: Record<string, unknown>) =>
      requestJson<{ ok: boolean; preview?: OnMyAgentWorkspaceImportPreview }>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/import`, {
        token,
        hostToken,
        method: "POST",
        body: payload,
        timeoutMs: timeouts.workspaceImport,
      }),
    previewWorkspaceImport: (workspaceId: string, payload: Record<string, unknown>) =>
      requestJson<OnMyAgentWorkspaceImportPreview>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/import/preview`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
          timeoutMs: timeouts.workspaceImport,
        },
      ),
    materializeBlueprintSessions: (workspaceId: string) =>
      requestJson<OnMyAgentBlueprintSessionsMaterializeResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/blueprint/sessions/materialize`,
        {
          token,
          hostToken,
          method: "POST",
          timeoutMs: timeouts.workspaceImport,
        },
      ),
    readOpencodeConfigFile: (workspaceId: string, scope: "project" | "global" = "project") => {
      const query = `?scope=${scope}`;
      return requestJson<OpencodeConfigFile>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/opencode-config${query}`, {
        token,
        hostToken,
      });
    },
    writeOpencodeConfigFile: (workspaceId: string, scope: "project" | "global", content: string) =>
      requestJson<ExecResult>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/opencode-config`, {
        token,
        hostToken,
        method: "POST",
        body: { scope, content },
      }),
    uploadInbox: async (workspaceId: string, file: File, options?: { path?: string }) => {
      const id = workspaceId.trim();
      if (!id) throw new Error("workspaceId is required");
      if (!file) throw new Error("file is required");
      const form = new FormData();
      form.append("file", file);
      if (options?.path?.trim()) {
        form.append("path", options.path.trim());
      }

      const result = await requestMultipartRaw(baseUrl, `/workspace/${encodeURIComponent(id)}/inbox`, {
        token,
        hostToken,
        method: "POST",
        body: form,
        timeoutMs: timeouts.binary,
      });

      if (!result.ok) {
        let message = result.text.trim();
        try {
          const json = message ? JSON.parse(message) : null;
          if (json && typeof json.message === "string") {
            message = json.message;
          }
        } catch {
          // ignore
        }
        throw new OnMyAgentServerError(
          result.status,
          "request_failed",
          message || "Shared folder upload failed",
        );
      }

      const body = result.text.trim();
      if (body) {
        try {
          const parsed = JSON.parse(body) as Partial<OnMyAgentInboxUploadResult>;
          if (typeof parsed.path === "string" && parsed.path.trim()) {
            return {
              ok: parsed.ok ?? true,
              path: parsed.path.trim(),
              bytes: typeof parsed.bytes === "number" ? parsed.bytes : file.size,
            } satisfies OnMyAgentInboxUploadResult;
          }
        } catch {
          // ignore invalid JSON and fall back
        }
      }

      return {
        ok: true,
        path: options?.path?.trim() || file.name,
        bytes: file.size,
      } satisfies OnMyAgentInboxUploadResult;
    },

    listInbox: (workspaceId: string) =>
      requestJson<OnMyAgentInboxList>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/inbox`, {
        token,
        hostToken,
      }),

    downloadInboxItem: (workspaceId: string, inboxId: string) =>
      requestBinary(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/inbox/${encodeURIComponent(inboxId)}`,
        { token, hostToken, timeoutMs: timeouts.binary },
      ),

    readWorkspaceFile: (workspaceId: string, path: string) =>
      requestJson<OnMyAgentWorkspaceFileContent>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/files/content?path=${encodeURIComponent(path)}`,
        { token, hostToken },
      ),

    statWorkspaceFile: (workspaceId: string, path: string) =>
      requestJson<OnMyAgentWorkspaceFileStat>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/files/stat?path=${encodeURIComponent(path)}`,
        { token, hostToken },
      ),

    writeWorkspaceFile: (
      workspaceId: string,
      payload: { path: string; content: string; baseUpdatedAt?: number | null; force?: boolean },
    ) =>
      requestJson<OnMyAgentWorkspaceFileWriteResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/files/content`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
        },
      ),

    writeWorkspaceBinaryFile: (
      workspaceId: string,
      payload: { path: string; data: ArrayBuffer; baseUpdatedAt?: number | null; force?: boolean },
    ) =>
      requestJson<OnMyAgentWorkspaceFileWriteResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/files/raw`,
        {
          token,
          hostToken,
          method: "POST",
          body: {
            path: payload.path,
            dataBase64: arrayBufferToBase64(payload.data),
            baseUpdatedAt: payload.baseUpdatedAt,
            force: payload.force,
          },
        },
      ),

    downloadWorkspaceFile: (workspaceId: string, path: string) =>
      requestBinary(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/files/raw?path=${encodeURIComponent(path)}`,
        { token, hostToken, timeoutMs: timeouts.binary },
      ),

    listWorkspaceFiles: async (
      workspaceId: string,
      options?: {
        includeDirs?: boolean;
        limit?: number;
        prefix?: string;
        root?: string;
        shallow?: boolean;
      },
    ) => {
      const id = workspaceId.trim();
      if (!id) throw new Error("workspaceId is required");
      const totalLimit = Math.max(
        1,
        Math.min(Math.floor(options?.limit ?? 5000), 10_000),
      );
      const sessionResult = await requestJson<{ session: { id: string } }>(
        baseUrl,
        `/workspace/${encodeURIComponent(id)}/files/sessions`,
        {
          token,
          hostToken,
          method: "POST",
          body: {
            write: false,
            ttlSeconds: 30,
            ...(options?.root?.trim() ? { root: options.root.trim() } : {}),
          },
        },
      );
      const sessionId = sessionResult.session.id.trim();
      if (!sessionId) throw new Error("file session id is required");

      const items: OnMyAgentWorkspaceFileCatalogEntry[] = [];
      let after: string | undefined;
      let total = 0;
      let generatedAt = Date.now();
      let truncated = false;

      try {
        while (items.length < totalLimit) {
          const pageLimit = Math.min(1000, totalLimit - items.length);
          const params = new URLSearchParams();
          params.set("includeDirs", options?.includeDirs === false ? "false" : "true");
          params.set("limit", String(pageLimit));
          if (options?.shallow) params.set("shallow", "true");
          if (options?.prefix?.trim()) params.set("prefix", options.prefix.trim());
          if (after) params.set("after", after);

          const snapshot = await requestJson<
            OnMyAgentWorkspaceFileCatalog & { nextAfter?: string }
          >(
            baseUrl,
            `/files/sessions/${encodeURIComponent(sessionId)}/catalog/snapshot?${params.toString()}`,
            { token, hostToken, timeoutMs: timeouts.sessionRead },
          );
          items.push(...snapshot.items);
          total = snapshot.total;
          generatedAt = snapshot.generatedAt;
          truncated = snapshot.truncated;
          after = snapshot.nextAfter;
          if (!snapshot.truncated || !after) break;
        }
      } finally {
        await requestJson<{ ok: true }>(
          baseUrl,
          `/files/sessions/${encodeURIComponent(sessionId)}`,
          { token, hostToken, method: "DELETE" },
        ).catch(() => undefined);
      }

      return {
        items,
        total,
        generatedAt,
        truncated: truncated || items.length < total,
      } satisfies OnMyAgentWorkspaceFileCatalog;
    },

    deleteWorkspaceFile: async (
      workspaceId: string,
      filePath: string,
      options?: { recursive?: boolean; root?: string },
    ) => {
      const id = workspaceId.trim();
      if (!id) throw new Error("workspaceId is required");
      const sessionResult = await requestJson<{ session: { id: string } }>(
        baseUrl,
        `/workspace/${encodeURIComponent(id)}/files/sessions`,
        {
          token,
          hostToken,
          method: "POST",
          body: {
            write: true,
            ttlSeconds: 30,
            ...(options?.root?.trim() ? { root: options.root.trim() } : {}),
          },
        },
      );
      const sessionId = sessionResult.session.id.trim();
      if (!sessionId) throw new Error("file session id is required");

      try {
        const result = await requestJson<{
          items: Array<{ ok: boolean; type: string; path: string; code?: string; message?: string }>;
        }>(
          baseUrl,
          `/files/sessions/${encodeURIComponent(sessionId)}/ops`,
          {
            token,
            hostToken,
            method: "POST",
            body: {
              operations: [
                { type: "delete", path: filePath, recursive: options?.recursive === true },
              ],
            },
          },
        );
        const item = result.items?.[0];
        if (!item?.ok) {
          throw new Error(item?.message || item?.code || "Failed to delete file");
        }
      } finally {
        await requestJson<{ ok: true }>(
          baseUrl,
          `/files/sessions/${encodeURIComponent(sessionId)}`,
          { token, hostToken, method: "DELETE" },
        ).catch(() => undefined);
      }
    },

    listArtifacts: (workspaceId: string) =>
      requestJson<OnMyAgentArtifactList>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/artifacts`, {
        token,
        hostToken,
      }),

    resolveArtifacts: (
      workspaceId: string,
      targets: Array<{
        kind: "file" | "url";
        value: string;
        name?: string;
        preview?: string;
        confidence?: number;
        reason?: string;
      }>,
    ) =>
      requestJson<{ items: OnMyAgentResolvedArtifactTarget[] }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/artifacts/resolve`,
        { token, hostToken, method: "POST", body: { targets } },
      ),

    downloadArtifact: (workspaceId: string, artifactId: string) =>
      requestBinary(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}`,
        { token, hostToken, timeoutMs: timeouts.binary },
      ),

    // User-level env vars (host-auth only — desktop shell is the sole caller).
    // See apps/server/src/env-file.ts and apps/app/pr/environment-variables.md.
  };
}
