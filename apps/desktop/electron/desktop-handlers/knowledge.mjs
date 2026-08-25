/**
 * knowledge domain IPC handlers for the Electron desktop bridge.
 * Command names stay the same; group is `knowledge` in desktop-ipc-commands.
 */
import path from "node:path";

import { readKnowledgeConfig, writePersonalVaultPath } from "../knowledge-vault-config.mjs";
import { invalidateKnowledgeIndex } from "../knowledge-vault-index.mjs";
import { ensureKnowledgeVault } from "../ensure-knowledge-vault.mjs";
import {
  deleteKnowledgeFile,
  listKnowledgeVault,
  readKnowledgeFile,
  rebuildKnowledgeVaultIndex,
  searchKnowledgeVault,
  writeKnowledgeFile,
} from "../knowledge-vault-io.mjs";
import {
  pruneRecentEntries,
  readRecentFile,
  recordRecentAccess,
  writeRecentFile,
} from "../knowledge-recent.mjs";

export const HANDLER_COMMAND_NAMES = Object.freeze([
  "knowledgeEnsureVault",
  "knowledgeList",
  "knowledgeRead",
  "knowledgeWrite",
  "knowledgeDelete",
  "knowledgeSearch",
  "knowledgeRebuildIndex",
  "knowledgeGetConfig",
  "knowledgeSetPersonalVaultPath",
  "knowledgeRecordAccess",
  "knowledgeListRecent",
]);

function folderPart(relPath) {
  const normalized = String(relPath ?? "").replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx > 0 ? normalized.slice(0, idx) : "";
}

function recentLocation(scope, relPath, userVaultDir) {
  const folder = folderPart(relPath);
  if (folder) return folder;
  if (scope === "user") {
    const base = path.basename(String(userVaultDir ?? ""));
    return base && base !== "vault" ? base : "OnMyAgent";
  }
  return scope === "project" ? "Project" : "Expert";
}

/**
 * @param {Record<string, any>} deps
 * @returns {Record<string, (event: any, args: any[]) => any>}
 */
