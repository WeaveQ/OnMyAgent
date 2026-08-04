/**
 * OnMyAgent ↔ OnMyCompany client (M5 minimal).
 * SoT: onmycompany/docs/onmycompany/DESKTOP-CONTRACT.md
 *
 * Rules:
 * - No company HTTP without companyBaseUrl
 * - No profiles/company write until login + successful config pull
 * - Logged-out stays local-only (D1)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  normalizeOnMyAgentHome,
  resolveCompanyConfigRoot,
  resolveCompanySettingsPath,
} from "./config-profile-paths.mjs";

/**
 * @typedef {{
 *   companyBaseUrl?: string,
 *   activeProfile?: "local" | "company",
 *   memberToken?: string,
 *   memberId?: string,
 *   email?: string,
 *   lastSyncedVersion?: string,
 *   lastSyncedAt?: string,
 * }} CompanySettings
 */

/**
 * @param {string | undefined} homeDir
 * @returns {CompanySettings}
 */
export function readCompanySettings(homeDir) {
  const filePath = resolveCompanySettingsPath(homeDir);
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    return normalizeSettings(raw);
  } catch {
    return { activeProfile: "local" };
  }
}

/**
 * @param {string | undefined} homeDir
 * @param {Partial<CompanySettings>} patch
 * @returns {CompanySettings}
 */
