#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appScriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appScriptsRoot, "../../..");
const desktopMarketplaceRoot = path.join(repoRoot, "apps/desktop/resources/marketplace");
const expertOutputPath = path.join(
  repoRoot,
  "apps/app/src/react-app/domains/session/expert-marketplace/builtin-experts.manifest.json",
);
const expertAssetMapOutputPath = path.join(
  repoRoot,
  "apps/app/src/react-app/domains/session/expert-marketplace/builtin-expert-assets.ts",
);
const skillOutputPath = path.join(
  repoRoot,
  "apps/app/src/react-app/domains/session/skills-marketplace/builtin-skills.manifest.json",
);
const skillAssetMapOutputPath = path.join(
  repoRoot,
  "apps/app/src/react-app/domains/session/skills-marketplace/builtin-skill-assets.ts",
);

function readText(filePath) {
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  const raw = readText(filePath);
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? parsed : {};
}

function firstFile(directoryPath, predicate) {
  if (!existsSync(directoryPath)) return "";
  return readdirSync(directoryPath)
    .filter((name) => predicate(name))
    .sort()[0] ?? "";
}

function relativeImportPath(fromFilePath, targetFilePath) {
  const relativePath = path.relative(path.dirname(fromFilePath), targetFilePath).split(path.sep).join("/");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

function assetRecord(filePath, sourceRoot) {
  if (!filePath || !existsSync(filePath)) return null;
  return {
    filePath,
    sourcePath: path.relative(sourceRoot, filePath).split(path.sep).join("/"),
  };
}

function writeAssetMap(filePath, exportName, entries) {
  const imports = [];
  const records = [];
  entries.forEach((entry, index) => {
    if (!entry.asset) return;
    const identifier = `asset${index}`;
    imports.push(`import ${identifier} from "${relativeImportPath(filePath, entry.asset.filePath)}?url";`);
    records.push(`  ${JSON.stringify(entry.packageName)}: ${identifier},`);
  });
  writeFileSync(
    filePath,
    [
      ...imports,
      imports.length ? "" : null,
      `export const ${exportName}: Record<string, string> = {`,
      ...records,
      "};",
      "",
    ]
      .filter((line) => line !== null)
      .join("\n"),
  );
}

function firstAgentPath(packageRoot, manifest) {
  const agents = Array.isArray(manifest.agents) ? manifest.agents : [];
  const declared = String(agents[0] ?? "").replace(/^\.\//, "");
  if (declared && existsSync(path.join(packageRoot, declared))) return declared;
  const firstAgent = firstFile(path.join(packageRoot, "agents"), (name) => name.endsWith(".md"));
  return firstAgent ? `agents/${firstAgent}` : "";
}

function firstAvatarAsset(packageRoot, manifest) {
  const declared = String(manifest.avatar ?? "").replace(/^\.\//, "");
  if (declared) {
    const declaredPath = path.join(packageRoot, declared);
    if (existsSync(declaredPath)) return assetRecord(declaredPath, packageRoot);
  }
  const firstAvatar = firstFile(
    path.join(packageRoot, "avatars"),
    (name) => /\.(png|jpe?g|webp|svg)$/i.test(name),
  );
  return firstAvatar ? assetRecord(path.join(packageRoot, "avatars", firstAvatar), packageRoot) : null;
}

function firstSkillIconAsset(skillRoot, skillMarkdown) {
  const iconFromFrontmatter = skillMarkdown
    .match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
    ?.split(/\r?\n/)
    .find((line) => line.trimStart().startsWith("icon:"))
    ?.split(":")
    .slice(1)
    .join(":")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (iconFromFrontmatter && !/^https?:\/\//i.test(iconFromFrontmatter)) {
    const iconPath = path.join(skillRoot, iconFromFrontmatter.replace(/^\.\//, ""));
    if (existsSync(iconPath)) return assetRecord(iconPath, skillRoot);
  }
  const firstIcon = firstFile(
    skillRoot,
    (name) => /^_?icon\.(png|jpe?g|webp|svg)$/i.test(name),
  );
  return firstIcon ? assetRecord(path.join(skillRoot, firstIcon), skillRoot) : null;
}

function directoryNames(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function generateExperts() {
  const pluginsRoot = path.join(desktopMarketplaceRoot, "experts/plugins");
  const assetEntries = [];
  const experts = directoryNames(pluginsRoot)
    .map((packageName) => {
      const packageRoot = path.join(pluginsRoot, packageName);
      const manifest = readJson(path.join(packageRoot, ".expert-plugin/plugin.json"));
      if (Object.keys(manifest).length === 0) return null;
      const agentPath = firstAgentPath(packageRoot, manifest);
      const avatarAsset = firstAvatarAsset(packageRoot, manifest);
      assetEntries.push({ packageName, asset: avatarAsset });
      return {
        packageName,
        manifest,
        readme: readText(path.join(packageRoot, "README.md")),
        agentMarkdown: agentPath ? readText(path.join(packageRoot, agentPath)) : "",
        agentPath,
        avatarAssetPath: avatarAsset?.sourcePath ?? null,
      };
    })
    .filter(Boolean);
  writeAssetMap(expertAssetMapOutputPath, "BUILTIN_EXPERT_AVATAR_URLS", assetEntries);
  writeJson(expertOutputPath, {
    version: 1,
    sourceRoot: "apps/desktop/resources/marketplace/experts/plugins",
    experts,
  });
  return experts.length;
}

function generateSkills() {
  const skillsRoot = path.join(desktopMarketplaceRoot, "skills/skills");
  const assetEntries = [];
  const skills = directoryNames(skillsRoot)
    .map((packageName) => {
      const packageRoot = path.join(skillsRoot, packageName);
      const skillMarkdown = readText(path.join(packageRoot, "SKILL.md"));
      if (!skillMarkdown) return null;
      const iconAsset = firstSkillIconAsset(packageRoot, skillMarkdown);
      assetEntries.push({ packageName, asset: iconAsset });
      return {
        packageName,
        skillMarkdown,
        iconAssetPath: iconAsset?.sourcePath ?? null,
      };
    })
    .filter(Boolean);
  writeAssetMap(skillAssetMapOutputPath, "BUILTIN_SKILL_ICON_URLS", assetEntries);
  writeJson(skillOutputPath, {
    version: 1,
    sourceRoot: "apps/desktop/resources/marketplace/skills/skills",
    skills,
  });
  return skills.length;
}

const expertCount = generateExperts();
const skillCount = generateSkills();
console.log(`Generated marketplace manifests: ${expertCount} experts, ${skillCount} skills`);
