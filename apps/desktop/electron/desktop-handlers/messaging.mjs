/**
 * messaging domain IPC handlers for the Electron desktop bridge.
 * Factories receive services/helpers constructed in main.mjs.
 */

export const HANDLER_COMMAND_NAMES = Object.freeze([
  "weixinLoginStart",
  "weixinLoginPoll",
  "weixinSaveAccount",
  "weixinAccountStatus",
  "weixinStart",
  "weixinAutoStart",
  "weixinStop",
  "weixinStatus",
  "weixinSimulateInbound",
  "weixinProbeAccessibleRoot",
  "feishuSaveAccount",
  "feishuAccountStatus",
  "feishuStart",
  "feishuAutoStart",
  "feishuStop",
  "feishuStatus",
  "feishuSimulateInbound",
  "feishuProbeAccessibleRoot",
  "telegramSaveAccount",
  "telegramAccountStatus",
  "telegramStart",
  "telegramAutoStart",
  "telegramStop",
  "telegramStatus",
  "telegramSimulateInbound",
  "discordSaveAccount",
  "discordAccountStatus",
  "discordStart",
  "discordAutoStart",
  "discordStop",
  "discordStatus",
  "discordSimulateInbound",
  "channelTestPlugin",
  "channelGetPendingPairingRequests",
  "channelApprovePairing",
  "channelDenyPairing",
  "channelGetAuthorizedUsers",
  "channelIsUserAuthorized",
  "channelRevokeUserAuthorization",
  "channelGetOrCreateSession",
  "channelGetSession",
  "channelGetSessionsByPlatform",
  "channelGetSessionsByUser",
  "channelCloseSession",
  "channelUpdateSessionMetadata",
  "channelGetEventHistory",
]);

/**
 * @param {Record<string, any>} deps
 * @returns {Record<string, (event: any, args: any[]) => any>}
 */
export function createMessagingDomainHandlers({
  weixinService,
  feishuService,
  telegramService,
  discordService,
  channelInfrastructureApi,
  probeAccessibleRoot,
} = {}) {
  return {
  weixinLoginStart: async (event, args) => {
    return weixinService.loginStart(args[0] ?? {});
  },

  weixinLoginPoll: async (event, args) => {
    return weixinService.loginPoll(args[0] ?? {});
  },

  weixinSaveAccount: async (event, args) => {
    return weixinService.saveAccount(args[0] ?? {});
  },

  weixinAccountStatus: async (event, args) => {
    return weixinService.accountStatus(args[0] ?? {});
  },

  weixinStart: async (event, args) => {
    return weixinService.start(args[0] ?? {});
  },

  weixinAutoStart: async (event, args) => {
    return weixinService.autoStart(args[0] ?? {});
  },

  weixinStop: async (event, args) => {
    return weixinService.stop();
  },

  weixinStatus: async (event, args) => {
    return weixinService.status();
  },

  weixinSimulateInbound: async (event, args) => {
    return weixinService.simulateInbound(args[0] ?? {});
  },

  weixinProbeAccessibleRoot: async (event, args) => {
    return probeAccessibleRoot(args[0] ?? {});
  },

  feishuSaveAccount: async (event, args) => {
    return feishuService.saveAccount(args[0] ?? {});
  },

  feishuAccountStatus: async (event, args) => {
    return feishuService.accountStatus(args[0] ?? {});
  },

  feishuStart: async (event, args) => {
    return feishuService.start(args[0] ?? {});
  },

  feishuAutoStart: async (event, args) => {
    return feishuService.autoStart(args[0] ?? {});
  },

  feishuStop: async (event, args) => {
    return feishuService.stop();
  },

  feishuStatus: async (event, args) => {
    return feishuService.status();
  },

  feishuSimulateInbound: async (event, args) => {
    return feishuService.simulateInbound(args[0] ?? {});
  },

  feishuProbeAccessibleRoot: async (event, args) => {
    return probeAccessibleRoot(args[0] ?? {});
  },

  telegramSaveAccount: async (event, args) => {
    return telegramService.saveAccount(args[0] ?? {});
  },

  telegramAccountStatus: async (event, args) => {
    return telegramService.accountStatus(args[0] ?? {});
  },

  telegramStart: async (event, args) => {
    return telegramService.start(args[0] ?? {});
  },

  telegramAutoStart: async (event, args) => {
    return telegramService.autoStart(args[0] ?? {});
  },

  telegramStop: async (event, args) => {
    return telegramService.stop();
  },

  telegramStatus: async (event, args) => {
    return telegramService.status();
  },

  telegramSimulateInbound: async (event, args) => {
    return telegramService.simulateInbound(args[0] ?? {});
  },

  discordSaveAccount: async (event, args) => {
    return discordService.saveAccount(args[0] ?? {});
  },

  discordAccountStatus: async (event, args) => {
    return discordService.accountStatus(args[0] ?? {});
  },

  discordStart: async (event, args) => {
    return discordService.start(args[0] ?? {});
  },

  discordAutoStart: async (event, args) => {
    return discordService.autoStart(args[0] ?? {});
  },

  discordStop: async (event, args) => {
    return discordService.stop();
  },

  discordStatus: async (event, args) => {
    return discordService.status();
  },

  discordSimulateInbound: async (event, args) => {
      return discordService.simulateInbound(args[0] ?? {});
    // --- Channel Infrastructure API ---
  },

  channelTestPlugin: async (event, args) => {
    return channelInfrastructureApi.testChannelPlugin(args[0]?.pluginId, args[0] ?? {});
  },

  channelGetPendingPairingRequests: async (event, args) => {
    return channelInfrastructureApi.getPendingPairingRequests();
  },

  channelApprovePairing: async (event, args) => {
    return channelInfrastructureApi.approvePairing(args[0]?.code);
  },

  channelDenyPairing: async (event, args) => {
    return channelInfrastructureApi.denyPairing(args[0]?.code);
  },

  channelGetAuthorizedUsers: async (event, args) => {
    return channelInfrastructureApi.getAuthorizedUsers();
  },

  channelIsUserAuthorized: async (event, args) => {
    return channelInfrastructureApi.isUserAuthorized(args[0]?.platformType, args[0]?.platformUserId);
  },

  channelRevokeUserAuthorization: async (event, args) => {
    return channelInfrastructureApi.revokeUserAuthorization(args[0]?.platformType, args[0]?.platformUserId);
  },

  channelGetOrCreateSession: async (event, args) => {
    return channelInfrastructureApi.getOrCreateSession(args[0] ?? {});
  },

  channelGetSession: async (event, args) => {
    return channelInfrastructureApi.getSession(args[0]?.sessionId);
  },

  channelGetSessionsByPlatform: async (event, args) => {
    return channelInfrastructureApi.getSessionsByPlatform(args[0]?.platformType);
  },

  channelGetSessionsByUser: async (event, args) => {
    return channelInfrastructureApi.getSessionsByUser(args[0]?.platformType, args[0]?.platformUserId);
  },

  channelCloseSession: async (event, args) => {
    return channelInfrastructureApi.closeSession(args[0]?.sessionId);
  },

  channelUpdateSessionMetadata: async (event, args) => {
    return channelInfrastructureApi.updateSessionMetadata(args[0]?.sessionId, args[0]?.metadata);
  },

  channelGetEventHistory: async (event, args) => {
      return channelInfrastructureApi.getChannelEventHistory(args[0]?.limit ?? 100, args[0]?.filterEvent);
    // --- End Channel Infrastructure API ---
  },

  };
}
