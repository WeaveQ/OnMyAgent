import {
  expertMarketplaceCategoryLabel,
  normalizeExpertMarketplaceCategoryId,
} from "./categories";
import type {
  ExpertMarketplaceEntry,
  ExpertRegistryRecord,
  LocalizedText,
} from "./types";

import builtinExpertsManifest from "./builtin-experts.manifest.json";

type BuiltinExpertManifestEntry = {
  packageName: string;
  manifest: ExpertPackageManifest;
  readme: string;
  agentMarkdown: string;
  agentPath: string;
  avatarDataUrl?: string | null;
};

type BuiltinExpertsManifest = {
  version: number;
  experts: BuiltinExpertManifestEntry[];
};

const builtinExpertEntries = (builtinExpertsManifest as BuiltinExpertsManifest).experts;

const manifestModules = Object.fromEntries(
  builtinExpertEntries.map((entry) => [
    `./builtin-experts/plugins/${entry.packageName}/.expert-plugin/plugin.json`,
    JSON.stringify(entry.manifest),
  ]),
) as Record<string, string>;

const readmeModules = Object.fromEntries(
  builtinExpertEntries.map((entry) => [
    `./builtin-experts/plugins/${entry.packageName}/README.md`,
    entry.readme,
  ]),
) as Record<string, string>;

const agentModules = Object.fromEntries(
  builtinExpertEntries
    .filter((entry) => entry.agentPath)
    .map((entry) => [
      `./builtin-experts/plugins/${entry.packageName}/${entry.agentPath}`,
      entry.agentMarkdown,
    ]),
) as Record<string, string>;

const avatarModules = {} as Record<string, string>;

type ExpertPackageManifest = {
  name?: string;
  version?: string;
  displayName?: LocalizedText | string | null;
  profession?: LocalizedText | string | null;
  displayDescription?: LocalizedText | string | null;
  description?: LocalizedText | string | null;
  avatar?: string | null;
  categoryId?: string | null;
  categoryIds?: string[] | null;
  tags?: Array<LocalizedText | string> | LocalizedTextList | null;
  quickPrompts?: Array<LocalizedText | string> | LocalizedTextList | null;
  agents?: string[] | string | null;
  expertType?: string | null;
  agentName?: string | null;
};

type LocalizedTextList = {
  zh?: string[];
  en?: string[];
};

function packageNameFromPath(path: string): string {
  return path.match(/builtin-experts\/plugins\/([^/]+)\//)?.[1] ?? path;
}

function parseJson(input: string): ExpertPackageManifest {
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object") return parsed as ExpertPackageManifest;
  } catch {
  }
  return {};
}

function localized(input: LocalizedText | string | null | undefined): string {
  if (!input) return "";
  if (typeof input === "string") return input.trim();
  return (input.zh ?? input.en ?? "").trim();
}

function localizedList(
  input: Array<LocalizedText | string> | LocalizedTextList | null | undefined,
): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(localized).filter(Boolean);
  return (input.zh ?? input.en ?? []).map((item) => item.trim()).filter(Boolean);
}

function firstAgentPath(input: string[] | string | null | undefined): string {
  if (!input) return "";
  const agentPath = Array.isArray(input) ? input[0] : input;
  return agentPath?.replace(/^\.\//, "") ?? "";
}

function uniqueTrimmedList(input: string[] | null | undefined): string[] {
  if (!input) return [];
  return [...new Set(input.map((item) => item.trim()).filter(Boolean))];
}

function uniqueNormalizedCategoryIds(input: string[] | null | undefined): string[] {
  return [...new Set(uniqueTrimmedList(input).map(normalizeExpertMarketplaceCategoryId))]
    .filter((id) => id !== "all");
}

function titleFromReadme(readme: string, fallback: string): string {
  const heading = readme.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback;
}

function descriptionFromReadme(readme: string): string {
  const lines = readme
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith(">"));
  return lines.find((line) => !line.startsWith("```")) ?? "";
}