export function createKnowledgeDomainHandlers({
  getRealHomeDir,
  os,
} = {}) {
  const homeDirOf = () =>
    typeof getRealHomeDir === "function" ? getRealHomeDir() : os.homedir();

  return {
    knowledgeEnsureVault: async () => {
      return ensureKnowledgeVault({ homeDir: homeDirOf() });
    },

    knowledgeList: async (event, args) => {
      const payload = args[0] && typeof args[0] === "object" ? args[0] : {};
      return listKnowledgeVault({
        homeDir: homeDirOf(),
        scope: payload.scope,
        workspaceId: payload.workspaceId,
        expertId: payload.expertId,
      });
    },

    knowledgeRead: async (event, args) => {
      const payload = args[0] && typeof args[0] === "object" ? args[0] : {};
      try {
        return await readKnowledgeFile({
          homeDir: homeDirOf(),
          scope: payload.scope,
          relPath: payload.relPath,
          workspaceId: payload.workspaceId,
          expertId: payload.expertId,
        });
      } catch (error) {
        return { ok: false, reason: error?.reason ?? "read_failed" };
      }
    },

    knowledgeWrite: async (event, args) => {
      const payload = args[0] && typeof args[0] === "object" ? args[0] : {};
      try {
        return await writeKnowledgeFile({
          homeDir: homeDirOf(),
          scope: payload.scope,
          relPath: payload.relPath,
          content: payload.content,
          workspaceId: payload.workspaceId,
          expertId: payload.expertId,
        });
      } catch (error) {
        return { ok: false, reason: error?.reason ?? "write_failed" };
      }
    },

    knowledgeDelete: async (event, args) => {
      const payload = args[0] && typeof args[0] === "object" ? args[0] : {};
      try {
        return await deleteKnowledgeFile({
          homeDir: homeDirOf(),
          scope: payload.scope,
          relPath: payload.relPath,
          workspaceId: payload.workspaceId,
          expertId: payload.expertId,
        });
      } catch (error) {
        return { ok: false, reason: error?.reason ?? "delete_failed" };
      }
    },

    knowledgeRebuildIndex: async (event, args) => {
      const payload = args[0] && typeof args[0] === "object" ? args[0] : {};
      try {
        return await rebuildKnowledgeVaultIndex({
          homeDir: homeDirOf(),
          scope: payload.scope,
          workspaceId: payload.workspaceId,
          expertId: payload.expertId,
        });
      } catch (error) {
        const reason = error?.reason ?? (error instanceof Error ? error.message : "index_failed");
        console.warn("[knowledge] rebuild index failed", error);
        return { ok: false, reason, count: 0 };
      }
    },

    knowledgeSearch: async (event, args) => {
      const payload = args[0] && typeof args[0] === "object" ? args[0] : {};
      try {
        return await searchKnowledgeVault({
          homeDir: homeDirOf(),
          query: payload.query,
          scope: payload.scope,
          workspaceId: payload.workspaceId,
          expertId: payload.expertId,
          limit: payload.limit,
        });
      } catch (error) {
        return { ok: false, reason: error?.reason ?? "search_failed", hits: [] };
      }
    },

    knowledgeGetConfig: async () => {
      return { ok: true, ...readKnowledgeConfig(homeDirOf()) };
    },

    knowledgeSetPersonalVaultPath: async (event, args) => {
      const payload = args[0] && typeof args[0] === "object" ? args[0] : {};
      const homeDir = homeDirOf();
      const next =
        payload.path === null || payload.path === undefined
          ? null
          : String(payload.path);
      const result = await writePersonalVaultPath(next, homeDir);
      if (result.ok) {
        invalidateKnowledgeIndex(homeDir);
        await ensureKnowledgeVault({ homeDir });
      }
      return result;
    },

    knowledgeRecordAccess: async (event, args) => {
      const payload = args[0] && typeof args[0] === "object" ? args[0] : {};
      const scope =
        payload.scope === "project" || payload.scope === "expert" ? payload.scope : "user";
      const relPath = String(payload.relPath ?? "").trim();
      if (!relPath) return { ok: false, reason: "invalid_path" };
      const homeDir = homeDirOf();
      try {
        const userVaultDir = readKnowledgeConfig(homeDir).resolvedUserVaultDir;
        const entries = await readRecentFile(homeDir);
        const next = recordRecentAccess(entries, {
          scope,
          relPath,
          vaultLabel: recentLocation(scope, relPath, userVaultDir),
        });
        await writeRecentFile(homeDir, next);
        return { ok: true };
      } catch (error) {
        console.warn("[knowledge] record recent access failed", error);
        return { ok: false, reason: "record_failed" };
      }
    },

    knowledgeListRecent: async (event, args) => {
      const payload = args[0] && typeof args[0] === "object" ? args[0] : {};
      const limit = Number.isFinite(payload.limit) ? Math.max(0, payload.limit) : undefined;
      const homeDir = homeDirOf();
      try {
        let entries = await readRecentFile(homeDir);

        // Best-effort prune against current vault listing; never fail the list.
        try {
          const listed = await listKnowledgeVault({ homeDir: homeDirOf(), scope: "all" });
          const present = new Set();
          for (const scopeInfo of listed.scopes ?? []) {
            for (const file of scopeInfo.files ?? []) {
              present.add(`${scopeInfo.scope}:${file.relPath}`);
            }
          }
          entries = pruneRecentEntries(entries, (scope, relPath) =>
            present.has(`${scope}:${relPath}`),
          );
        } catch (error) {
          console.warn("[knowledge] recent prune skipped", error);
        }

        if (limit !== undefined) entries = entries.slice(0, limit);
        return { ok: true, entries };
      } catch (error) {
        console.warn("[knowledge] list recent failed", error);
        return { ok: false, reason: "list_failed", entries: [] };
      }
    },
  };
}
