import type { DenOrgSkillCard, HubSkillRepo, ReloadReason, SkillCard } from "../../../../app/types";
import type {
  DenOrgPluginResolved,
  DenOrgSkillHub,
} from "../../../../app/lib/den";
import type {
  CloudImportedPluginFile,
  CloudImportedSkill,
  CloudImportedSkillHub,
} from "../../../../app/cloud/import-state";
import { classifySkillScope } from "../../plugins";

export const OPENCODE_SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const OPENCODE_MCP_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
export const OPENCODE_MCP_IMPORT_PATH_PREFIX = "opencode.jsonc#mcp.";

export type CloudPluginRemovalPlan = {
  removedSkillNames: string[];
  removedMcpNames: string[];
  removedManagedCount: number;
  hasRemainingFiles: boolean;
};

export type PluginListEntry = {
  name: string;
  source: "config" | "dir.project" | "dir.global";
  removable: boolean;
};

export type CloudSkillHubWritePlan = {
  installName: string;
  content: string;
  description: string;
  overwrite: boolean;
};

export type CloudSkillHubImportPlan = {
  skillWrites: CloudSkillHubWritePlan[];
  nextSkillNames: string[];
  nextSkillIds: string[];
  removedSkillNames: string[];
};

export type CloudSkillHubImportRecordInput = {
  hub: DenOrgSkillHub;
  importedAt: number | null;
  skillIds: string[];
  skillNames: string[];
};

export type CloudSkillImportRecordInput = {
  importedAt: number | null;
  installedName: string;
  skill: DenOrgSkillCard;
};

export type CloudSkillImportPlan = CloudSkillHubWritePlan & {
  action: "added" | "updated";
};

export type PluginObjectWorkspaceFilePlan = {
  path: string;
  content: string;
};

export function buildExtensionsWorkspaceContextKey(input: {
  runtimeWorkspaceId: string;
  workspaceId: string;
  workspaceRoot: string;
  workspaceType: "local" | "remote";
}) {
  return `${input.workspaceType}:${input.workspaceId}:${input.workspaceRoot}:${input.runtimeWorkspaceId}`;
}

export function buildExtensionsCloudOrgLoadKey(input: {
  orgId: string;
  workspaceContextKey: string;
}) {
  return `${input.workspaceContextKey}::${input.orgId}`;
}

export function buildExtensionsCloudOrgRefreshContext(input: {
  activeOrgId?: string | null;
  authToken?: string | null;
  workspaceContextKey: string;
}) {
  const orgId = input.activeOrgId?.trim() ?? "";
  return {
    loadKey: buildExtensionsCloudOrgLoadKey({ workspaceContextKey: input.workspaceContextKey, orgId }),
    orgId,
    token: input.authToken?.trim() ?? "",
  };
}

export function buildExtensionsHubSkillsLoadKey(input: {
  repo: HubSkillRepo | null;
  workspaceRoot: string;
}) {
  return `${input.workspaceRoot}::${input.repo ? hubRepoKey(input.repo) : "none"}`;
}

export function buildCloudSkillHubImportRecord(input: CloudSkillHubImportRecordInput): CloudImportedSkillHub {
  return {
    hubId: input.hub.id,
    importedAt: input.importedAt,
    name: input.hub.name,
    skillIds: input.skillIds,
    skillNames: input.skillNames,
  };
}

export function buildCloudSkillImportRecord(input: CloudSkillImportRecordInput): CloudImportedSkill {
  return {
    cloudSkillId: input.skill.id,
    description: input.skill.description,
    importedAt: input.importedAt,
    installedName: input.installedName,
    shared: input.skill.shared,
    title: input.skill.title,
    updatedAt: input.skill.updatedAt,
  };
}

export function shouldResetExtensionsLoadedForKey(currentKey: string, nextKey: string) {
  return currentKey !== nextKey;
}

export function shouldSkipExtensionsRefresh(input: { force?: boolean; loaded: boolean }) {
  return !input.force && input.loaded;
}

export function isStaleExtensionsLoad(input: {
  aborted: boolean;
  currentLoadKey: string;
  loadKey: string;
}) {
  return input.aborted || input.currentLoadKey !== input.loadKey;
}

export function mapSkillCard(
  entry: {
    name: string;
    path?: string;
    root?: string;
    description?: string;
    trigger?: string;
    scope?: unknown;
    readonly?: boolean;
  },
  workspaceRoot: string,
): SkillCard {
  const scope = classifySkillScope(entry, workspaceRoot);
  return {
    name: entry.name,
    description: entry.description,
    path: entry.path ?? "",
    trigger: entry.trigger,
    scope,
    readonly: entry.readonly === true || scope === "builtin",
  };
}

