/**
 * Desktop ↔ renderer IPC data contracts.
 *
 * Pure serializable shapes (no DOM / Window). Shared so Electron main and the
 * React bridge agree on wire types without depending on apps/app.
 *
 * Slice: Code Workspace open/environment/terminal/file helpers.
 * Additional desktop IPC groups can land here or in sibling modules later.
 */

export type CodeWorkspaceOpenTargetId =
  | "vscode"
  | "cursor"
  | "finder"
  | "terminal"
  | "xcode"
  | "android-studio";

export type CodeWorkspaceOpenTarget = {
  id: CodeWorkspaceOpenTargetId;
  label: string;
  available: boolean;
  command: string | null;
  path: string | null;
  reason: string | null;
};

export type CodeWorkspaceOpenTargetsResult = {
  platform: "darwin" | "linux" | "windows";
  targets: CodeWorkspaceOpenTarget[];
};

export type CodeWorkspaceOpenResult = {
  ok: boolean;
  targetId: CodeWorkspaceOpenTargetId;
  workspacePath: string;
  command: string | null;
  args: string[];
  reason: string | null;
};

export type CodeWorkspaceEnvironmentSnapshot = {
  workspacePath: string | null;
  environment: {
    count: number;
    storePath: string | null;
  };
  git: {
    available: boolean;
    branch: string | null;
    dirty: boolean;
    ahead: number;
    behind: number;
    hasRemote: boolean;
    statusLabel: string;
    additions: number;
    deletions: number;
    changedFiles: number;
    diff: string;
    branches: string[];
    upstream: string | null;
    files: Array<{
      path: string;
      additions: number;
      deletions: number;
    }>;
  };
  githubCli: {
    available: boolean;
    authenticated: boolean;
    username: string | null;
    statusLabel: string;
  };
  sources: Array<{
    label: string;
    path: string;
  }>;
};

export type CodeWorkspaceGitActionResult = {
  ok: boolean;
  reason: string | null;
  output: string;
};

export type CodeWorkspaceTerminal = {
  terminalId: string;
  cwd: string;
  title: string;
  shell: string;
  cols: number;
  rows: number;
};

export type CodeWorkspaceTerminalSnapshot = CodeWorkspaceTerminal & {
  output: string;
  revision: number;
  running: boolean;
  exitCode: number | null;
};

export type CodeWorkspaceFileEntry = {
  name: string;
  path: string;
  kind: "file" | "dir";
  size: number;
  mtimeMs: number;
};

export type CodeWorkspaceFileContent = {
  path: string;
  content: string;
  bytes: number;
  updatedAt: number;
};
