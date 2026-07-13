/**
 * Canonical runtime manifest for the Desktop IPC surface.
 *
 * Keep wire command names here so Electron dispatch, renderer typing, and
 * parity tests share one domain-grouped source of truth.
 */
const commandGroups = /** @type {const} */ ({
  workspace: [
    "workspaceBootstrap", "workspaceSetSelected", "workspaceSetRuntimeActive",
    "workspaceCreate", "workspaceCreateRemote", "workspaceUpdateRemote",
    "workspaceUpdateDisplayName", "workspaceForget", "workspaceAddAuthorizedRoot",
    "workspaceOpenworkRead", "workspaceOnMyAgentRead", "workspaceOpenworkWrite",
    "workspaceOnMyAgentWrite", "workspaceExportConfig", "workspaceImportConfig",
    "codeWorkspaceOpenTargets", "codeWorkspaceEnvironment", "codeWorkspaceOpen",
    "codeWorkspaceTerminalCreate", "codeWorkspaceTerminalWrite",
    "codeWorkspaceTerminalResize", "codeWorkspaceTerminalSnapshot",
    "codeWorkspaceTerminalClose", "codeWorkspaceFilesList", "codeWorkspaceFileRead",
    "codeWorkspaceGitSwitchBranch", "codeWorkspaceGitCommit", "codeWorkspaceGitPush",
  ],
  system: [
    "browserUseStatus", "userAgentRegistryRead", "userAgentRegistryWrite",
    "prepareFreshRuntime", "appBuildInfo", "getUiControlBridgeInfo",
    "getComputerUseMcpCommand", "checkComputerUsePermissions",
    "openComputerUsePermissionSetup", "openComputerUsePermissionSettings",
    "checkSystemPermissions", "openSystemPermissionSettings",
    "getDesktopBootstrapConfig", "debugDesktopBootstrapConfig",
    "setDesktopBootstrapConfig", "pickDirectory", "pickFile", "saveFile",
    "updaterEnvironment", "setWindowDecorations", "__openPath",
    "__revealItemInDir", "__fetch", "__homeDir", "__joinPath",
    "__setZoomFactor", "__setNativeTheme", "__setApplicationMenuVisible",
    "checkSoftwareEnv", "installSoftwareEnv",
  ],
  localAgents: [
    "personalLocalAgentsList", "personalLocalAgentMetadataList",
    "personalLocalAgentAcpAgentsList", "personalLocalAgentAcpAgentsRefresh",
    "personalLocalAgentAcpHealth", "personalLocalAgentAcpSend",
    "personalLocalAgentAcpCancel", "personalLocalAgentAcpResolveApproval",
    "personalLocalAgentAcpConfigOptions", "personalLocalAgentSetAcpConfigOption",
    "personalLocalAgentCreateCustomAgent", "personalLocalAgentDetectAvailableAgents",
    "personalLocalAgentUpdateCustomAgent", "personalLocalAgentDeleteCustomAgent",
    "personalLocalAgentGetAgentOverrides", "personalLocalAgentSetAgentOverrides",
    "personalLocalAgentExtensionsList", "personalLocalAgentExtensionSetEnabled",
    "personalLocalAgentAcpProcessesList", "personalLocalAgentTestConnection",
    "personalLocalAgentTestCustomAgent", "personalLocalAgentCheckProviderHealth",
    "personalLocalAgentCheckManagedAgentHealthById", "personalLocalAgentValidate",
    "personalLocalAgentStart", "browserUseAgentStart", "browserUseAgentStatus",
    "browserUseAgentHistory", "browserUseAgentCancel", "browserUseAgentApprove",
    "personalLocalAgentStatus", "personalLocalAgentRun", "personalLocalAgentCancel",
    "personalLocalAgentResolveApproval", "personalLocalAgentResetConversation",
    "personalLocalAgentConversationsList", "personalLocalAgentConversationGet",
    "personalLocalAgentConversationGetById",
    "personalLocalAgentChannelConversationsList",
    "personalLocalAgentConversationsListByProvider",
    "personalLocalAgentConversationImportFromArchive",
    "personalLocalAgentConversationCreate", "personalLocalAgentConversationStatus",
    "personalLocalAgentConversationWarmup", "personalLocalAgentProviderSessionsList",
    "personalLocalAgentProviderSessionLoad", "personalLocalAgentProviderSessionClose",
    "personalLocalAgentProviderSessionFork",
    "personalLocalAgentConversationConfirmationsList", "personalLocalAgentHostStatus",
    "personalLocalAgentConversationConfirmationConfirm",
    "personalLocalAgentNativeSessionsList", "personalLocalAgentConversationTranscript",
    "personalLocalAgentHeartbeatsList", "personalLocalAgentHeartbeatCreate",
    "personalLocalAgentHeartbeatUpdate", "personalLocalAgentHeartbeatDelete",
    "personalLocalAgentHeartbeatRunNow", "personalLocalAgentHeartbeatRuns",
    "localAgentComposerListFiles", "localAgentComposerSaveAttachment",
  ],
  messaging: [
    "weixinLoginStart", "weixinLoginPoll", "weixinSaveAccount",
    "weixinAccountStatus", "weixinStart", "weixinAutoStart", "weixinStop",
    "weixinStatus", "weixinSimulateInbound", "weixinProbeAccessibleRoot",
    "feishuSaveAccount", "feishuAccountStatus", "feishuStart", "feishuAutoStart",
    "feishuStop", "feishuStatus", "feishuSimulateInbound",
    "feishuProbeAccessibleRoot", "channelGetPendingPairingRequests",
    "channelApprovePairing", "channelDenyPairing", "channelGetAuthorizedUsers",
    "channelIsUserAuthorized", "channelRevokeUserAuthorization",
    "channelGetOrCreateSession", "channelGetSession", "channelGetSessionsByPlatform",
    "channelGetSessionsByUser", "channelCloseSession", "channelUpdateSessionMetadata",
    "channelGetEventHistory",
  ],
  agentManagement: [
    "agentManagementSnapshot", "agentManagementProviderAction",
    "agentManagementFetchModels", "agentManagementSkillAction",
    "agentManagementMcpSnapshot", "agentManagementMcpAction",
  ],
  opencode: [
    "opencodeCommandList", "opencodeCommandWrite", "opencodeCommandDelete",
    "readOpencodeConfig", "writeOpencodeConfig", "resetOpencodeCache",
    "opencodeMcpAuth",
  ],
  runtime: [
    "engineStart", "runtimeBootstrap", "runtimeStatus", "engineStop",
    "engineRestart", "engineInfo", "engineDoctor", "engineInstall",
    "orchestratorStatus", "orchestratorWorkspaceActivate",
    "orchestratorInstanceDispose", "getOpenworkUiMcpCommand",
    "getOnMyAgentUiMcpCommand", "getOpenworkUiMcpEnvironment",
    "getOnMyAgentUiMcpEnvironment", "nukeOpenworkAndOpencodeConfigAndExit",
    "nukeOnMyAgentAndOpencodeConfigAndExit", "orchestratorStartDetached",
    "sandboxDoctor", "sandboxStop", "sandboxCleanupOpenworkContainers",
    "sandboxCleanupOnMyAgentContainers", "sandboxDebugProbe",
    "onmyagentServerInfo", "onmyagentServerRestart", "resetOpenworkState",
    "resetOnMyAgentState",
  ],
  skills: [
    "importSkill", "installSkillTemplate", "listLocalSkills",
    "onmyagentSkillsRoot", "onmyagentMarketplaceRoot", "listExpertPackages",
    "listExpertRegistryRecords", "installExpertPackage",
    "installBuiltinSkillPackage", "writeMyExpertPackage", "readLocalSkill",
    "writeLocalSkill", "uninstallSkill",
  ],
});

export const desktopCommandGroups = Object.freeze(commandGroups);

export const desktopCommandNames = Object.freeze(
  Object.values(desktopCommandGroups).flat(),
);

/** @param {string} command */
export function desktopCommandDomain(command) {
  for (const [domain, commands] of Object.entries(desktopCommandGroups)) {
    if (commands.some((candidate) => candidate === command)) return domain;
  }
  return null;
}