export function writeCompanySettings(homeDir, patch) {
  const current = readCompanySettings(homeDir);
  const next = normalizeSettings({ ...current, ...patch });
  const filePath = resolveCompanySettingsPath(homeDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

/**
 * @param {string | undefined} baseUrl
 */
export function normalizeCompanyBaseUrl(baseUrl) {
  const raw = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  return raw || undefined;
}

/**
 * True only when BaseUrl is set — still does not imply session.
 * @param {CompanySettings} settings
 */
export function hasCompanyBaseUrl(settings) {
  return Boolean(normalizeCompanyBaseUrl(settings.companyBaseUrl));
}

/**
 * @param {CompanySettings} settings
 */
export function hasCompanySession(settings) {
  return Boolean(hasCompanyBaseUrl(settings) && settings.memberToken);
}

/**
 * Logged-out / no BaseUrl must never hit company HTTP.
 * @param {CompanySettings} settings
 */
export function shouldCallCompany(settings) {
  return hasCompanySession(settings);
}

/**
 * @param {string} baseUrl
 * @param {{ fetch?: typeof fetch }} [opts]
 */
export async function fetchCompanyHealth(baseUrl, opts = {}) {
  const root = normalizeCompanyBaseUrl(baseUrl);
  if (!root) throw new Error("companyBaseUrl required");
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const res = await fetchImpl(`${root}/api/company/health`);
  if (!res.ok) {
    throw new Error(`company health HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Email OTP start + verify (dev OTP supported by OnMyCompany).
 * @param {string} baseUrl
 * @param {{ email: string, code: string, fetch?: typeof fetch }} input
 */
export async function loginCompany(baseUrl, input) {
  const root = normalizeCompanyBaseUrl(baseUrl);
  if (!root) throw new Error("companyBaseUrl required");
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const email = String(input.email ?? "").trim().toLowerCase();
  const code = String(input.code ?? "").trim();
  if (!email || !code) throw new Error("email and code required");

  await fetchImpl(`${root}/api/company/auth/email/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });

  const verify = await fetchImpl(`${root}/api/company/auth/email/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  if (!verify.ok) {
    const text = await verify.text();
    throw new Error(`company login failed HTTP ${verify.status}: ${text}`);
  }
  const body = await verify.json();
  return {
    token: String(body.token ?? ""),
    member: body.member ?? null,
  };
}

/**
 * @param {string} baseUrl
 * @param {string} token
 * @param {{ fetch?: typeof fetch }} [opts]
 */
export async function fetchCompanyMe(baseUrl, token, opts = {}) {
  const root = normalizeCompanyBaseUrl(baseUrl);
  if (!root) throw new Error("companyBaseUrl required");
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const res = await fetchImpl(`${root}/api/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`company /me HTTP ${res.status}`);
  return res.json();
}

/**
 * Pull org config snapshot and write profiles/company/config (atomic-ish replace of JSON sections).
 * @param {string | undefined} homeDir
 * @param {string} baseUrl
 * @param {string} token
 * @param {{ fetch?: typeof fetch }} [opts]
 */
export async function pullAndWriteCompanyConfig(homeDir, baseUrl, token, opts = {}) {
  const root = normalizeCompanyBaseUrl(baseUrl);
  if (!root) throw new Error("companyBaseUrl required");
  if (!token) throw new Error("member token required");
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  const manifestRes = await fetchImpl(`${root}/api/org/config/manifest`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!manifestRes.ok) throw new Error(`manifest HTTP ${manifestRes.status}`);
  const manifest = await manifestRes.json();

  const configRes = await fetchImpl(`${root}/api/org/config`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!configRes.ok) throw new Error(`org config HTTP ${configRes.status}`);
  const snapshot = await configRes.json();

  const companyRoot = resolveCompanyConfigRoot(homeDir);
  mkdirSync(companyRoot, { recursive: true });
  writeFileSync(
    path.join(companyRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  const config = snapshot.config && typeof snapshot.config === "object" ? snapshot.config : {};
  for (const [section, body] of Object.entries(config)) {
    if (section === "skills" || section === "experts") {
      // Directory sections may be objects; write as JSON index for MVP mirror
      writeFileSync(
        path.join(companyRoot, `${section}.json`),
        `${JSON.stringify(body ?? {}, null, 2)}\n`,
        "utf8",
      );
      continue;
    }
    writeFileSync(
      path.join(companyRoot, `${section}.json`),
      `${JSON.stringify(body ?? {}, null, 2)}\n`,
      "utf8",
    );
  }

  // Prefer skills.enabled from org if present as nested tree
  if (snapshot.skillsEnabled) {
    mkdirSync(path.join(companyRoot, "skills"), { recursive: true });
    writeFileSync(
      path.join(companyRoot, "skills", "enabled.json"),
      `${JSON.stringify(snapshot.skillsEnabled, null, 2)}\n`,
      "utf8",
    );
  }

  return {
    version: String(manifest.version ?? snapshot.version ?? ""),
    companyRoot,
    manifest,
  };
}

/**
 * Full connect flow: settings BaseUrl + login + pull + activeProfile=company.
 * @param {string | undefined} homeDir
 * @param {{ companyBaseUrl: string, email: string, code: string, fetch?: typeof fetch }} input
 */
export async function connectCompany(homeDir, input) {
  const baseUrl = normalizeCompanyBaseUrl(input.companyBaseUrl);
  if (!baseUrl) throw new Error("companyBaseUrl required");

  await fetchCompanyHealth(baseUrl, { fetch: input.fetch });
  const login = await loginCompany(baseUrl, {
    email: input.email,
    code: input.code,
    fetch: input.fetch,
  });
  if (!login.token) throw new Error("login returned empty token");

  const pulled = await pullAndWriteCompanyConfig(homeDir, baseUrl, login.token, {
    fetch: input.fetch,
  });

  const settings = writeCompanySettings(homeDir, {
    companyBaseUrl: baseUrl,
    memberToken: login.token,
    memberId: login.member?.id,
    email: login.member?.email ?? input.email,
    activeProfile: "company",
    lastSyncedVersion: pulled.version,
    lastSyncedAt: new Date().toISOString(),
  });

  return { settings, login, pulled };
}

/**
 * Logout: clear session; keep companyBaseUrl; force activeProfile=local.
 * Does not delete profiles/company tree (DESKTOP-CONTRACT).
 * @param {string | undefined} homeDir
 * @param {{ fetch?: typeof fetch }} [opts]
 */
export async function disconnectCompany(homeDir, opts = {}) {
  const settings = readCompanySettings(homeDir);
  const baseUrl = normalizeCompanyBaseUrl(settings.companyBaseUrl);
  if (baseUrl && settings.memberToken) {
    try {
      const fetchImpl = opts.fetch ?? globalThis.fetch;
      await fetchImpl(`${baseUrl}/api/company/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${settings.memberToken}` },
      });
    } catch {
      // best-effort
    }
  }
  return writeCompanySettings(homeDir, {
    memberToken: undefined,
    memberId: undefined,
    email: undefined,
    activeProfile: "local",
    lastSyncedVersion: undefined,
    lastSyncedAt: undefined,
  });
}

/**
 * Resolve which config root is active. Never invents company tree when logged out.
 * @param {string | undefined} homeDir
 */
export function resolveActiveConfigRoot(homeDir) {
  const settings = readCompanySettings(homeDir);
  if (
    settings.activeProfile === "company" &&
    hasCompanySession(settings) &&
    existsSync(resolveCompanyConfigRoot(homeDir))
  ) {
    return {
      profile: "company",
      root: resolveCompanyConfigRoot(homeDir),
    };
  }
  return {
    profile: "local",
    root: path.join(normalizeOnMyAgentHome(homeDir), ".onmyagent", "profiles", "local", "config"),
  };
}

/**
 * S4: personal skills root under local profile (mine).
 * @param {string | undefined} homeDir
 */
export function resolvePersonalSkillsRoot(homeDir) {
  return path.join(
    normalizeOnMyAgentHome(homeDir),
    ".onmyagent",
    "profiles",
    "local",
    "config",
    "skills",
    "mine",
  );
}

/**
 * S4: whether personal skills may overlay company (policy.skills.allowPersonal !== false).
 * @param {Record<string, unknown> | undefined} policy
 */
export function allowPersonalSkills(policy) {
  const skills = policy && typeof policy === "object" ? /** @type {Record<string, unknown>} */ (policy.skills) : undefined;
  if (!skills || typeof skills !== "object") return true;
  return skills.allowPersonal !== false;
}

/**
 * Merge company enabled package ids with personal mine ids.
 * @param {string[]} companyPackageIds
 * @param {string[]} personalPackageIds
 * @param {Record<string, unknown> | undefined} policy
 */
export function mergeSkillPackageIds(companyPackageIds, personalPackageIds, policy) {
  const org = [...new Set(companyPackageIds.filter(Boolean))];
  if (!allowPersonalSkills(policy)) return { packageIds: org, personalIncluded: false };
  const personal = personalPackageIds.filter((id) => id && !org.includes(id));
  return { packageIds: [...org, ...personal], personalIncluded: true };
}

/**
 * List personal skill package folder names under mine/.
 * @param {string | undefined} homeDir
 * @param {{ readdirSync?: typeof import("node:fs").readdirSync, existsSync?: typeof import("node:fs").existsSync }} [io]
 */
export function listPersonalSkillPackages(homeDir, io = {}) {
  const readdir = io.readdirSync ?? readdirSync;
  const exists = io.existsSync ?? existsSync;
  const root = resolvePersonalSkillsRoot(homeDir);
  if (!exists(root)) return [];
  try {
    return readdir(root).filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
}

/**
 * Read company mirror catalog for UI "公司" tabs (skills + experts).
 * Empty when logged out or mirror missing — never invents packages.
 * @param {string | undefined} homeDir
 * @returns {{
 *   connected: boolean,
 *   companyBaseUrl?: string,
 *   email?: string,
 *   lastSyncedVersion?: string,
 *   skills: Array<{ id: string, name: string, source: "company", kind: "skill" }>,
 *   experts: Array<{ id: string, name: string, source: "company", kind: "expert" }>,
 * }}
 */
export function listCompanyCatalog(homeDir) {
  const settings = readCompanySettings(homeDir);
  const connected = hasCompanySession(settings);
  const base = {
    connected,
    companyBaseUrl: settings.companyBaseUrl,
    email: settings.email,
    lastSyncedVersion: settings.lastSyncedVersion,
    skills: /** @type {Array<{ id: string, name: string, source: "company", kind: "skill" }>} */ ([]),
    experts: /** @type {Array<{ id: string, name: string, source: "company", kind: "expert" }>} */ ([]),
  };
  if (!connected) return base;

  const companyRoot = resolveCompanyConfigRoot(homeDir);
  if (!existsSync(companyRoot)) return base;

  /** @param {string} fileName */
  const readJson = (fileName) => {
    try {
      return JSON.parse(readFileSync(path.join(companyRoot, fileName), "utf8"));
    } catch {
      return null;
    }
  };

  const skillIds = new Set();
  /** @param {unknown} value */
  const addSkillId = (value) => {
    if (typeof value === "string") {
      const id = value.trim();
      // Skip filesystem noise from entries[] (dirs/files, not package ids)
      if (!id || id === "installed" || id === "registry" || id === "enabled.json" || id.endsWith(".json")) {
        return;
      }
      skillIds.add(id);
      return;
    }
    if (value && typeof value === "object") {
      const pkg = /** @type {{ packageId?: unknown, id?: unknown, name?: unknown }} */ (value);
      for (const key of ["packageId", "id", "name"]) {
        if (typeof pkg[key] === "string" && pkg[key].trim()) {
          addSkillId(pkg[key]);
          return;
        }
      }
    }
  };

  const skillsSection = readJson("skills.json");
  if (skillsSection && typeof skillsSection === "object") {
    const installed = /** @type {unknown} */ (skillsSection.installed);
    if (Array.isArray(installed)) {
      for (const id of installed) addSkillId(id);
    }
    const enabled = /** @type {unknown} */ (skillsSection.enabled);
    // shapes: { enabled: string[] | object[] } OR string[]
    if (Array.isArray(enabled)) {
      for (const id of enabled) addSkillId(id);
    } else if (enabled && typeof enabled === "object") {
      const list = /** @type {{ enabled?: unknown }} */ (enabled).enabled;
      if (Array.isArray(list)) {
        for (const id of list) addSkillId(id);
      }
    }
  }
  // Also read skills/enabled.json written by pull
  try {
    const enabledPath = path.join(companyRoot, "skills", "enabled.json");
    if (existsSync(enabledPath)) {
      const body = JSON.parse(readFileSync(enabledPath, "utf8"));
      const list = body?.enabled;
      if (Array.isArray(list)) {
        for (const id of list) addSkillId(id);
      }
    }
  } catch {
    // ignore
  }
  // Disk packages under skills/installed (package dirs only)
  try {
    const installedDir = path.join(companyRoot, "skills", "installed");
    if (existsSync(installedDir)) {
      for (const name of readdirSync(installedDir)) {
        if (!name.startsWith(".") && !name.endsWith(".json")) skillIds.add(name);
      }
    }
  } catch {
    // ignore
  }

  base.skills = [...skillIds].sort().map((id) => ({
    id,
    name: id,
    source: "company",
    kind: "skill",
  }));

  const expertsSection = readJson("experts.json");
  const expertIds = new Set();
  if (expertsSection && typeof expertsSection === "object") {
    for (const key of ["installed", "mine"]) {
      const list = /** @type {unknown} */ (expertsSection[key]);
      if (Array.isArray(list)) {
        for (const id of list) {
          if (typeof id === "string" && id.trim()) expertIds.add(id.trim());
        }
      }
    }
  }
  try {
    const installedDir = path.join(companyRoot, "experts", "installed");
    if (existsSync(installedDir)) {
      for (const name of readdirSync(installedDir)) {
        if (!name.startsWith(".")) expertIds.add(name);
      }
    }
  } catch {
    // ignore
  }

  base.experts = [...expertIds].sort().map((id) => ({
    id,
    name: id,
    source: "company",
    kind: "expert",
  }));

  return base;
}

/**
 * @param {unknown} raw
 * @returns {CompanySettings}
 */
function normalizeSettings(raw) {
  const obj = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const active =
    obj.activeProfile === "company" ? "company" : "local";
  return {
    companyBaseUrl: normalizeCompanyBaseUrl(
      typeof obj.companyBaseUrl === "string" ? obj.companyBaseUrl : undefined,
    ),
    activeProfile: active,
    memberToken: typeof obj.memberToken === "string" ? obj.memberToken : undefined,
    memberId: typeof obj.memberId === "string" ? obj.memberId : undefined,
    email: typeof obj.email === "string" ? obj.email : undefined,
    lastSyncedVersion:
      typeof obj.lastSyncedVersion === "string" ? obj.lastSyncedVersion : undefined,
    lastSyncedAt: typeof obj.lastSyncedAt === "string" ? obj.lastSyncedAt : undefined,
  };
}
