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

async function runWorkspaceFileOp(
  ctx: OnMyAgentServerClientContext,
  workspaceId: string,
  operation:
    | { type: "delete"; path: string; recursive?: boolean }
    | { type: "mkdir"; path: string }
    | { type: "rename"; from: string; to: string },
  root?: string,
) {
  const { baseUrl, token, hostToken } = ctx;
  const id = workspaceId.trim();
  if (!id) throw new Error("workspaceId is required");

  let opBody: Record<string, unknown>;
  if (operation.type === "rename") {
    const from = String(operation.from ?? "").trim();
    const to = String(operation.to ?? "").trim();
    if (!from || !to) throw new Error("from and to paths are required");
    opBody = { type: "rename", from, to };
  } else {
    const filePath = String(operation.path ?? "").trim();
    if (!filePath) throw new Error("path is required");
    opBody = {
      type: operation.type,
      path: filePath,
      ...(operation.type === "delete"
        ? { recursive: operation.recursive === true }
        : {}),
    };
  }

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
        ...(root?.trim() ? { root: root.trim() } : {}),
      },
    },
  );
  const sessionId = sessionResult.session.id.trim();
  if (!sessionId) throw new Error("file session id is required");

  try {
    const result = await requestJson<{
      items: Array<{
        ok: boolean;
        type: string;
        path?: string;
        from?: string;
        to?: string;
        code?: string;
        message?: string;
      }>;
    }>(baseUrl, `/files/sessions/${encodeURIComponent(sessionId)}/ops`, {
      token,
      hostToken,
      method: "POST",
      body: {
        operations: [opBody],
      },
    });
    const item = result.items?.[0];
    if (!item?.ok) {
      const fallback =
        operation.type === "mkdir"
          ? "Failed to create folder"
          : operation.type === "rename"
            ? "Failed to move file"
            : "Failed to delete file";
      throw new Error(item?.message || item?.code || fallback);
    }
  } finally {
    await requestJson<{ ok: true }>(
      baseUrl,
      `/files/sessions/${encodeURIComponent(sessionId)}`,
      { token, hostToken, method: "DELETE" },
    ).catch(() => undefined);
  }
}

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
    createExpertSessionRuntimeDirectory: (
      workspaceId: string,
      payload: {
        agentName: string;
        agentId?: string;
        sessionKey?: string;
        skillNames?: string[];
      },
    ) =>
      requestJson<{
        ok: boolean;
        directory: string;
        sessionKey: string;
        agentSegment: string;
        installedSkills?: string[];
        isolationVersion?: number;
        defaultAgent?: string;
      }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/expert-session-directory`,
        { token, hostToken, method: "POST", body: payload },
      ),
    ensureExpertSessionIsolation: (
      workspaceId: string,
      payload: { directory: string; skillNames?: string[] },
    ) =>
      requestJson<{
        ok: boolean;
        directory: string;
        upgraded: boolean;
        installedSkills: string[];
        isolationVersion: number;
        defaultAgent: string;
      }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/expert-session-isolation`,
        { token, hostToken, method: "POST", body: payload },
      ),
    listExpertSessionFiles: async (workspaceId: string) => {
      const id = workspaceId.trim();
      if (!id) throw new Error("workspaceId is required");
      const result = await requestJson<{
        items: Array<{
          path: string;
          kind: "file" | "dir";
          size: number;
          mtimeMs: number;
        }>;
      }>(
        baseUrl,
        `/workspace/${encodeURIComponent(id)}/expert-session-files`,
        { token, hostToken },
      );
      return {
        items: result.items.map(
          (item): OnMyAgentWorkspaceFileCatalogEntry => ({
            path: item.path,
            kind: item.kind,
            size: item.size,
            mtimeMs: item.mtimeMs,
            revision: "",
          }),
        ),
      };
    },
    readExpertSessionFile: (workspaceId: string, path: string) =>
      requestJson<OnMyAgentWorkspaceFileContent>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/expert-session-files/content?path=${encodeURIComponent(path)}`,
        { token, hostToken },
      ),
    downloadExpertSessionFile: (workspaceId: string, path: string) =>
      requestBinary(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/expert-session-files/raw?path=${encodeURIComponent(path)}`,
        { token, hostToken, timeoutMs: timeouts.binary },
      ),
    resolveExpertSessionFile: (workspaceId: string, path: string) =>
      requestJson<{ absolutePath: string; size: number; updatedAt: number }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/expert-session-files/resolve?path=${encodeURIComponent(path)}`,
        { token, hostToken },
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
        let code = "request_failed";
        let details: unknown;
        try {
          const json = message ? JSON.parse(message) : null;
          if (json && typeof json === "object") {
            const body = json as { message?: unknown; code?: unknown; details?: unknown };
            if (typeof body.message === "string" && body.message.trim()) {
              message = body.message;
            }
            if (typeof body.code === "string" && body.code.trim()) {
              code = body.code;
            }
            if (body.details !== undefined) {
              details = body.details;
            }
          }
        } catch {
          // ignore invalid JSON error bodies
        }
        throw new OnMyAgentServerError(
          result.status,
          code,
          message || "Shared folder upload failed",
          details,
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
      await runWorkspaceFileOp(ctx, workspaceId, {
        type: "delete",
        path: filePath,
        recursive: options?.recursive === true,
      }, options?.root);
    },

    /**
     * Create a directory under the workspace via file-session mkdir op.
     * Path is workspace-relative (e.g. uploads/reports).
     */
    mkdirWorkspaceDirectory: async (
      workspaceId: string,
      dirPath: string,
      options?: { root?: string },
    ) => {
      await runWorkspaceFileOp(ctx, workspaceId, {
        type: "mkdir",
        path: dirPath,
      }, options?.root);
    },

    /**
     * Move/rename a workspace path via file-session rename op.
     * Paths are workspace-relative (from → to).
     */
    renameWorkspaceFile: async (
      workspaceId: string,
      fromPath: string,
      toPath: string,
      options?: { root?: string },
    ) => {
      await runWorkspaceFileOp(
        ctx,
        workspaceId,
        {
          type: "rename",
          from: fromPath,
          to: toPath,
        },
        options?.root,
      );
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
      options?: { sessionRoot?: string },
    ) =>
      requestJson<{ items: OnMyAgentResolvedArtifactTarget[] }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/artifacts/resolve`,
        {
          token,
          hostToken,
          method: "POST",
          body: { targets, sessionRoot: options?.sessionRoot },
        },
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
