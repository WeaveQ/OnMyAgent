import type { OnMyAgentServerClient } from "./client";

export type OnMyAgentSystemClient = Pick<OnMyAgentServerClient,
  | "baseUrl" | "token" | "health" | "runtimeVersions" | "status"
  | "capabilities" | "getConfig" | "patchConfig" | "listReloadEvents"
  | "reloadEngine" | "listAudit" | "createVoiceRealtimeSession"
>;

export type OnMyAgentWorkspaceClient = Pick<OnMyAgentServerClient,
  | "listWorkspaces" | "createLocalWorkspace" | "updateWorkspaceDisplayName"
  | "activateWorkspace" | "deleteWorkspace" | "exportWorkspace"
  | "importWorkspace" | "previewWorkspaceImport" | "materializeBlueprintSessions"
  | "readOpencodeConfigFile" | "writeOpencodeConfigFile" | "readWorkspaceFile"
  | "statWorkspaceFile" | "writeWorkspaceFile" | "writeWorkspaceBinaryFile"
  | "downloadWorkspaceFile" | "listWorkspaceFiles"
>;

export type OnMyAgentSessionClient = Pick<OnMyAgentServerClient,
  | "deleteSession" | "listSessions" | "getSession" | "getSessionMessages"
  | "getSessionSnapshot"
>;

export type OnMyAgentExtensionClient = Pick<OnMyAgentServerClient,
  | "listPlugins" | "addPlugin" | "removePlugin" | "listSkills" | "listHubSkills"
  | "installHubSkill" | "getSkill" | "upsertSkill" | "deleteSkill" | "listMcp"
  | "addMcp" | "removeMcp" | "setMcpEnabled" | "logoutMcpAuth"
  | "listCommands" | "upsertCommand" | "deleteCommand" | "listAutomations"
  | "listAutomationRuns" | "createAutomation" | "updateAutomation"
  | "runAutomation" | "deleteAutomation" | "getOpenCodeRouterHealth"
  | "getOpenCodeRouterTelegram" | "getOpenCodeRouterTelegramIdentities"
  | "getOpenCodeRouterSlackIdentities" | "sendOpenCodeRouterMessage"
  | "upsertOpenCodeRouterTelegramIdentity" | "deleteOpenCodeRouterTelegramIdentity"
  | "upsertOpenCodeRouterSlackIdentity" | "deleteOpenCodeRouterSlackIdentity"
>;

export type OnMyAgentSessionArchiveClient = Pick<OnMyAgentServerClient,
  Extract<keyof OnMyAgentServerClient, `${string}SessionArchive${string}`>
>;

export type OnMyAgentArtifactClient = Pick<OnMyAgentServerClient,
  | "uploadInbox" | "listInbox" | "downloadInboxItem" | "listArtifacts"
  | "resolveArtifacts" | "downloadArtifact"
>;

export type OnMyAgentEnvironmentClient = Pick<OnMyAgentServerClient,
  "listUserEnvKeys" | "listUserEnv" | "upsertUserEnv" | "deleteUserEnv"
>;

export type OnMyAgentServerClientDomains = {
  system: OnMyAgentSystemClient;
  workspace: OnMyAgentWorkspaceClient;
  sessions: OnMyAgentSessionClient;
  extensions: OnMyAgentExtensionClient;
  sessionArchive: OnMyAgentSessionArchiveClient;
  artifacts: OnMyAgentArtifactClient;
  environment: OnMyAgentEnvironmentClient;
};

export function splitOnMyAgentServerClient(
  client: OnMyAgentServerClient,
): OnMyAgentServerClientDomains {
  return {
    system: client,
    workspace: client,
    sessions: client,
    extensions: client,
    sessionArchive: client,
    artifacts: client,
    environment: client,
  };
}
