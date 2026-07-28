/** Result of `checkBrowserSkillStatus` (Tencent BrowserSkill / `bsk` CLI). */
export type BrowserSkillStatusResult = {
  ok: boolean;
  installed: boolean;
  extensionConnected: boolean;
  version: string | null;
  binaryPath?: string | null;
  message: string;
  doctorSummary?: string | null;
  installCliUrl: string;
  chromeWebStoreUrl: string;
  docsUrl: string;
  /** Official one-liner for clipboard / Terminal open. */
  installCommand?: string;
};
