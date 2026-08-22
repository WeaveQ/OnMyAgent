/**
 * company domain IPC handlers for the Electron desktop bridge.
 * Command names stay the same; group is `company` in desktop-ipc-commands.
 */
import {
  assertCompanyActionAllowed,
  connectCompany,
  disconnectCompany,
  evaluateCompanyActionPolicy,
  fetchCompanyHealth,
  listCompanyCatalog,
  pullAndWriteCompanyConfig,
  readCompanySettings,
  toCompanySessionSnapshot,
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
      return toCompanySessionSnapshot(readCompanySettings(homeDirOf()));
    },

    companySettingsWrite: async (event, args) => {
      const patch = args[0] && typeof args[0] === "object" ? args[0] : {};
      const safePatch = Object.fromEntries(
        Object.entries(patch).filter(([key]) => key !== "memberToken"),
      );
      return toCompanySessionSnapshot(writeCompanySettings(homeDirOf(), safePatch));
    },

    companySettingsDisconnect: async () => {
      return toCompanySessionSnapshot(await disconnectCompany(homeDirOf()));
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
      const result = await connectCompany(homeDirOf(), {
        companyBaseUrl: String(input.companyBaseUrl ?? ""),
        email: String(input.email ?? ""),
        code: String(input.code ?? ""),
      });
      return {
        ...result,
        settings: toCompanySessionSnapshot(result.settings),
        login: { member: result.login.member },
      };
    },

    /** Re-pull OrgConfig when already logged in. */
    companySyncConfig: async () => {
      const homeDir = homeDirOf();
      const settings = readCompanySettings(homeDir);
      if (!settings.companyBaseUrl || !settings.memberToken) {
        throw new Error("not connected to company");
      }
      assertCompanyActionAllowed(homeDir, "company.config.sync");
      const pulled = await pullAndWriteCompanyConfig(
        homeDir,
        settings.companyBaseUrl,
        settings.memberToken,
      );
      const next = writeCompanySettings(homeDir, {
        lastSyncedVersion: pulled.version,
        lastSyncedAt: new Date().toISOString(),
      });
      return { settings: toCompanySessionSnapshot(next), pulled };
    },

    /** Catalog for 公司 tabs (skills + experts from mirror). */
    companyCatalog: async () => {
      const homeDir = homeDirOf();
      assertCompanyActionAllowed(homeDir, "company.catalog.read");
      return listCompanyCatalog(homeDir);
    },
  };
}
