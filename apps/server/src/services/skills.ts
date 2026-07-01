import { readdir, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import type { SkillItem } from "@onmyagent/types/server";
import { parseFrontmatter, buildFrontmatter } from "../core/frontmatter.js";
import { exists } from "../core/utils.js";
import { validateDescription, validateSkillName } from "../core/validators.js";
import { ApiError } from "../core/errors.js";
import {
  bundledSkillsDir,
  globalSkillsDir,
  legacyAgentSkillsDir,
  legacyAgentsSkillsDir,
  legacyClaudeSkillsDir,
  legacyOpencodeSkillsDir,
} from "../workspace/workspace-files.js";

type SkillScope = SkillItem["scope"];

const extractTriggerFromBody = (body: string) => {
  const lines = body.split(/\r?\n/);
  let inWhenSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^#{1,6}\s+/.test(trimmed)) {
      const heading = trimmed.replace(/^#{1,6}\s+/, "").trim();
      inWhenSection = /^when to use$/i.test(heading);
      continue;
    }

    if (!inWhenSection) continue;

    const cleaned = trimmed
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .trim();

    if (cleaned) return cleaned;
  }

  return "";
};

async function parseSkillEntry(
  skillPath: string,
  entryName: string,
  scope: SkillScope,
): Promise<SkillItem | null> {
  const content = await readFile(skillPath, "utf8");
  const { data, body } = parseFrontmatter(content);
  const name = typeof data.name === "string" ? data.name : entryName;
  const description = typeof data.description === "string" ? data.description : "";
  const trigger =
    typeof data.trigger === "string"
      ? data.trigger
      : typeof data.when === "string"
        ? data.when
        : extractTriggerFromBody(body);
  try {
    validateSkillName(name);
    validateDescription(description);
  } catch {
    return null;
  }
  if (name !== entryName) return null;
  const item: SkillItem = {
    name,
    description,
    path: skillPath,
    scope,
    trigger: trigger.trim() || undefined,
  };
  if (typeof data.display_name_zh === "string") item.displayNameZh = data.display_name_zh;
  if (typeof data.display_name_en === "string") item.displayNameEn = data.display_name_en;
  if (typeof data.description_zh === "string") item.descriptionZh = data.description_zh;
  if (typeof data.description_en === "string") item.descriptionEn = data.description_en;
  return item;
}

async function isDirectoryEntry(entry: Dirent, parent: string): Promise<boolean> {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return (await stat(join(parent, entry.name))).isDirectory();
  } catch {
    return false;
  }
}

async function listSkillsInDir(dir: string, scope: SkillScope): Promise<SkillItem[]> {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const items: SkillItem[] = [];
  for (const entry of entries) {
    if (!(await isDirectoryEntry(entry, dir))) continue;
    const skillPath = join(dir, entry.name, "SKILL.md");
    if (await exists(skillPath)) {
      // Direct skill: <dir>/<name>/SKILL.md
      const item = await parseSkillEntry(skillPath, entry.name, scope);
      if (item) items.push(item);
    } else {
      // Domain/category folder: <dir>/<domain>/<name>/SKILL.md – scan one level deeper.
      // This supports the convention where global skills are organised as
      //   skills/<domain>/<skill-name>/SKILL.md
      // in addition to the flat   skills/<skill-name>/SKILL.md  layout.
      const domainDir = join(dir, entry.name);
      let subEntries: Dirent[];
      try {
        subEntries = await readdir(domainDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const subEntry of subEntries) {
        if (!(await isDirectoryEntry(subEntry, domainDir))) continue;
        const subSkillPath = join(domainDir, subEntry.name, "SKILL.md");
        if (!(await exists(subSkillPath))) continue;
        const item = await parseSkillEntry(subSkillPath, subEntry.name, scope);
        if (item) items.push(item);
      }
    }
  }
  return items;
}

export async function listSkills(workspaceRoot: string, _includeGlobal: boolean): Promise<SkillItem[]> {
  const items: SkillItem[] = [];

  const bundledDir = bundledSkillsDir();
  if (bundledDir) {
    items.push(...(await listSkillsInDir(bundledDir, "built-in")));
  }

  const projectDir = join(workspaceRoot, ".opencode", "skills");
  items.push(...(await listSkillsInDir(projectDir, "local")));

  items.push(...(await listSkillsInDir(globalSkillsDir(), "onmyagent")));

  const localDirs: string[] = [
    legacyOpencodeSkillsDir(),
    legacyClaudeSkillsDir(),
    legacyAgentsSkillsDir(),
    legacyAgentSkillsDir(),
  ];

  for (const dir of localDirs) {
    items.push(...(await listSkillsInDir(dir, "local")));
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

export type UpsertSkillPayload = {
  name: string;
  content: string;
  description?: string;
};

export function buildSkillContent(payload: UpsertSkillPayload): { name: string; content: string } {
  const name = payload.name.trim();
  validateSkillName(name);
  if (!payload.content) {
    throw new ApiError(400, "invalid_skill_content", "Skill content is required");
  }

  let content = payload.content;
  const { data, body } = parseFrontmatter(payload.content);
  if (Object.keys(data).length > 0) {
    const frontmatterName = typeof data.name === "string" ? data.name : "";
    const frontmatterDescription = typeof data.description === "string" ? data.description : "";
    if (frontmatterName && frontmatterName !== name) {
      throw new ApiError(400, "invalid_skill_name", "Skill frontmatter name must match payload name");
    }
    validateDescription(frontmatterDescription || payload.description);
    const nextDescription = frontmatterDescription || payload.description || "";
    const frontmatter = buildFrontmatter({
      ...data,
      name,
      description: nextDescription,
    });
    content = frontmatter + body.replace(/^\n/, "");
  } else {
    validateDescription(payload.description);
    const frontmatter = buildFrontmatter({ name, description: payload.description });
    content = frontmatter + payload.content.replace(/^\n/, "");
  }

  return {
    name,
    content: content.endsWith("\n") ? content : content + "\n",
  };
}

export async function upsertSkill(
  _workspaceRoot: string,
  payload: UpsertSkillPayload,
): Promise<{ path: string; action: "added" | "updated" }> {
  const skill = buildSkillContent(payload);

  // Skills are always written to the global directory, decoupled from workspaces.
  const baseDir = join(globalSkillsDir(), skill.name);
  await mkdir(baseDir, { recursive: true });
  const skillPath = join(baseDir, "SKILL.md");
  const existed = await exists(skillPath);
  await writeFile(skillPath, skill.content, "utf8");
  return { path: skillPath, action: existed ? "updated" : "added" };
}

export async function deleteSkill(_workspaceRoot: string, name: string): Promise<{ path: string }> {
  const trimmed = name.trim();
  validateSkillName(trimmed);
  const baseDir = join(globalSkillsDir(), trimmed);
  const skillPath = join(baseDir, "SKILL.md");
  if (!(await exists(skillPath))) {
    throw new ApiError(404, "skill_not_found", `Skill not found: ${trimmed}`);
  }
  await rm(baseDir, { recursive: true, force: true });
  return { path: baseDir };
}