function frontmatterValue(markdown: string, key: string): string {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  return frontmatter.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?`, "m"))?.[1]?.trim() ?? "";
}

function looksLikeExpertAlias(value: string): boolean {
  return /^[A-Za-z]+Q$/.test(value.trim());
}

function resolveAgentMarkdown(packageName: string, manifest: ExpertPackageManifest): string {
  const declaredAgent = firstAgentPath(manifest.agents);
  if (declaredAgent) {
    const path = `./builtin-experts/plugins/${packageName}/${declaredAgent}`;
    if (agentModules[path]) return agentModules[path];
  }
  const prefix = `./builtin-experts/plugins/${packageName}/agents/`;
  const firstPath = Object.keys(agentModules)
    .filter((path) => path.startsWith(prefix))
    .sort()[0];
  return firstPath ? agentModules[firstPath] ?? "" : "";
}

function resolveAvatarUrl(packageName: string, avatarPath: string | null | undefined): string | null {
  const bundledEntry = builtinExpertEntries.find((entry) => entry.packageName === packageName);
  if (bundledEntry?.avatarDataUrl) return bundledEntry.avatarDataUrl;
  if (avatarPath) {
    const normalized = avatarPath.replace(/^\.\//, "");
    const path = `./builtin-experts/plugins/${packageName}/${normalized}`;
    if (avatarModules[path]) return avatarModules[path];
  }
  const prefix = `./builtin-experts/plugins/${packageName}/avatars/`;
  const firstPath = Object.keys(avatarModules)
    .filter((path) => path.startsWith(prefix))
    .sort()[0];
  return firstPath ? avatarModules[firstPath] ?? null : null;
}

export function listBuiltinMarketplaceExperts(): ExpertMarketplaceEntry[] {
  return Object.entries(manifestModules)
    .map(([manifestPath, rawManifest]) => {
      const packageName = packageNameFromPath(manifestPath);
      const manifest = parseJson(rawManifest);
      const readme =
        readmeModules[`./builtin-experts/plugins/${packageName}/README.md`] ?? "";
      const agentMarkdown = resolveAgentMarkdown(packageName, manifest);
      const fallbackName = titleFromReadme(
        readme,
        titleFromReadme(agentMarkdown, packageName),
      );
      const manifestDisplayName = localized(manifest.displayName);
      const manifestProfession = localized(manifest.profession);
      const shouldUseDisplayNameAsTitle =
        Boolean(manifestDisplayName) && looksLikeExpertAlias(manifestProfession);
      const displayName =
        (shouldUseDisplayNameAsTitle ? manifestDisplayName : manifestProfession) ||
        (shouldUseDisplayNameAsTitle ? manifestProfession : manifestDisplayName) ||
        fallbackName ||
        frontmatterValue(agentMarkdown, "name");
      const profession =
        (shouldUseDisplayNameAsTitle ? manifestProfession : manifestDisplayName) ||
        localized(manifest.profession) ||
        frontmatterValue(agentMarkdown, "profession") ||
        displayName;
      const description =
        localized(manifest.displayDescription) ||
        localized(manifest.description) ||
        descriptionFromReadme(readme) ||
        frontmatterValue(agentMarkdown, "description") ||
        displayName;
      const categoryIds =
        manifest.categoryIds !== undefined
          ? uniqueNormalizedCategoryIds(manifest.categoryIds)
          : uniqueNormalizedCategoryIds(manifest.categoryId ? [manifest.categoryId] : []);
      const categoryId =
        categoryIds.find((id) => id !== "01-OPC") ??
        categoryIds[0] ??
        normalizeExpertMarketplaceCategoryId(manifest.categoryId) ??
        "all";
      const leadAgentName =
        manifest.agentName?.trim() || manifest.name?.trim() || packageName;
      const expertType: "agent" | "team" =
        manifest.expertType === "team" ? "team" : "agent";
      return {
        id: `${manifest.name?.trim() || packageName}:${packageName}`,
        packageName,
        source: "builtin" as const,
        packagePath: `builtin-experts/plugins/${packageName}`,
        displayName,
        profession,
        description,
        categoryId,
        categoryIds,
        categoryLabel: expertMarketplaceCategoryLabel(categoryId),
        categoryLabels: categoryIds.map(expertMarketplaceCategoryLabel),
        tags: localizedList(manifest.tags).slice(0, 4),
        quickPrompts: localizedList(manifest.quickPrompts).slice(0, 4),
        avatarUrl: resolveAvatarUrl(packageName, manifest.avatar),
        expertType,
        leadAgentName,
        systemPrompt: agentMarkdown || readme,
        version: manifest.version?.trim() || null,
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-Hans-CN"));
}

export const BUILTIN_MARKETPLACE_EXPERTS = listBuiltinMarketplaceExperts();

export function expertRegistryRecordFromEntry(
  expert: ExpertMarketplaceEntry,
): ExpertRegistryRecord {
  return {
    id: expert.id,
    name: expert.displayName,
    source: expert.source,
    packageName: expert.packageName,
    packagePath: expert.packagePath,
  };
}

export function listBuiltinExpertRegistryRecords(): ExpertRegistryRecord[] {
  return BUILTIN_MARKETPLACE_EXPERTS.map(expertRegistryRecordFromEntry);
}

export const BUILTIN_EXPERT_REGISTRY = listBuiltinExpertRegistryRecords();

function builtinMarketplaceExpertAgentIdCandidates(
  expert: ExpertMarketplaceEntry,
): string[] {
  return Array.from(
    new Set(
      [
        expert.id,
        expert.packageName,
        expert.leadAgentName,
        `${expert.leadAgentName}:${expert.packageName}`,
      ]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

export function isBuiltinMarketplaceExpertAgentId(
  expert: ExpertMarketplaceEntry,
  agentId: string | null | undefined,
): boolean {
  const normalized = agentId?.trim();
  if (!normalized) return false;
  return builtinMarketplaceExpertAgentIdCandidates(expert).includes(normalized);
}

export function findBuiltinMarketplaceExpertById(
  id: string,
): ExpertMarketplaceEntry | null {
  const normalized = id.trim();
  return (
    BUILTIN_MARKETPLACE_EXPERTS.find((expert) => expert.id === normalized) ??
    BUILTIN_MARKETPLACE_EXPERTS.find((expert) =>
      isBuiltinMarketplaceExpertAgentId(expert, normalized),
    ) ??
    null
  );
}
