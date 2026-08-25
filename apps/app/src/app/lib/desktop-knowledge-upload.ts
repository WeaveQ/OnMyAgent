import { invokeDesktopCommand } from "./desktop";
import type { KnowledgeVaultScope } from "./desktop";

export const createKnowledgeFolder = (input: {
  scope?: KnowledgeVaultScope;
  relPath: string;
  workspaceId?: string;
  expertId?: string;
}) => invokeDesktopCommand("knowledgeCreateFolder", input);

export const uploadKnowledgeFiles = (input: {
  scope?: KnowledgeVaultScope;
  destFolder?: string;
  workspaceId?: string;
  expertId?: string;
  files: Array<{ name?: string; dataBase64?: string; sourcePath?: string }>;
}) => invokeDesktopCommand("knowledgeUploadFiles", input);

export const uploadKnowledgeFolder = (input: {
  scope?: KnowledgeVaultScope;
  destFolder?: string;
  workspaceId?: string;
  expertId?: string;
  entries: Array<{ relPath: string; dataBase64: string }>;
}) => invokeDesktopCommand("knowledgeUploadFolder", input);

export const uploadKnowledgeFolderFromDisk = (input: {
  scope?: KnowledgeVaultScope;
  sourcePath: string;
  destFolder?: string;
  workspaceId?: string;
  expertId?: string;
}) => invokeDesktopCommand("knowledgeUploadFolderFromDisk", input);
