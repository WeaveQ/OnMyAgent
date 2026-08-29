export type LocalAgentComposerFileEntry = {
  path: string;
  relativePath: string;
  name: string;
  isDirectory: boolean;
};

export type LocalAgentComposerListFilesInput = {
  workspaceRoot: string;
  query?: string;
  limit?: number;
};

export type LocalAgentComposerListFilesResult = {
  files: LocalAgentComposerFileEntry[];
};

export const LOCAL_AGENT_COMPOSER_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export type LocalAgentComposerSaveAttachmentInput = {
  workspaceRoot: string;
  name: string;
  dataUrl: string;
  size?: number;
};

export type LocalAgentComposerSaveAttachmentResult = {
  path: string;
  relativePath: string;
  name: string;
  size: number;
};
