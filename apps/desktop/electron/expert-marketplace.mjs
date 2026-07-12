/**
 * Expert marketplace helpers — package listing, registry records, and
 * my-experts package file templates. Pure fs/path helpers with home root
 * injected from the composition root.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

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
    return path.join(getRealHomeDir(), ".onmyagent", "marketplaces", safeMarketplace);
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
    if (!Array.isArray(value)) return [];
    return value.map((item) => localizedExpertValue(item)).filter(Boolean);
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
    return "image/png";
  }

  function resolvePackageAvatarDataUrl(packagePath, avatarPath) {
    const normalizedAvatarPath = String(avatarPath ?? "").replace(/^\.\//, "");
    const candidates = [];
    if (normalizedAvatarPath) candidates.push(path.join(packagePath, normalizedAvatarPath));
    const avatarsRoot = path.join(packagePath, "avatars");
    const firstAvatar = firstFileInDirectory(
      avatarsRoot,
      (name) => /\.(png|jpe?g|webp)$/i.test(name),
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
    const fallbackName = titleFromMarkdown(readme, titleFromMarkdown(agentMarkdown, packageName));
    const displayName =
      localizedExpertValue(manifest.profession) ||
      localizedExpertValue(manifest.displayName) ||
      fallbackName ||
      frontmatterValue(agentMarkdown, "name");
    const profession =
      localizedExpertValue(manifest.displayName) ||
      frontmatterValue(agentMarkdown, "profession") ||
      displayName;
    const description =
      localizedExpertValue(manifest.displayDescription) ||
      descriptionFromMarkdown(readme) ||
      frontmatterValue(agentMarkdown, "description") ||
      displayName;
    const manifestName = typeof manifest.name === "string" ? manifest.name.trim() : "";
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
      avatarUrl: resolvePackageAvatarDataUrl(packagePath, manifest.avatar),
      expertType: manifest.expertType === "team" ? "team" : "agent",
      leadAgentName:
        typeof manifest.agentName === "string" && manifest.agentName.trim()
          ? manifest.agentName.trim()
          : manifestName || packageName,
      systemPrompt: agentMarkdown || readme,
      version: typeof manifest.version === "string" && manifest.version.trim()
        ? manifest.version.trim()
        : null,
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

  ## 工作方式

  ${description || quote || "根据用户目标提供结构化、可执行的帮助。"}
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