export function extractSkillBodyMarkdown(skillText: string): string {
  const trimmed = skillText.trim();
  if (!trimmed.startsWith("---")) return trimmed;
  const rest = trimmed.slice(3);
  const end = rest.indexOf("\n---");
  if (end === -1) return trimmed;
  return rest.slice(end + 4).replace(/^\s*\n?/, "");
}

export function slugifyOpencodeSkillName(title: string): string {
  let base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) base = "skill";
  if (base.length > 64) base = base.slice(0, 64).replace(/-+$/g, "");
  if (!OPENCODE_SKILL_NAME_RE.test(base)) base = "skill";
  return base;
}

export function uniqueSkillInstallName(base: string, taken: Set<string>, stableSuffix: string): string {
  const suffixSource = stableSuffix.replace(/[^a-z0-9]+/g, "").slice(-8) || "org";
  let candidate = base;
  if (!taken.has(candidate)) return candidate;
  for (let n = 1; n < 50; n += 1) {
    const extra = `${suffixSource}${n}`;
    const trimmedBase = base.slice(0, Math.max(1, 64 - extra.length - 1));
    candidate = `${trimmedBase}-${extra}`.replace(/^-+|-+$/g, "").slice(0, 64);
    if (OPENCODE_SKILL_NAME_RE.test(candidate) && !taken.has(candidate)) return candidate;
  }
  return `skill-${suffixSource}`.slice(0, 64);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (!value?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const text = readNonEmptyString(entry);
        return text ? [text] : [];
      })
    : [];
}

export function readStringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const text = readNonEmptyString(entry);
    if (text) output[key] = text;
  }
  return Object.keys(output).length ? output : null;
}

export function cloudPluginMcpNameFromPath(path: string): string | null {
  if (!path.startsWith(OPENCODE_MCP_IMPORT_PATH_PREFIX)) return null;
  const name = path.slice(OPENCODE_MCP_IMPORT_PATH_PREFIX.length).trim();
  return OPENCODE_MCP_NAME_RE.test(name) ? name : null;
}

export function pluginReloadReason(objectType: string): ReloadReason {
  switch (objectType) {
    case "skill":
      return "skills";
    case "agent":
      return "agents";
    case "command":
      return "commands";
    case "mcp":
      return "mcp";
    default:
      return "config";
  }
}

export function normalizeHubRepo(input?: Partial<HubSkillRepo> | null, defaultRef = "main"): HubSkillRepo | null {
  const owner = input?.owner?.trim() || "";
  const repo = input?.repo?.trim() || "";
  const ref = input?.ref?.trim() || defaultRef;
  if (!owner || !repo) return null;
  return { owner, repo, ref };
}

export function hubRepoKey(repo: HubSkillRepo) {
  return `${repo.owner}/${repo.repo}@${repo.ref}`;
}

export function normalizeHubRepoList(items: unknown[], defaultRef = "main"): HubSkillRepo[] {
  const seen = new Set<string>();
  const next: HubSkillRepo[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const normalized = normalizeHubRepo({
      owner: typeof item.owner === "string" ? item.owner : undefined,
      repo: typeof item.repo === "string" ? item.repo : undefined,
      ref: typeof item.ref === "string" ? item.ref : undefined,
    }, defaultRef);
    if (!normalized) continue;
    const key = hubRepoKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(normalized);
  }
  return next;
}

