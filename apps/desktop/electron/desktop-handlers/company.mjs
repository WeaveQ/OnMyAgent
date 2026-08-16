/**
 * company domain IPC handlers for the Electron desktop bridge.
 * Command names stay the same; group is `company` in desktop-ipc-commands.
 */
import {
  connectCompany,
  disconnectCompany,
  evaluateCompanyActionPolicy,
  fetchCompanyHealth,
  listCompanyCatalog,
  pullAndWriteCompanyConfig,
  readCompanySettings,
  writeCompanySettings,
} from "../company-client.mjs";

export const HANDLER_COMMAND_NAMES = Object.freeze([
  "companySettingsRead",
  "companySettingsWrite",
  "companySettingsDisconnect",
  "companyConnect",
  "companySyncConfig",
  "companyCatalog",
  "companyHealth",
  "companyEvaluateAction",
]);

/**
 * @param {Record<string, any>} deps
 * @returns {Record<string, (event: any, args: any[]) => any>}
 */
export function createCompanyDomainHandlers({
  getRealHomeDir,
  os,
} = {}) {
  const homeDirOf = () =>
    typeof getRealHomeDir === "function" ? getRealHomeDir() : os.homedir();

  return {
    /**
     * Durable company session store (SoT: company-client company-settings.json).
     * Renderer Company settings must use these instead of localStorage-only.
     */
    companySettingsRead: async () => {
      return readCompanySettings(homeDirOf());
    },

    companySettingsWrite: async (event, args) => {
      const patch = args[0] && typeof args[0] === "object" ? args[0] : {};
      return writeCompanySettings(homeDirOf(), patch);
    },

    companySettingsDisconnect: async () => {
      return disconnectCompany(homeDirOf());
    },

    /**
     * Probe company health from main process (renderer must not fetch OMC — CORS).
     * args[0] = companyBaseUrl string
     */
    companyHealth: async (event, args) => {
      const baseUrl = String(args[0] ?? "").trim();
      return fetchCompanyHealth(baseUrl);
    },

    /** Policy check for org-gated actions (args[0] = actionId). */
    companyEvaluateAction: async (event, args) => {
      return evaluateCompanyActionPolicy(homeDirOf(), String(args[0] ?? ""));
    },

    /**
     * Full connect: health + email OTP + pull OrgConfig mirror + session.
     * args[0] = { companyBaseUrl, email, code }
     */
    companyConnect: async (event, args) => {
      const input = args[0] && typeof args[0] === "object" ? args[0] : {};
      return connectCompany(homeDirOf(), {
        companyBaseUrl: String(input.companyBaseUrl ?? ""),
        email: String(input.email ?? ""),
        code: String(input.code ?? ""),
      });
    },

    /** Re-pull OrgConfig when already logged in. */
    companySyncConfig: async () => {
      const homeDir = homeDirOf();
      const settings = readCompanySettings(homeDir);
      if (!settings.companyBaseUrl || !settings.memberToken) {
        throw new Error("not connected to company");
      }
      const pulled = await pullAndWriteCompanyConfig(
        homeDir,
        settings.companyBaseUrl,
        settings.memberToken,
      );
      const next = writeCompanySettings(homeDir, {
        lastSyncedVersion: pulled.version,
        lastSyncedAt: new Date().toISOString(),
      });
      return { settings: next, pulled };
    },

    /** Catalog for 公司 tabs (skills + experts from mirror). */
    companyCatalog: async () => {
      return listCompanyCatalog(homeDirOf());
    },
  };
}
