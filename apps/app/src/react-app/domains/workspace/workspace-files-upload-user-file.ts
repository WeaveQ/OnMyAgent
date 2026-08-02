/**
 * Write a user-selected file into workspace uploads/ (product layout).
 * Prefer this over uploadInbox so Mine and conversation attachments share one root.
 */
import { buildUserUploadRelativePath } from "./workspace-files-uploads-catalog";

export type WorkspaceUserFileUploadClient = {
  writeWorkspaceBinaryFile: (
    workspaceId: string,
    payload: {
      path: string;
      data: ArrayBuffer;
      force?: boolean;
    },
  ) => Promise<unknown>;
};

export type WorkspaceUserFileUploadResult = {
  ok: true;
  path: string;
  bytes: number;
};

/**
 * Copy `file` into `uploads/` (or a path already under uploads/).
 * Returns the workspace-relative path used by Files / draft attachments.
 */
export async function uploadUserFileToWorkspace(
  client: WorkspaceUserFileUploadClient,
  workspaceId: string,
  file: File,
  options?: { path?: string },
): Promise<WorkspaceUserFileUploadResult> {
  const id = workspaceId.trim();
  if (!id) throw new Error("workspaceId is required");
  const requested = String(options?.path ?? "").trim().replace(/\\/g, "/");
  const path =
    requested.startsWith("uploads/") || requested === "uploads"
      ? requested
      : buildUserUploadRelativePath(requested || file.name);
  const data = await file.arrayBuffer();
  await client.writeWorkspaceBinaryFile(id, {
    path,
    data,
    force: true,
  });
  return { ok: true, path, bytes: file.size };
}
