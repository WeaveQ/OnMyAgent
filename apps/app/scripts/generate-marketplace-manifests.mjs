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
const skillOutputPath = path.join(
  repoRoot,
  "apps/app/src/react-app/domains/session/skills-marketplace/builtin-skills.manifest.json",
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

function imageMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

function imageDataUrl(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  const bytes = readFileSync(filePath);
  return `data:${imageMimeType(filePath)};base64,${bytes.toString("base64")}`;
}

function firstAgentPath(packageRoot, manifest) {
  const agents = Array.isArray(manifest.agents) ? manifest.agents : [];
  const declared = String(agents[0] ?? "").replace(/^\.\//, "");
  if (declared && existsSync(path.join(packageRoot, declared))) return declared;
  const firstAgent = firstFile(path.join(packageRoot, "agents"), (name) => name.endsWith(".md"));
  return firstAgent ? `agents/${firstAgent}` : "";
}

function firstAvatarDataUrl(packageRoot, manifest) {
  const declared = String(manifest.avatar ?? "").replace(/^\.\//, "");
  if (declared) {
    const declaredPath = path.join(packageRoot, declared);
    if (existsSync(declaredPath)) return imageDataUrl(declaredPath);
  }
  const firstAvatar = firstFile(
    path.join(packageRoot, "avatars"),
    (name) => /\.(png|jpe?g|webp|svg)$/i.test(name),
  );
  return firstAvatar ? imageDataUrl(path.join(packageRoot, "avatars", firstAvatar)) : null;
}

function firstSkillIconDataUrl(skillRoot, skillMarkdown) {
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
    if (existsSync(iconPath)) return imageDataUrl(iconPath);
  }
  const firstIcon = firstFile(
    skillRoot,
    (name) => /^_?icon\.(png|jpe?g|webp|svg)$/i.test(name),
  );
  return firstIcon ? imageDataUrl(path.join(skillRoot, firstIcon)) : null;
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
  const experts = directoryNames(pluginsRoot)
    .map((packageName) => {
      const packageRoot = path.join(pluginsRoot, packageName);
      const manifest = readJson(path.join(packageRoot, ".expert-plugin/plugin.json"));
      if (Object.keys(manifest).length === 0) return null;
      const agentPath = firstAgentPath(packageRoot, manifest);
      return {
        packageName,
        manifest,
        readme: readText(path.join(packageRoot, "README.md")),
        agentMarkdown: agentPath ? readText(path.join(packageRoot, agentPath)) : "",
        agentPath,
        avatarDataUrl: firstAvatarDataUrl(packageRoot, manifest),
      };
    })
    .filter(Boolean);
  writeJson(expertOutputPath, {
    version: 1,
    sourceRoot: "apps/desktop/resources/marketplace/experts/plugins",
    experts,
  });
  return experts.length;
}

function generateSkills() {
  const skillsRoot = path.join(desktopMarketplaceRoot, "skills/skills");
  const skills = directoryNames(skillsRoot)
    .map((packageName) => {
      const packageRoot = path.join(skillsRoot, packageName);
      const skillMarkdown = readText(path.join(packageRoot, "SKILL.md"));
      if (!skillMarkdown) return null;
      return {
        packageName,
        skillMarkdown,
        iconDataUrl: firstSkillIconDataUrl(packageRoot, skillMarkdown),
      };
    })
    .filter(Boolean);
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