export function mergeHubRepoList(primary: HubSkillRepo, repos: HubSkillRepo[]) {
  const seen = new Set<string>();
  const deduped: HubSkillRepo[] = [];
  for (const item of [primary, ...repos]) {
    const key = hubRepoKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

export function serializeHubRepos(input: { selected: HubSkillRepo | null; repos: HubSkillRepo[] }) {
  return JSON.stringify({ selected: input.selected, repos: input.repos });
}

export function parseStoredHubRepos(raw: string | null, defaultRef = "main") {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { selected?: unknown; repos?: unknown[]; custom?: unknown[] };
  const storedRepos = Array.isArray(parsed?.repos)
    ? normalizeHubRepoList(parsed.repos, defaultRef)
    : Array.isArray(parsed?.custom)
      ? normalizeHubRepoList(parsed.custom, defaultRef)
      : [];
  const selected = isRecord(parsed?.selected)
    ? normalizeHubRepo({
      owner: typeof parsed.selected.owner === "string" ? parsed.selected.owner : undefined,
      repo: typeof parsed.selected.repo === "string" ? parsed.selected.repo : undefined,
      ref: typeof parsed.selected.ref === "string" ? parsed.selected.ref : undefined,
    }, defaultRef)
    : null;
  const selectedKey = selected ? hubRepoKey(selected) : null;
  const hasSelected = selectedKey ? storedRepos.some((item) => hubRepoKey(item) === selectedKey) : false;
  const repos = selected && !hasSelected ? [selected, ...storedRepos] : storedRepos;
  return { selected, repos };
}

export function cloudPluginRemovalPlan(files: CloudImportedPluginFile[]): CloudPluginRemovalPlan {
  const removedSkillNames = files.flatMap((file) => {
    if (file.objectType !== "skill") return [];
    const name = file.path.match(/^\.opencode\/skills\/(?:[^/]+\/)?([^/]+)\/SKILL\.md$/)?.[1];
    return name ? [name] : [];
  });
  const removedMcpNames = files.flatMap((file) => {
    const name = file.objectType === "mcp" ? cloudPluginMcpNameFromPath(file.path) : null;
    return name ? [name] : [];
  });
  const removedManagedCount = removedSkillNames.length + removedMcpNames.length;
  return {
    removedSkillNames,
    removedMcpNames,
    removedManagedCount,
    hasRemainingFiles: files.length > removedManagedCount,
  };
}

export function cloudPluginRemovedMcpNames(input: {
  existingFiles: CloudImportedPluginFile[];
  nextFiles: CloudImportedPluginFile[];
}) {
  const nextPaths = new Set(input.nextFiles.map((file) => file.path));
  return input.existingFiles.flatMap((file) => {
    const name = file.objectType === "mcp" && !nextPaths.has(file.path)
      ? cloudPluginMcpNameFromPath(file.path)
      : null;
    return name ? [name] : [];
  });
}

export function toConfigPluginListEntries(names: string[]): PluginListEntry[] {
  const next: PluginListEntry[] = [];
  const seen = new Set<string>();
  for (const rawName of names) {
    const name = rawName.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    next.push({ name, source: "config", removable: true });
  }
  return next;
}

export function toProjectPluginListEntries(
  items: Array<{ spec: string; source: string }>,
): PluginListEntry[] {
  const byName = new Map<string, PluginListEntry>();
  for (const item of items) {
    const name = item.spec.trim();
    if (!name) continue;
    const source: PluginListEntry["source"] =
      item.source === "dir.project" || item.source === "dir.global"
        ? item.source
        : "config";
    const entry: PluginListEntry = {
      name,
      source,
      removable: source === "config",
    };
    const existing = byName.get(name);
    if (!existing || (entry.removable && !existing.removable)) {
      byName.set(name, entry);
    }
  }
  return [...byName.values()];
}

export function buildCloudSkillContent(name: string, description: string, body: string) {
  const safeDescription = description.replace(/\s+/g, " ").trim();
  const normalizedBody = body.replace(/^\s*\n?/, "");
  return [
    "---",
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(safeDescription)}`,
    "---",
    "",
    normalizedBody,
  ].join("\n");
}

export function buildImportedSkillNameMap(imported?: CloudImportedSkillHub | null) {
  const mapping = new Map<string, string>();
  if (!imported) return mapping;
  imported.skillIds.forEach((skillId, index) => {
    const name = imported.skillNames[index]?.trim();
    if (skillId.trim() && name) {
      mapping.set(skillId.trim(), name);
    }
  });
  return mapping;
}

export function buildCloudSkillHubImportPlan(input: {
  hub: DenOrgSkillHub;
  imported?: CloudImportedSkillHub | null;
  existingSkillNames: string[];
}): CloudSkillHubImportPlan {
  const importedNameMap = buildImportedSkillNameMap(input.imported);
  const taken = new Set(input.existingSkillNames);
  input.imported?.skillNames.forEach((name) => {
    if (name.trim()) taken.delete(name.trim());
  });

  const nextSkillNames: string[] = [];
  const nextSkillNameSet = new Set<string>();
  const nextSkillIds: string[] = [];

  const skillWrites = input.hub.skills.map((skill) => {
    const preferredName = importedNameMap.get(skill.id)?.trim() ?? "";
    const installName =
      preferredName && !nextSkillNameSet.has(preferredName)
        ? preferredName
        : uniqueSkillInstallName(slugifyOpencodeSkillName(skill.title), taken, skill.id);
    taken.add(installName);
    nextSkillNames.push(installName);
    nextSkillNameSet.add(installName);
    nextSkillIds.push(skill.id);

    const rawDesc = (skill.description?.trim() || skill.title).trim();
    const description = rawDesc.slice(0, 1024) || skill.title.slice(0, 1024) || "Skill";
    const body = extractSkillBodyMarkdown(skill.skillText);
    const content = buildCloudSkillContent(installName, description, body);
    return { installName, content, description, overwrite: Boolean(preferredName) };
  });

  const removedSkillNames = (input.imported?.skillNames ?? []).filter((name) => !nextSkillNameSet.has(name));

  return {
    skillWrites,
    nextSkillNames,
    nextSkillIds,
    removedSkillNames,
  };
}

export function buildCloudSkillImportPlan(input: {
  skill: {
    id: string;
    title: string;
    description?: string | null;
    skillText: string;
  };
  existingImport?: { installedName?: string | null } | null;
  existingSkillNames: string[];
}): CloudSkillImportPlan {
  const installedNames = new Set(input.existingSkillNames);
  const preferredName = input.existingImport?.installedName?.trim() ?? "";
  if (preferredName) installedNames.delete(preferredName);
  const installName = preferredName || uniqueSkillInstallName(
    slugifyOpencodeSkillName(input.skill.title),
    installedNames,
    input.skill.id,
  );
  const rawDesc = (input.skill.description?.trim() || input.skill.title).trim();
  const description = rawDesc.slice(0, 1024) || input.skill.title.slice(0, 1024) || "Skill";
  const body = extractSkillBodyMarkdown(input.skill.skillText);
  const content = buildCloudSkillContent(installName, description, body);
  return {
    installName,
    content,
    description,
    overwrite: Boolean(input.existingImport),
    action: input.existingImport ? "updated" : "added",
  };
}

export function slugifyConfigObjectName(title: string, fallback: string) {
  const slug = slugifyOpencodeSkillName(title || fallback);
  return slug === "skill" && fallback ? slugifyOpencodeSkillName(fallback) : slug;
}

export function pluginNamespace(pluginName: string, pluginId: string) {
  const base = slugifyConfigObjectName(pluginName, pluginId);
  return `${base.replace(/-plugin$/, "")}-plugin`;
}

function normalizePluginSourcePath(path: string, objectType: string, namespace: string) {
  const parts = path.trim().replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === ".." || part === ".")) return "";

  const folderByType: Record<string, string> = {
    agent: "agents",
    command: "commands",
    context: "context",
    hook: "hooks",
    mcp: "mcps",
    skill: "skills",
    tool: "tools",
  };
  const folder = folderByType[objectType];
  if (!folder) return "";
  const opencodeIndex = parts.findIndex((part) => part === ".opencode");
  const searchParts = opencodeIndex >= 0 ? parts.slice(opencodeIndex + 1) : parts;
  const folderIndex = searchParts.findIndex((part) => part === folder);
  if (folderIndex < 0 || folderIndex === searchParts.length - 1) return "";
  const rest = searchParts.slice(folderIndex + 1);
  if (rest[0] === namespace) return [".opencode", folder, ...rest].join("/");
  return [".opencode", folder, namespace, ...rest].join("/");
}

export function getPluginObjectInstallPath(
  object: NonNullable<DenOrgPluginResolved["memberships"][number]["configObject"]>,
  namespace: string,
) {
  const existing = normalizePluginSourcePath(object.currentRelativePath ?? "", object.objectType, namespace);
  if (existing) {
    if (object.objectType === "skill") {
      const parts = existing.split("/").filter(Boolean);
      const lastPart = parts.at(-1) ?? "";
      const skillName = /^SKILL\.md$/i.test(lastPart)
        ? parts.at(-2) ?? slugifyConfigObjectName(object.title, object.id)
        : lastPart || slugifyConfigObjectName(object.title, object.id);
      return `.opencode/skills/${namespace}/${skillName}/SKILL.md`;
    }
    return existing;
  }
  const name = slugifyConfigObjectName(object.title, object.id);
  switch (object.objectType) {
    case "skill":
      return `.opencode/skills/${namespace}/${name}/SKILL.md`;
    case "agent":
      return `.opencode/agents/${namespace}/${name}.md`;
    case "command":
      return `.opencode/commands/${namespace}/${name}.md`;
    case "mcp":
      return `.opencode/mcps/${namespace}/${name}.json`;
    case "hook":
      return `.opencode/hooks/${namespace}/${name}.json`;
    case "tool":
      return `.opencode/tools/${namespace}/${name}.ts`;
    case "context":
      return `.opencode/context/${namespace}/${name}.md`;
    default:
      return `.opencode/plugins/${namespace}/${name}.txt`;
  }
}

export function buildPluginObjectWorkspaceFilePlan(
  object: NonNullable<DenOrgPluginResolved["memberships"][number]["configObject"]>,
  namespace: string,
  rawSourceText: string,
): PluginObjectWorkspaceFilePlan {
  const path = getPluginObjectInstallPath(object, namespace);
  if (object.objectType !== "skill") {
    return { path, content: rawSourceText };
  }

  const rawDesc = (object.description?.trim() || object.title).trim();
  const description = rawDesc.slice(0, 1024) || object.title.slice(0, 1024) || "Skill";
  const installName = path.match(/^\.opencode\/skills\/[^/]+\/([^/]+)\/SKILL\.md$/)?.[1]
    ?? slugifyConfigObjectName(object.title, object.id);
  return {
    path,
    content: buildCloudSkillContent(installName, description, extractSkillBodyMarkdown(rawSourceText)),
  };
}

function pluginMcpName(rawName: string, namespace: string, fallback: string, namespaceName: boolean) {
  const trimmed = rawName.trim();
  const base = OPENCODE_MCP_NAME_RE.test(trimmed)
    ? trimmed
    : slugifyConfigObjectName(trimmed || fallback, fallback);
  if (!namespaceName) return base;
  const namespaced = base.startsWith(`${namespace}-`) ? base : `${namespace}-${base}`;
  return OPENCODE_MCP_NAME_RE.test(namespaced)
    ? namespaced
    : slugifyConfigObjectName(namespaced, fallback);
}

function mcpCommandFromConfig(config: Record<string, unknown>) {
  if (Array.isArray(config.command)) return readStringArray(config.command);
  const command = readNonEmptyString(config.command);
  if (!command) return [];
  return [command, ...readStringArray(config.args)];
}

function normalizePluginMcpConfig(input: unknown): Record<string, unknown> | null {
  if (!isRecord(input)) return null;
  const enabled = typeof input.enabled === "boolean"
    ? input.enabled
    : typeof input.disabled === "boolean"
      ? !input.disabled
      : true;
  const url = readNonEmptyString(input.url);
  if (url) {
    const config: Record<string, unknown> = { type: "remote", url, enabled };
    const headers = readStringRecord(input.headers);
    if (headers) config.headers = headers;
    if (isRecord(input.oauth)) config.oauth = input.oauth;
    if (input.oauth === true) config.oauth = {};
    return config;
  }

  const command = mcpCommandFromConfig(input);
  if (command.length > 0) {
    const config: Record<string, unknown> = { type: "local", command, enabled };
    const environment = readStringRecord(input.environment) ?? readStringRecord(input.env);
    if (environment) config.environment = environment;
    return config;
  }

  return null;
}

export function pluginMcpConfigsFromPayload(
  object: NonNullable<DenOrgPluginResolved["memberships"][number]["configObject"]>,
  namespace: string,
) {
  const version = object.latestVersion;
  const payload = version?.normalizedPayloadJson ?? parseJsonRecord(version?.rawSourceText ?? null);
  if (!payload) return [];

  const configs = new Map<string, { name: string; config: Record<string, unknown>; path: string }>();
  const addConfig = (rawName: string, rawConfig: unknown, namespaceName: boolean) => {
    const config = normalizePluginMcpConfig(rawConfig);
    if (!config) return;
    const name = pluginMcpName(rawName, namespace, object.id, namespaceName);
    configs.set(name, {
      name,
      config,
      path: `${OPENCODE_MCP_IMPORT_PATH_PREFIX}${name}`,
    });
  };

  if (isRecord(payload.mcp)) {
    for (const [name, config] of Object.entries(payload.mcp)) addConfig(name, config, false);
  }
  if (isRecord(payload.mcpServers)) {
    for (const [name, config] of Object.entries(payload.mcpServers)) addConfig(name, config, false);
  }
  if (configs.size === 0) addConfig(object.title, payload, true);

  return [...configs.values()];
}
