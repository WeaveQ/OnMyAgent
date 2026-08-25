/**
 * Domain wrappers: knowledge-vault Desktop IPC (recent-access slice).
 *
 * The core knowledge wrappers live in `./desktop`; the recent list is split
 * here to keep that barrel under the file-size gate. Public API is
 * re-exported from `./desktop`.
 */
import { invokeDesktopCommand } from "./desktop-invoke";

export type KnowledgeVaultScope = "user" | "project" | "expert";

export type KnowledgeRecentEntry = {
  key: string;
  scope: KnowledgeVaultScope;
  relPath: string;
  name: string;
  location: string;
  accessedAt: string;
};

export const recordKnowledgeRecentAccess = (input: {
  scope?: KnowledgeVaultScope;
  relPath: string;
  workspaceId?: string;
  expertId?: string;
}) => invokeDesktopCommand("knowledgeRecordAccess", input);

export const listKnowledgeRecent = (input?: { limit?: number }) =>
  invokeDesktopCommand("knowledgeListRecent", input);

export const addKnowledgeVault = (input: { name?: string; path?: string }) =>
  invokeDesktopCommand("knowledgeAddVault", input);

export const removeKnowledgeVault = (input: { path?: string }) =>
  invokeDesktopCommand("knowledgeRemoveVault", input);
