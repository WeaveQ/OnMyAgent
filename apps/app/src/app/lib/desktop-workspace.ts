/**
 * Domain wrappers: workspace + code-workspace Desktop IPC.
 * Public API is re-exported from `./desktop`.
 *
 * Code-workspace helpers are map-backed. Workspace CRUD historically went through
 * the untyped `desktopBridge` proxy — keep those call shapes loose so renderer
 * call sites (folderPath / workspaceId object bags) keep typechecking.
 */
import {
  invokeDesktopCommand,
  invokeElectronHelper,
} from "./desktop-invoke";
import type { CodeWorkspaceOpenTargetId } from "@onmyagent/types";

export const listCodeWorkspaceOpenTargets = () =>
  invokeDesktopCommand("codeWorkspaceOpenTargets");

export const openCodeWorkspaceTarget = (input: {
  targetId: CodeWorkspaceOpenTargetId;
  workspacePath: string;
}) => invokeDesktopCommand("codeWorkspaceOpen", input);

export const getCodeWorkspaceEnvironment = (
  input: {
    workspacePath?: string | null;
    sessionId?: string | null;
  } = {},
) => invokeDesktopCommand("codeWorkspaceEnvironment", input);

export const switchCodeWorkspaceBranch = (input: {
  workspacePath: string;
  sessionId: string;
  branch: string;
}) => invokeDesktopCommand("codeWorkspaceGitSwitchBranch", input);

export const commitCodeWorkspaceChanges = (input: {
  workspacePath: string;
  sessionId: string;
  message: string;
  push: boolean;
}) => invokeDesktopCommand("codeWorkspaceGitCommit", input);

export const pushCodeWorkspaceChanges = (input: {
  workspacePath: string;
  sessionId: string;
}) => invokeDesktopCommand("codeWorkspaceGitPush", input);

export const createCodeWorkspaceTerminal = (input: {
  workspacePath?: string | null;
}) => invokeDesktopCommand("codeWorkspaceTerminalCreate", input);

export const writeCodeWorkspaceTerminal = (input: {
  terminalId: string;
  data: string;
}) => invokeDesktopCommand("codeWorkspaceTerminalWrite", input);

export const resizeCodeWorkspaceTerminal = (input: {
  terminalId: string;
  cols: number;
  rows: number;
}) => invokeDesktopCommand("codeWorkspaceTerminalResize", input);

export const getCodeWorkspaceTerminalSnapshot = (input: {
  terminalId: string;
}) => invokeDesktopCommand("codeWorkspaceTerminalSnapshot", input);

export const closeCodeWorkspaceTerminal = (input: { terminalId: string }) =>
  invokeDesktopCommand("codeWorkspaceTerminalClose", input);

export const listCodeWorkspaceFiles = (input: {
  workspacePath: string;
  relativePath?: string;
}) => invokeDesktopCommand("codeWorkspaceFilesList", input);

export const readCodeWorkspaceFile = (input: {
  workspacePath: string;
  relativePath: string;
}) => invokeDesktopCommand("codeWorkspaceFileRead", input);

/** Loose bridge-compatible wrappers (historical desktopBridge surface). */
export const workspaceBootstrap = () =>
  invokeElectronHelper("workspaceBootstrap");
export const workspaceSetSelected = (id: string) =>
  invokeElectronHelper("workspaceSetSelected", id);
export const workspaceSetRuntimeActive = (id: string) =>
  invokeElectronHelper("workspaceSetRuntimeActive", id);
export const workspaceCreate = (
  input: string | Record<string, unknown>,
) => invokeElectronHelper("workspaceCreate", input);
export const workspaceCreateRemote = (input: Record<string, unknown>) =>
  invokeElectronHelper("workspaceCreateRemote", input);
export const workspaceUpdateRemote = (input: Record<string, unknown>) =>
  invokeElectronHelper("workspaceUpdateRemote", input);
export const workspaceUpdateDisplayName = (input: {
  id?: string;
  workspaceId?: string;
  displayName: string;
}) => invokeElectronHelper("workspaceUpdateDisplayName", input);
export const workspaceForget = (id: string) =>
  invokeElectronHelper("workspaceForget", id);
export const workspaceAddAuthorizedRoot = (input: {
  workspaceId?: string;
  root: string;
}) => invokeElectronHelper("workspaceAddAuthorizedRoot", input);
export const workspaceExportConfig = (input?: {
  workspaceId?: string;
  outputPath?: string;
}) => invokeElectronHelper("workspaceExportConfig", input);
export const workspaceImportConfig = (input: { path: string }) =>
  invokeElectronHelper("workspaceImportConfig", input);

/**
 * Write workspace OnMyAgent config. Call sites pass either bridge object bags
 * (`{ workspacePath, config }`) or map-style `(config, workspaceId?)`.
 */
export const workspaceOnMyAgentWrite = (...args: unknown[]) =>
  invokeElectronHelper("workspaceOpenworkWrite", ...args);

/** Typed read wrapper; IPC channel remains Openwork* for main-process compatibility. */
export function workspaceOnMyAgentRead(input: {
  workspacePath: string;
}): Promise<Record<string, unknown>> {
  return invokeDesktopCommand(
    "workspaceOpenworkRead",
    input.workspacePath,
  ) as Promise<Record<string, unknown>>;
}
