// Company profile IPC contracts. Secrets stay in Electron main and are never
// part of these renderer-facing payloads.

export type CompanyProfile = "local" | "company";

export type CompanySessionSnapshot = {
  companyBaseUrl?: string;
  activeProfile?: CompanyProfile;
  connected?: boolean;
  memberId?: string;
  email?: string;
  lastSyncedVersion?: string;
  lastSyncedAt?: string;
};

export type CompanySettingsPatch = Partial<CompanySessionSnapshot>;

export type CompanyHealthResult = {
  ok?: boolean;
  orgId?: string;
  version?: string;
  companyModule?: boolean;
};

export type CompanySkillCatalogItem = {
  id: string;
  name: string;
  description?: string;
  source: "company";
  kind: "skill";
};

export type CompanyExpertCatalogItem = {
  id: string;
  name: string;
  source: "company";
  kind: "expert";
};

export type CompanyCatalogNamedItem = { id: string; name: string };

export type CompanyPolicySnapshot = {
  allowedActions?: string[];
  blockedActions?: string[];
  egress?: { mode?: string };
  [key: string]: unknown;
};

export type CompanyCatalogSnapshot = CompanySessionSnapshot & {
  skills: CompanySkillCatalogItem[];
  experts: CompanyExpertCatalogItem[];
  models: CompanyCatalogNamedItem[];
  gatewayServices: CompanyCatalogNamedItem[];
  policy: CompanyPolicySnapshot | null;
  adminConsoleUrl?: string;
};

export type CompanyConnectInput = {
  companyBaseUrl: string;
  email: string;
  code: string;
};

export type CompanyPullResult = {
  version: string;
  companyRoot: string;
  manifest: Record<string, unknown>;
  packagesWritten: number;
  gatewayServicesWritten: number;
};

export type CompanyConnectResult = {
  settings: CompanySessionSnapshot;
  login: { member: Record<string, unknown> | null };
  pulled: CompanyPullResult;
};

export type CompanySyncConfigResult = {
  settings: CompanySessionSnapshot;
  pulled: CompanyPullResult;
};

export type CompanyPolicyDecision = {
  allowed: boolean;
  reason?: string;
  source: "none" | "org";
};
