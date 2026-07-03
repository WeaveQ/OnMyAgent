import {
  SKILL_MARKETPLACE_CATEGORIES,
  skillMarketplaceCategoryLabel,
} from "./categories";
import type { SkillMarketplaceEntry } from "./types";

import builtinSkillsManifest from "./builtin-skills.manifest.json";

type BuiltinSkillManifestEntry = {
  packageName: string;
  skillMarkdown: string;
  iconAssetPath?: string | null;
};

type BuiltinSkillsManifest = {
  version: number;
  skills: BuiltinSkillManifestEntry[];
};

const builtinSkillEntries = (builtinSkillsManifest as BuiltinSkillsManifest).skills;

const builtinSkillEntryByPackageName = new Map(
  builtinSkillEntries.map((entry) => [entry.packageName, entry]),
);

const skillModules = Object.fromEntries(
  builtinSkillEntries.map((entry) => [
    `./builtin-skills/skills/${entry.packageName}/SKILL.md`,
    entry.skillMarkdown,
  ]),
) as Record<string, string>;

function packageNameFromPath(path: string): string {
  return path.match(/builtin-skills\/skills\/([^/]+)\//)?.[1] ?? path;
}

function frontmatter(input: string): string {
  return input.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
}

function frontmatterValue(markdown: string, key: string): string {
  const lines = frontmatter(markdown).split(/\r?\n/);
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    if (line.slice(0, index).trim() !== key) continue;
    return line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

function frontmatterList(markdown: string, key: string): string[] {
  const fm = frontmatter(markdown);
  const inline = frontmatterValue(markdown, key);
  if (inline.startsWith("[") && inline.endsWith("]")) {
    return inline
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  const match = fm.match(new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s+[^\\n]+\\n?)+)`, "m"));
  if (!match) return inline ? [inline] : [];
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function descriptionFromMarkdown(markdown: string): string {
  return (
    markdown
      .replace(/^---\r?\n[\s\S]*?\r?\n---/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#") && !line.startsWith(">") && !line.startsWith("```")) ??
    ""
  );
}

function inferCategoryIds(entry: {
  skillName: string;
  displayName: string;
  description: string;
  tags: string[];
}): string[] {
  const haystack = [
    entry.skillName,
    entry.displayName,
    entry.description,
    ...entry.tags,
  ].join(" ").toLowerCase();
  const categoryIds = SKILL_MARKETPLACE_CATEGORIES
    .filter((category) => category.id !== "all")
    .filter((category) =>
      category.keywords.some((keyword) => haystack.includes(keyword.toLowerCase())),
    )
    .map((category) => category.id);
  return [...new Set(categoryIds)].slice(0, 3);
}

function resolveMarketplaceAssetUrl(assetPath: string | null | undefined): string | null {
  if (!assetPath) return null;
  const baseUrl = import.meta.env.BASE_URL || "/";
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}${assetPath}`;
}

export function listBuiltinMarketplaceSkills(): SkillMarketplaceEntry[] {
  return Object.entries(skillModules)
    .map(([skillPath, rawSkill]) => {
      const packageName = packageNameFromPath(skillPath);
      const skillName = frontmatterValue(rawSkill, "name") || packageName;
      const displayName =
        frontmatterValue(rawSkill, "display_name") ||
        frontmatterValue(rawSkill, "display_name_zh") ||
        frontmatterValue(rawSkill, "display_name_en") ||
        skillName;
      const description =
        frontmatterValue(rawSkill, "description_zh") ||
        frontmatterValue(rawSkill, "description") ||
        frontmatterValue(rawSkill, "description_en") ||
        descriptionFromMarkdown(rawSkill) ||
        displayName;
      const tags = frontmatterList(rawSkill, "tags").slice(0, 4);
      const categoryIds = inferCategoryIds({
        skillName,
        displayName,
        description,
        tags,
      });
      const categoryId = categoryIds[0] ?? "productivity";
      return {
        id: `${skillName}:${packageName}`,
        packageName,
        skillName,
        displayName,
        description,
        categoryId,
        categoryIds,
        categoryLabel: skillMarketplaceCategoryLabel(categoryId),
        categoryLabels: categoryIds.map(skillMarketplaceCategoryLabel),
        tags,
        iconUrl: resolveMarketplaceAssetUrl(
          builtinSkillEntryByPackageName.get(packageName)?.iconAssetPath,
        ),
        version: frontmatterValue(rawSkill, "version") || null,
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-Hans-CN"));
}

export const BUILTIN_MARKETPLACE_SKILLS = listBuiltinMarketplaceSkills();
