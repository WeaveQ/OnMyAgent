// Canonical type definitions for the desktop bridge.
// These types are runtime-agnostic and shared by Electron and renderer.
// Domain clusters live in sibling desktop-ipc-*.ts modules; this file is the
// public barrel re-export so existing imports keep working.

export type { DesktopCommandName } from "./desktop-ipc-commands.mjs";
export type * from "./expert-team-workflow.js";

export type * from "./desktop-ipc-system.js";
export type * from "./desktop-ipc-workspace.js";
export type * from "./desktop-ipc-runtime.js"; export type * from "./desktop-ipc-company.js";

// Code Workspace IPC contracts live in @onmyagent/types (desktop-ipc).
// Re-exported here for backward-compatible app/lib imports.
export type {
  CodeWorkspaceOpenTargetId,
  CodeWorkspaceOpenTarget,
  CodeWorkspaceOpenTargetsResult,
  CodeWorkspaceOpenResult,
  CodeWorkspaceEnvironmentSnapshot,
  CodeWorkspaceGitActionResult,
  CodeWorkspaceTerminal,
  CodeWorkspaceTerminalSnapshot,
  CodeWorkspaceFileEntry,
  CodeWorkspaceFileContent,
  CodeWorkspaceBinaryFileContent,
} from "./desktop-ipc-code-workspace.js";

export type * from "./desktop-ipc-skills.js";

// Personal Local Agent IPC contracts (split module; re-exported for compatibility).
export type * from "./desktop-ipc-local-agents.js";
export type * from "./desktop-ipc-local-agent-host.js";
export type * from "./desktop-ipc-task-orchestrator.js";

export type * from "./desktop-ipc-messaging.js";
export type * from "./desktop-ipc-agent-management.js";

export type { BrowserSkillStatusResult } from "./desktop-ipc-browser-skill.js";

// Skills / expert marketplace
export type * from "./desktop-ipc-experts.js";

/** End-to-end desktop IPC command → { args; result } map. */
export type {
  DesktopCommandContract,
  DesktopCommandMap,
  DesktopCommandArgsOf,
  DesktopCommandResultOf,
  DesktopInvoke,
} from "./desktop-ipc-command-map.js";
