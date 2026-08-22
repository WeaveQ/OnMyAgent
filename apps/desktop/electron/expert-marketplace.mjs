/**
 * Expert marketplace helpers — package listing, registry records, and
 * my-experts package file templates. Pure fs/path helpers with home root
 * injected from the composition root.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { resolveLocalExpertsRoot } from "./config-profile-paths.mjs";

/**
 * @param {Partial<{ getRealHomeDir: () => string }>} options
 */
export function createExpertMarketplace(options = {}) {
  const getRealHomeDir = options.getRealHomeDir;
  if (typeof getRealHomeDir !== "function") {
    throw new Error("createExpertMarketplace requires getRealHomeDir");
  }

  function onmyagentMarketplaceRoot(marketplace) {
    const safeMarketplace = validateExpertMarketplaceName(marketplace);
    // Dual-read: profile experts/{installed|mine} after migrate, else marketplaces/*.
    return resolveLocalExpertsRoot(getRealHomeDir(), safeMarketplace);
  }

  function validateExpertMarketplaceName(value) {
    const normalized = String(value ?? "").trim();
    if (normalized === "experts" || normalized === "my-experts") return normalized;
    throw new Error("Invalid expert marketplace");
  }

  function validateExpertPackageName(value) {
    const normalized = String(value ?? "").trim();
    if (
      !normalized ||
      normalized.includes("/") ||
      normalized.includes("\\") ||
      normalized === "." ||
      normalized === ".."
    ) {
      throw new Error("Invalid expert package");
    }
    return normalized;
  }

  function validateBuiltinSkillPackageName(value) {
    const normalized = String(value ?? "").trim();
    if (
      !normalized ||
      !/^[A-Za-z0-9_-]+$/.test(normalized) ||
      normalized === "." ||
      normalized === ".."
    ) {
      throw new Error("Invalid built-in skill package");
    }
    return normalized;
  }

  function escapeMarkdownFrontmatterValue(value) {
    return String(value ?? "").replace(/\r?\n/g, " ").replace(/"/g, '\\"').trim();
  }

  function localizedExpertValue(value) {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "object") {
      return String(value.zh ?? value.en ?? "").trim();
    }
    return "";
  }

  function localizedExpertList(value) {
    if (Array.isArray(value)) {
      return value.map((item) => localizedExpertValue(item)).filter(Boolean);
    }
    if (value && typeof value === "object") {
      const list = Array.isArray(value.zh)
        ? value.zh
        : Array.isArray(value.en)
          ? value.en
          : [];
      return list.map((item) => String(item).trim()).filter(Boolean);
    }
    return [];
  }

  function manifestSkillNames(value) {
    const refs = Array.isArray(value) ? value : [];
    return [...new Set(refs
      .map((item) => String(item ?? "").trim().replace(/\\/g, "/").replace(/\/$/, ""))
      .map((item) => item.split("/").filter(Boolean).pop() ?? "")
      .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item)))];
  }

  /**
   * One-train migration reader for legacy agent markdown frontmatter.
   * @deprecated Package manifests are the canonical source for declared skills.
   * @param {string} markdown
   * @returns {string[]}
   */
  function legacyFrontmatterSkillNames(markdown) {
    const match = String(markdown ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return [];

    const lines = match[1].split(/\r?\n/);
    const values = [];
    let collectingBlock = false;
    let skillsIndent = 0;

    const parseInlineList = (value) => {
      const trimmed = value.trim();
      if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
      const inner = trimmed.slice(1, -1).trim();
      if (!inner) return [];
      return inner.split(",").map((item) => {
        const token = item.trim();
        if (!token) return "";
        if (
          (token.startsWith('"') && token.endsWith('"')) ||
          (token.startsWith("'") && token.endsWith("'"))
        ) {
          return token.slice(1, -1).trim();
        }
        return token;
      });
    };

    for (const line of lines) {
      const keyMatch = line.match(/^(\s*)skills\s*:\s*(.*?)\s*$/i);
      if (keyMatch) {
        collectingBlock = false;
        skillsIndent = keyMatch[1].length;
        const value = keyMatch[2].trim();
        if (!value) {
          collectingBlock = true;
          continue;
        }
        const inlineValues = parseInlineList(value);
        if (inlineValues === null) return [];
        values.push(...inlineValues);
        continue;
      }

      if (!collectingBlock) continue;
      const listMatch = line.match(/^(\s*)-\s*(.*?)\s*$/);
      if (!listMatch || listMatch[1].length <= skillsIndent) {
        collectingBlock = false;
        continue;
      }
      const token = listMatch[2].trim();
      if (
        (token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))
      ) {
        values.push(token.slice(1, -1).trim());
      } else {
        values.push(token);
      }
    }

    return manifestSkillNames(values);
  }

  /**
   * plugin.json `skills` is SoT. Missing key: copy frontmatter once onto the
   * manifest, then never dual-read markdown again.
   */
  function resolveManifestSkillNames(packagePath, manifest, agentMarkdown) {
    if (Object.prototype.hasOwnProperty.call(manifest, "skills")) {
      return manifestSkillNames(manifest.skills);
    }
    const skills = legacyFrontmatterSkillNames(agentMarkdown);
    const pluginPath = path.join(packagePath, ".expert-plugin", "plugin.json");
    try {
      writeFileSync(
        pluginPath,
        `${JSON.stringify({ ...manifest, skills: skills.map((name) => `./skills/${name}`) }, null, 2)}\n`,
        "utf8",
      );
    } catch (error) {
      console.warn("[expert-marketplace] persist manifest skills failed", error);
    }
    return skills;
  }

  function manifestIntroStyle(value) {
    return value === "short-colleague" ? "short-colleague" : "default";
  }

  function manifestApprovedAgentIds(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean))];
  }

  function agentNameFromAgentsField(value) {
    const items = Array.isArray(value) ? value : value ? [value] : [];
    return items
      .map((item) => String(item ?? "").trim().replace(/\\/g, "/").replace(/\/$/, ""))
      .map((item) => (item.split("/").pop() ?? "").replace(/\.md$/i, ""))
      .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item));
  }

  function resolveApprovedAgentIds(manifest, leadAgentName) {
    return [...new Set([
      String(leadAgentName ?? "").trim(),
      ...agentNameFromAgentsField(manifest?.agents),
      ...manifestApprovedAgentIds(manifest?.approvedAgentIds),
    ].filter(Boolean))];
  }

  function localizedExpertPromptTemplates(packagePath, value) {
    const source =
      typeof value === "string"
        ? readJsonIfExists(path.join(packagePath, value.replace(/^\.\//, "")))
        : value;
    if (!Array.isArray(source)) return [];
    return source
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return null;
        const id = typeof item.id === "string" ? item.id.trim() : "";
        const title = localizedExpertValue(item.title);
        const template = localizedExpertValue(item.template);
        if (!id || !title || !template) return null;
        return {
          id,
          title,
          description: localizedExpertValue(item.description),
          template,
          requiredSlots: localizedExpertList(item.requiredSlots),
          conditionalSlots: localizedExpertList(item.conditionalSlots),
        };
      })
      .filter(Boolean);
  }

  function expertTeamWorkflow(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (value.mode !== "lead-workflow" || !Array.isArray(value.stages)) return null;
    const stageKinds = new Set(["frame", "investigate", "produce", "verify", "deliver"]);
    const stages = value.stages
      .map((stage) => {
        if (!stage || typeof stage !== "object" || Array.isArray(stage)) return null;
        const id = typeof stage.id === "string" ? stage.id.trim() : "";
        const kind = typeof stage.kind === "string" && stageKinds.has(stage.kind)
          ? stage.kind
          : "";
        const title = localizedExpertValue(stage.title);
        if (!id || !kind || !title) return null;
        const members = Array.isArray(stage.members)
          ? stage.members
              .map((member) => {
                if (!member || typeof member !== "object" || Array.isArray(member)) return "";
                return localizedExpertValue(member.profession)
                  || localizedExpertValue(member.name)
                  || String(member.id ?? "").trim();
              })
              .filter(Boolean)
          : [];
        return {
          id,
          kind,
          title,
          description: localizedExpertValue(stage.description),
          members,
          deliverables: localizedExpertList(stage.deliverables),
          checks: localizedExpertList(stage.checks),
        };
      })
      .filter(Boolean);
    if (stages.length === 0) return null;
    return {
      mode: "lead-workflow",
      version: Number.isInteger(value.version) ? value.version : 1,
      leadAgentName: String(value.leadAgentName ?? "").trim(),
      memberCount: Number.isInteger(value.memberCount) ? value.memberCount : 0,
      stages,
    };
  }

  function readTextIfExists(filePath) {
    if (!existsSync(filePath)) return "";
    try {
      return readFileSync(filePath, "utf8");
    } catch {
      return "";
    }
  }

  function readJsonIfExists(filePath) {
    const raw = readTextIfExists(filePath);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function titleFromMarkdown(readme, fallback) {
    return readme.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
  }

  function descriptionFromMarkdown(readme) {
    return readme
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith(">"))
      .find((line) => !line.startsWith("```")) ?? "";
  }

  function frontmatterValue(markdown, key) {
    const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    return frontmatter.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?`, "m"))?.[1]?.trim() ?? "";
  }

  function firstFileInDirectory(directoryPath, predicate) {
    if (!existsSync(directoryPath)) return null;
    try {
      return readdirSync(directoryPath)
        .filter((name) => predicate(name))
        .sort()[0] ?? null;
    } catch {
      return null;
    }
  }

  function resolvePackageAgentMarkdown(packagePath, manifest) {
    const declaredAgent = Array.isArray(manifest.agents)
      ? String(manifest.agents[0] ?? "").replace(/^\.\//, "")
      : "";
    if (declaredAgent) {
      const declaredPath = path.join(packagePath, declaredAgent);
      const declaredMarkdown = readTextIfExists(declaredPath);
      if (declaredMarkdown) return declaredMarkdown;
    }
    const agentsRoot = path.join(packagePath, "agents");
    const firstAgent = firstFileInDirectory(agentsRoot, (name) => name.endsWith(".md"));
    return firstAgent ? readTextIfExists(path.join(agentsRoot, firstAgent)) : "";
  }

  function imageMimeType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
    if (extension === ".webp") return "image/webp";
    if (extension === ".svg") return "image/svg+xml";
    return "image/png";
  }

  function resolvePackageAvatarDataUrl(packagePath, avatarPath) {
    const normalizedAvatarPath = String(avatarPath ?? "").replace(/^\.\//, "");
    const candidates = [];
    if (normalizedAvatarPath) candidates.push(path.join(packagePath, normalizedAvatarPath));
    const avatarsRoot = path.join(packagePath, "avatars");
    const firstAvatar = firstFileInDirectory(
      avatarsRoot,
      (name) => /\.(png|jpe?g|webp|svg)$/i.test(name),
    );
    if (firstAvatar) candidates.push(path.join(avatarsRoot, firstAvatar));
    const avatarFile = candidates.find((candidate) => existsSync(candidate));
    if (!avatarFile) return null;
    try {
      const bytes = readFileSync(avatarFile);
      return `data:${imageMimeType(avatarFile)};base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    }
  }

  function expertPackageEntryFromDirectory(packagePath, packageName, marketplace) {
    const manifest = readJsonIfExists(path.join(packagePath, ".expert-plugin", "plugin.json"));
    const readme = readTextIfExists(path.join(packagePath, "README.md"));
    const agentMarkdown = resolvePackageAgentMarkdown(packagePath, manifest);
    const skills = resolveManifestSkillNames(packagePath, manifest, agentMarkdown);
    const fallbackName = titleFromMarkdown(readme, titleFromMarkdown(agentMarkdown, packageName));
    const displayName =
      localizedExpertValue(manifest.profession) ||
      localizedExpertValue(manifest.displayName) ||
      fallbackName ||
      frontmatterValue(agentMarkdown, "name") ||
      packageName;
    const profession =
      localizedExpertValue(manifest.displayName) ||
      frontmatterValue(agentMarkdown, "profession") ||
      displayName ||
      packageName;
    const description =
      localizedExpertValue(manifest.displayDescription) ||
      descriptionFromMarkdown(readme) ||
      frontmatterValue(agentMarkdown, "description") ||
      displayName ||
      packageName;
    const manifestName = typeof manifest.name === "string" ? manifest.name.trim() : "";
    const leadAgentName =
      typeof manifest.agentName === "string" && manifest.agentName.trim()
        ? manifest.agentName.trim()
        : manifestName || packageName;
    return {
      id: `${manifestName || packageName}:${packageName}`,
      packageName,
      source: marketplace === "my-experts" ? "mine" : "installed",
      packagePath,
      displayName,
      profession,
      description,
      categoryId: typeof manifest.categoryId === "string" && manifest.categoryId.trim()
        ? manifest.categoryId.trim()
        : "all",
      tags: localizedExpertList(manifest.tags).slice(0, 4),
      quickPrompts: localizedExpertList(manifest.quickPrompts).slice(0, 4),
      promptTemplates: localizedExpertPromptTemplates(
        packagePath,
        manifest.promptTemplates,
      ).slice(0, 4),
      avatarUrl: resolvePackageAvatarDataUrl(packagePath, manifest.avatar),
      expertType: manifest.expertType === "team" ? "team" : "agent",
      leadAgentName,
      systemPrompt: agentMarkdown || readme,
      version: typeof manifest.version === "string" && manifest.version.trim()
        ? manifest.version.trim()
        : null,
      teamWorkflow: expertTeamWorkflow(manifest.teamWorkflow),
      skills,
      introStyle: manifestIntroStyle(manifest.introStyle),
      approvedAgentIds: resolveApprovedAgentIds(manifest, leadAgentName),
    };
  }

  function listExpertPackages(marketplace) {
    const safeMarketplace = validateExpertMarketplaceName(marketplace);
    const root = onmyagentMarketplaceRoot(safeMarketplace);
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isDirectory() || entry.name.startsWith(".")) return false;
        return existsSync(path.join(root, entry.name, ".expert-plugin", "plugin.json"));
      })
      .map((entry) => {
        const packageName = validateExpertPackageName(entry.name);
        return expertPackageEntryFromDirectory(
          path.join(root, packageName),
          packageName,
          safeMarketplace,
        );
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-Hans-CN"));
  }

  function expertRegistryRecordFromPackageEntry(entry) {
    return {
      id: entry.id,
      name: entry.displayName,
      source: entry.source,
      packageName: entry.packageName,
      packagePath: entry.packagePath,
    };
  }

  function listExpertRegistryRecords(marketplace) {
    return listExpertPackages(marketplace).map(expertRegistryRecordFromPackageEntry);
  }

  function myExpertPackageFiles(input, packageName) {
    const name = String(input.name ?? packageName).trim() || packageName;
    const description = String(input.description ?? "").trim();
    const quote = String(input.quote ?? description).trim();
    const rolePrompt = String(input.rolePrompt ?? "").trim();
    const memory = String(input.memory ?? "").trim();
    const skillNames = manifestSkillNames(input.skills);
    const skills = skillNames.map((skillName) => `./skills/${skillName}`);
    const introStyle = manifestIntroStyle(input.introStyle);
    const approvedAgentIds = manifestApprovedAgentIds(input.approvedAgentIds);
    const now = new Date().toISOString();
    const plugin = {
      name: packageName,
      version: "1.0.0",
      description,
      author: { name: "OnMyAgent", email: "" },
      agents: [`./agents/${packageName}.md`],
      expertType: "agent",
      agentName: packageName,
      displayName: { zh: name, en: name },
      profession: { zh: name, en: name },
      displayDescription: { zh: description || quote, en: description || quote },
      categoryId: "product-operations",
      categoryIds: ["product-operations"],
      tags: [],
      quickPrompts: [],
      promptTemplates: [],
      skills,
      introStyle,
      ...(approvedAgentIds.length > 0 ? { approvedAgentIds } : {}),
      agentConfig: {
        rolePrompt,
        memory,
        skillIds: skillNames,
      },
      createdAt: now,
    };
    const agentMarkdown = `---
  name: ${packageName}
  description: "${escapeMarkdownFrontmatterValue(description || quote)}"
  displayName:
    zh: "${escapeMarkdownFrontmatterValue(name)}"
    en: "${escapeMarkdownFrontmatterValue(name)}"
  profession:
    zh: "${escapeMarkdownFrontmatterValue(name)}"
    en: "${escapeMarkdownFrontmatterValue(name)}"
  maxTurns: 50
  ---

  # ${name}

  ${quote || description || "我是一个专业的智能体助手。"}

  ## 角色提示词

  ${rolePrompt || description || quote || "根据用户目标提供结构化、可执行的帮助。"}

  ${memory ? `## 专家记忆

  ${memory}

  ` : ""}${skillNames.length > 0 ? `## 已配置技能

  仅在需要时优先使用以下已安装技能：${skillNames.map((skillId) => `\`${skillId}\``).join("、")}。
  ` : ""}
  `;
    const readme = `# ${name}

  ${description || quote || "由 OnMyAgent 创建的自定义专家。"}

  ## 类型

  Agent 型（单个专家）

  ## 存储

  该专家创建于 OnMyAgent，并保存在 \`~/.onmyagent/marketplaces/my-experts/${packageName}\`。
  `;
    return { plugin, agentMarkdown, readme };
  }

  return {
    onmyagentMarketplaceRoot,
    validateExpertMarketplaceName,
    validateExpertPackageName,
    validateBuiltinSkillPackageName,
    listExpertPackages,
    listExpertRegistryRecords,
    myExpertPackageFiles,
    expertPackageEntryFromDirectory,
  };
}
