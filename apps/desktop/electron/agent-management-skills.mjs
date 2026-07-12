/**
 * Agent management skills — scanning, Studio Switch import/sync, host-status
 * skill parity helpers used by the management tab.
 *
 * Composition root (main.mjs) wires createAgentManagementSkills into IPC.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  symlink as fsSymlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * @param {Partial<{
 *   getRealHomeDir: () => string,
 *   onmyagentUserSkillsRoot: () => string,
 *   bundledSkillsRootPath: () => string | null,
 *   shell: { openPath: (path: string) => Promise<string>, showItemInFolder: (path: string) => void },
 * }>} options
 */
export function createAgentManagementSkills(options = {}) {
  const getRealHomeDir = options.getRealHomeDir;
  const onmyagentUserSkillsRoot = options.onmyagentUserSkillsRoot;
  const bundledSkillsRootPath = options.bundledSkillsRootPath;
  const shell = options.shell;
  if (typeof getRealHomeDir !== "function") {
    throw new Error("createAgentManagementSkills requires getRealHomeDir");
  }
  if (typeof onmyagentUserSkillsRoot !== "function") {
    throw new Error("createAgentManagementSkills requires onmyagentUserSkillsRoot");
  }
  if (typeof bundledSkillsRootPath !== "function") {
    throw new Error("createAgentManagementSkills requires bundledSkillsRootPath");
  }
  if (!shell || typeof shell.openPath !== "function") {
    throw new Error("createAgentManagementSkills requires shell");
  }

  async function pathExists(targetPath) {
    try {
      await stat(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  async function isDirectory(targetPath) {
    try {
      return (await stat(targetPath)).isDirectory();
    } catch {
      return false;
    }
  }

  function studioSwitchDatabasePath() {
    return path.join(getRealHomeDir(), ".studio-switch", "studio-switch.db");
  }

  function studioSwitchSkillsRoot() {
    return path.join(getRealHomeDir(), ".studio-switch", "skills");
  }

  function extractFrontmatterValue(raw, keys) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim().toLowerCase();
      if (!keys.includes(key)) continue;
      const value = line
        .slice(separator + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      if (value) return value;
    }
    return null;
  }

  function extractFrontmatterMap(raw, keys) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    const out = {};
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim().toLowerCase();
      if (!keys.includes(key)) continue;
      const value = line
        .slice(separator + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      if (value) out[key] = value;
    }
    return out;
  }

  function extractTrigger(raw) {
    return extractFrontmatterValue(raw, ["trigger", "when"]);
  }

  function extractDescription(raw) {
    const fm = extractFrontmatterMap(raw, ["description", "name"]);
    if (fm.description) {
      return fm.description.length > 180 ? `${fm.description.slice(0, 180)}...` : fm.description;
    }
    let inFrontmatter = false;
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "---") {
        inFrontmatter = !inFrontmatter;
        continue;
      }
      if (inFrontmatter || trimmed.startsWith("#")) continue;
      const cleaned = trimmed.replace(/`/g, "");
      return cleaned.length > 180 ? `${cleaned.slice(0, 180)}...` : cleaned;
    }
    return null;
  }

  function skillAgentsFromPath(skill) {
    const raw = `${skill.path ?? ""}\n${skill.root ?? ""}\n${skill.name ?? ""}`.toLowerCase();
    const agents = [];
    if (raw.includes(".opencode") || raw.includes("opencode")) agents.push("opencode");
    if (raw.includes(".claude") || raw.includes("claude")) agents.push("claude");
    if (raw.includes("openclaw")) agents.push("openclaw");
    if (raw.includes("hermes")) agents.push("hermes");
    if (raw.includes("codex")) agents.push("codex");
    if (raw.includes(".gemini") || raw.includes("gemini")) agents.push("gemini");
    if (raw.includes(".onmyagent") || raw.includes("bundled-skills")) agents.push("onmyagent");
    return agents.length ? [...new Set(agents)] : ["unknown"];
  }

  const STUDIO_SWITCH_SKILL_AGENT_BY_COLUMN = {
    enabled_claude: "claude",
    enabled_codex: "codex",
    enabled_opencode: "opencode",
    enabled_hermes: "hermes",
    enabled_gemini: "gemini",
  };

  const STUDIO_SWITCH_SKILL_COLUMNS_BY_AGENT = {
    claude: "enabled_claude",
    codex: "enabled_codex",
    opencode: "enabled_opencode",
    hermes: "enabled_hermes",
    gemini: "enabled_gemini",
  };

  const AGENT_SKILL_SOURCES = [
    { agent: "opencode", label: "OpenCode", subpaths: [[".opencode", "skills"], [".opencode", "skill"]] },
    { agent: "claude", label: "Claude Code", subpaths: [[".claude", "skills"]] },
    { agent: "codex", label: "Codex", subpaths: [[".codex", "skills"]] },
    { agent: "gemini", label: "Gemini", subpaths: [[".gemini", "skills"]] },
    { agent: "hermes", label: "Hermes", subpaths: [[".hermes", "skills"]] },
    { agent: "openclaw", label: "OpenClaw", subpaths: [[".openclaw", "plugin-skills"], [".openclaw", "skills"]] },
    { agent: "onmyagent", label: "OnMyAgent", subpaths: [[".onmyagent", "skills"]] },
  ];

  const STUDIO_SWITCH_MANAGED_SKILL_AGENTS = Object.keys(STUDIO_SWITCH_SKILL_COLUMNS_BY_AGENT);
  const STUDIO_SKILL_SYNC_AGENTS = [...STUDIO_SWITCH_MANAGED_SKILL_AGENTS, "openclaw", "onmyagent"];
  const CLAUDE_RUNTIME_BUILTIN_SKILL_NAMES = new Set(["init", "review", "security-review"]);

  function unifiedAgentsSkillsRoot() {
    return path.join(getRealHomeDir(), ".agents", "skills");
  }

  function standardAgentSkillDir(agent) {
    const home = getRealHomeDir();
    switch (agent) {
      case "opencode":
        return path.join(home, ".config", "opencode", "skills");
      case "claude":
        return path.join(home, ".claude", "skills");
      case "codex":
        return path.join(home, ".codex", "skills");
      case "hermes":
        return path.join(home, ".hermes", "skills");
      case "openclaw":
        return path.join(home, ".openclaw", "skills");
      case "onmyagent":
        return onmyagentUserSkillsRoot();
      default:
        return "";
    }
  }

  function skillSourceKey(skillDir) {
    return path.basename(skillDir).toLowerCase();
  }

  function skillNameKey(name) {
    return String(name ?? "").trim().toLowerCase();
  }

  function uniqueAgentList(values) {
    const order = ["opencode", "codex", "claude", "openclaw", "hermes", "onmyagent", "unknown"];
    const set = new Set(values.filter(Boolean));
    return order.filter((agent) => set.has(agent));
  }

  function claudeProjectsRoot() {
    return path.join(getRealHomeDir(), ".claude", "projects");
  }

  function claudeProjectDirSlug(targetPath) {
    const resolved = path.resolve(String(targetPath ?? "") || getRealHomeDir());
    return resolved.replace(/[^A-Za-z0-9]/g, "-");
  }

  function parseClaudeSkillListingContent(content) {
    const descriptions = new Map();
    let currentName = null;
    let currentLines = [];
    const flush = () => {
      if (!currentName) return;
      const text = currentLines.join(" ").replace(/\s+/g, " ").trim();
      descriptions.set(currentName, text.length > 220 ? `${text.slice(0, 220)}...` : text);
    };
    for (const line of String(content ?? "").split(/\r?\n/)) {
      const match = line.match(/^\s*-\s+([A-Za-z0-9][A-Za-z0-9_.-]*):\s*(.*)$/);
      if (match) {
        flush();
        currentName = match[1];
        currentLines = [match[2] ?? ""];
      } else if (currentName && line.trim()) {
        currentLines.push(line.trim());
      }
    }
    flush();
    return descriptions;
  }

  async function walkClaudeProjectJsonlFiles(root, maxDepth = 3) {
    const files = [];
    async function walk(current, depth) {
      if (depth > maxDepth || !(await isDirectory(current))) return;
      const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const child = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(child, depth + 1);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push(child);
        }
      }
    }
    await walk(root, 0);
    return files;
  }

  function claudeSkillListingProjectScore(cwd, workspaceRoot) {
    const resolvedCwd = String(cwd ?? "").trim() ? path.resolve(String(cwd)) : "";
    const resolvedWorkspace = String(workspaceRoot ?? "").trim() ? path.resolve(String(workspaceRoot)) : "";
    const home = getRealHomeDir();
    if (resolvedWorkspace && resolvedCwd === resolvedWorkspace) return 4;
    if (resolvedWorkspace && resolvedCwd.startsWith(`${resolvedWorkspace}${path.sep}`)) return 3;
    if (resolvedCwd === home) return 2;
    if (resolvedCwd) return 1;
    return 0;
  }

  async function readClaudeRuntimeSkillListings(workspaceRoot) {
    const root = claudeProjectsRoot();
    if (!(await isDirectory(root))) return [];
    const workspaceSlug = claudeProjectDirSlug(workspaceRoot);
    const homeSlug = claudeProjectDirSlug(getRealHomeDir());
    const candidateRoots = [];
    for (const slug of [workspaceSlug, homeSlug]) {
      const candidate = path.join(root, slug);
      if (await isDirectory(candidate)) candidateRoots.push(candidate);
    }
    const scanRoots = candidateRoots.length ? candidateRoots : [root];
    const files = [];
    for (const scanRoot of scanRoots) {
      files.push(...(await walkClaudeProjectJsonlFiles(scanRoot)));
    }

    const listings = [];
    for (const filePath of [...new Set(files)]) {
      let raw = "";
      try {
        raw = await readFile(filePath, "utf8");
      } catch {
        continue;
      }
      for (const line of raw.split(/\r?\n/)) {
        if (!line.includes('"skill_listing"')) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        const attachment = entry?.attachment;
        if (attachment?.type !== "skill_listing") continue;
        const names = Array.isArray(attachment.names) ? attachment.names.filter(Boolean).map(String) : [];
        if (!names.length) continue;
        const timestamp = Date.parse(entry?.timestamp ?? "") || 0;
        listings.push({
          filePath,
          cwd: entry?.cwd ?? "",
          names,
          content: String(attachment.content ?? ""),
          timestamp,
          score: claudeSkillListingProjectScore(entry?.cwd, workspaceRoot),
        });
      }
    }
    listings.sort((a, b) => (b.score - a.score) || (b.timestamp - a.timestamp));
    return listings;
  }

  async function collectClaudeRuntimeSkills(workspaceRoot) {
    const out = new Map();
    const listings = await readClaudeRuntimeSkillListings(workspaceRoot);
    for (const listing of listings) {
      const descriptions = parseClaudeSkillListingContent(listing.content);
      for (const name of listing.names) {
        const key = `claude-runtime:${skillNameKey(name)}`;
        if (out.has(key)) continue;
        out.set(key, {
          name,
          path: listing.filePath,
          description: descriptions.get(name) || `Claude Code runtime skill: ${name}`,
          trigger: undefined,
          root: path.dirname(listing.filePath),
          readonly: true,
          displayNameZh: undefined,
          displayNameEn: name,
          descriptionZh: undefined,
          descriptionEn: undefined,
          agents: ["claude"],
          scopeLabel: "Claude Runtime",
          sources: [{
            agent: "claude",
            label: "Claude Code",
            scope: CLAUDE_RUNTIME_BUILTIN_SKILL_NAMES.has(name) ? "builtin-command" : "runtime-skill",
            root: path.dirname(listing.filePath),
            path: listing.filePath,
            managedByStudioSwitch: false,
            kind: CLAUDE_RUNTIME_BUILTIN_SKILL_NAMES.has(name) ? "slash-command" : "runtime-skill",
            pluginName: null,
          }],
          managedByStudioSwitch: false,
          studioSwitch: null,
          kind: CLAUDE_RUNTIME_BUILTIN_SKILL_NAMES.has(name) ? "slash-command" : "runtime-skill",
          pluginName: null,
          lastSeenAt: listing.timestamp || null,
        });
      }
    }
    return out;
  }

  function readStudioSwitchManagedSkills() {
    const dbPath = studioSwitchDatabasePath();
    if (!existsSync(dbPath)) return new Map();
    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      const hasSkillsTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'skills'").get();
      if (!hasSkillsTable) return new Map();
      const rows = db
        .prepare(
          `SELECT id, name, description, directory, repo_owner, repo_name, repo_branch, readme_url,
                  enabled_claude, enabled_codex, enabled_opencode, enabled_hermes, installed_at, content_hash, updated_at
             FROM skills`,
        )
        .all();
      const out = new Map();
      for (const row of rows) {
        const directory = String(row.directory ?? "").trim();
        if (!directory) continue;
        const agents = [];
        for (const [column, agent] of Object.entries(STUDIO_SWITCH_SKILL_AGENT_BY_COLUMN)) {
          if (Boolean(row[column])) agents.push(agent);
        }
        out.set(directory.toLowerCase(), {
          id: row.id,
          name: row.name,
          description: row.description,
          directory,
          repoOwner: row.repo_owner,
          repoName: row.repo_name,
          repoBranch: row.repo_branch,
          readmeUrl: row.readme_url,
          agents,
          installedAt: row.installed_at,
          contentHash: row.content_hash,
          updatedAt: row.updated_at,
        });
      }
      return out;
    } catch (error) {
      console.warn("[agent-management] failed to read studio-switch skills db", error);
      return new Map();
    } finally {
      try {
        db?.close();
      } catch {
        // ignore
      }
    }
  }

  async function collectAgentSkillRoots(projectDir) {
    const roots = [];
    const realHome = getRealHomeDir();
    const push = async (candidate) => {
      if (!candidate?.root || !(await isDirectory(candidate.root))) return;
      if (roots.some((root) => root.root === candidate.root && root.agent === candidate.agent && root.scope === candidate.scope)) return;
      roots.push(candidate);
    };

    const workspaceRoot = String(projectDir ?? "").trim() ? path.resolve(projectDir) : "";
    if (workspaceRoot) {
      let current = workspaceRoot;
      while (true) {
        if (current === realHome || path.dirname(current) === current) break;
        for (const source of AGENT_SKILL_SOURCES) {
          for (const subpath of source.subpaths) {
            await push({
              root: path.join(current, ...subpath),
              agent: source.agent,
              label: source.label,
              scope: "project",
            });
          }
        }
        if (await pathExists(path.join(current, ".git"))) break;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
    }

    for (const source of AGENT_SKILL_SOURCES) {
      for (const subpath of source.subpaths) {
        await push({
          root: path.join(realHome, ...subpath),
          agent: source.agent,
          label: source.label,
          scope: "global",
        });
      }
    }

    for (const source of AGENT_SKILL_SOURCES) {
      const root = standardAgentSkillDir(source.agent);
      if (root) {
        await push({ root, agent: source.agent, label: source.label, scope: "global" });
      }
    }

    await push({ root: studioSwitchSkillsRoot(), agent: "unknown", label: "Studio Switch", scope: "studio-switch" });
    await push({ root: unifiedAgentsSkillsRoot(), agent: "unknown", label: "Agent Skills", scope: "agents" });
    const bundledRoot = bundledSkillsRootPath();
    if (bundledRoot) {
      await push({ root: bundledRoot, agent: "onmyagent", label: "OnMyAgent", scope: "builtin" });
    }
    await push({ root: onmyagentUserSkillsRoot(), agent: "onmyagent", label: "OnMyAgent", scope: "onmyagent" });

    return roots;
  }

  async function copyDirectoryRecursive(source, destination) {
    await cp(source, destination, { recursive: true, force: true, errorOnExist: false, verbatimSymlinks: true });
  }

  async function removePathIfPresent(target) {
    await rm(target, { recursive: true, force: true });
  }

  function validateSkillDirectoryName(directory) {
    const value = String(directory ?? "").trim();
    if (!value || value.includes("/") || value.includes("\\") || value === "." || value === "..") {
      throw new Error("Invalid skill directory");
    }
    return value;
  }

  function sanitizeManagedSkillName(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96);
  }

  function escapeSkillFrontmatterValue(value) {
    return String(value ?? "").replace(/\r?\n/g, " ").replace(/"/g, "\\\"").trim();
  }

  function runtimeManagedSkillContent({ name, displayName, description, agent, kind, sourcePath }) {
    const title = displayName || name;
    const sourceKind = kind === "slash-command" ? "Slash Command" : kind === "plugin" ? "Plugin" : "Runtime Skill";
    const summary = description || `${sourceKind} imported from ${agent}.`;
    return `---
  name: "${escapeSkillFrontmatterValue(title)}"
  description: "${escapeSkillFrontmatterValue(summary)}"
  ---

  # ${title}

  This is a Studio-managed wrapper for a ${sourceKind} discovered from ${agent}.

  ## Source

  - Agent: ${agent}
  - Kind: ${sourceKind}
  - Source path: ${sourcePath || "unknown"}

  ## Behavior

  ${summary}

  ## Notes

  The original item was discovered from runtime metadata rather than a standalone SKILL.md directory. This wrapper makes it manageable through Studio/Studio Switch style skill syncing. If the original runtime item depends on built-in agent behavior, this wrapper documents and routes the intent but may not reproduce private built-in implementation details.
  `;
  }

  function ensureStudioSwitchSkillSchema(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      directory TEXT NOT NULL,
      repo_owner TEXT,
      repo_name TEXT,
      repo_branch TEXT DEFAULT 'main',
      readme_url TEXT,
      enabled_claude BOOLEAN NOT NULL DEFAULT 0,
      enabled_codex BOOLEAN NOT NULL DEFAULT 0,
      enabled_gemini BOOLEAN NOT NULL DEFAULT 0,
      enabled_opencode BOOLEAN NOT NULL DEFAULT 0,
      enabled_hermes BOOLEAN NOT NULL DEFAULT 0,
      installed_at INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0
    )`);
  }

  async function hashDirectoryForAgentManagement(dir) {
    const files = [];
    async function walk(current) {
      const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const child = path.join(current, entry.name);
        if (entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(child)))) {
          await walk(child);
        } else if (entry.isFile()) {
          files.push(child);
        }
      }
    }
    await walk(dir);
    files.sort();
    const hash = createHash("sha256");
    for (const filePath of files) {
      const relative = path.relative(dir, filePath).replace(/\\/g, "/");
      hash.update(relative);
      hash.update("\0");
      hash.update(await readFile(filePath));
      hash.update("\0");
    }
    return hash.digest("hex");
  }

  async function saveImportedStudioSwitchSkill({ directory, name, description, agent, contentHash }) {
    const dbPath = studioSwitchDatabasePath();
    await mkdir(path.dirname(dbPath), { recursive: true });
    const now = Math.floor(Date.now() / 1000);
    const id = `studio:${directory}`;
    const columns = {
      claude: "enabled_claude",
      codex: "enabled_codex",
      opencode: "enabled_opencode",
      hermes: "enabled_hermes",
      gemini: "enabled_gemini",
    };
    let db;
    try {
      db = new DatabaseSync(dbPath);
      ensureStudioSwitchSkillSchema(db);
      const existing = db.prepare("SELECT id FROM skills WHERE lower(directory) = lower(?) LIMIT 1").get(directory);
      if (existing) {
        db.prepare("UPDATE skills SET name = ?, description = ?, content_hash = ?, updated_at = ? WHERE id = ?")
          .run(name, description || null, contentHash || null, now, existing.id);
        const column = columns[agent];
        if (column) db.prepare(`UPDATE skills SET ${column} = 1, updated_at = ? WHERE id = ?`).run(now, existing.id);
        return existing.id;
      }
      db.prepare(`INSERT INTO skills (
        id, name, description, directory, repo_owner, repo_name, repo_branch, readme_url,
        enabled_claude, enabled_codex, enabled_gemini, enabled_opencode, enabled_hermes,
        installed_at, content_hash, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, 'main', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          id,
          name,
          description || null,
          directory,
          agent === "claude" ? 1 : 0,
          agent === "codex" ? 1 : 0,
          agent === "gemini" ? 1 : 0,
          agent === "opencode" ? 1 : 0,
          agent === "hermes" ? 1 : 0,
          now,
          contentHash || null,
          now,
        );
      return id;
    } finally {
      try {
        db?.close();
      } catch {
        // ignore
      }
    }
  }

  async function isSymlink(target) {
    try {
      const metadata = await lstat(target);
      return metadata.isSymbolicLink();
    } catch {
      return false;
    }
  }

  async function symlinkTargetStartsWith(linkPath, root) {
    if (!(await isSymlink(linkPath))) return false;
    try {
      const target = await readlink(linkPath);
      const resolved = path.isAbsolute(target) ? target : path.resolve(path.dirname(linkPath), target);
      const [realTarget, realRoot] = await Promise.all([
        realpath(resolved).catch(() => resolved),
        realpath(root).catch(() => root),
      ]);
      return realTarget === realRoot || realTarget.startsWith(`${realRoot}${path.sep}`);
    } catch {
      return false;
    }
  }

  async function agentManagementSkillAction(input = {}) {
    const action = String(input?.action ?? "").trim();
    const agent = String(input?.agent ?? "").trim();
    const directory = validateSkillDirectoryName(input?.directory);
    const displayName = String(input?.displayName ?? directory).trim() || directory;
    const description = String(input?.description ?? "").trim();
    const kind = String(input?.kind ?? "skill").trim();

    const requestedSource = String(input?.sourcePath ?? "").trim();
    const source = requestedSource || path.join(studioSwitchSkillsRoot(), directory);
    const fallbackSource = path.join(unifiedAgentsSkillsRoot(), directory);
    const sourceDir = (await isDirectory(source)) ? source : fallbackSource;

    if (action === "open") {
      const destinationRoot = standardAgentSkillDir(agent);
      const destination = destinationRoot ? path.join(destinationRoot, directory) : "";
      const target = destination && (await isDirectory(destination)) ? destination : sourceDir;
      if (await isDirectory(target)) return { ok: true, path: target, result: await shell.openPath(target) };
      try {
        const metadata = await stat(target);
        if (metadata.isFile()) {
          return { ok: true, path: target, result: await shell.showItemInFolder(target) };
        }
      } catch {
        // fall through
      }
      throw new Error("Skill directory not found");
    }

    if (action === "import") {
      const managedDirectory = sanitizeManagedSkillName(directory);
      if (!managedDirectory) throw new Error("Invalid skill directory");
      const destinationRoot = studioSwitchSkillsRoot();
      const destination = path.join(destinationRoot, managedDirectory);
      await mkdir(destinationRoot, { recursive: true });

      const hasSkillSource = (await isDirectory(sourceDir)) && (await pathExists(path.join(sourceDir, "SKILL.md")));
      if (hasSkillSource) {
        if (path.resolve(sourceDir) !== path.resolve(destination)) {
          await removePathIfPresent(destination);
          await copyDirectoryRecursive(sourceDir, destination);
        }
      } else {
        await removePathIfPresent(destination);
        await mkdir(destination, { recursive: true });
        await writeFile(path.join(destination, "SKILL.md"), runtimeManagedSkillContent({
          name: managedDirectory,
          displayName,
          description,
          agent,
          kind,
          sourcePath: requestedSource,
        }), "utf8");
        await writeFile(path.join(destination, "studio-source.json"), JSON.stringify({
          importedAt: new Date().toISOString(),
          sourceAgent: agent,
          sourceKind: kind,
          sourcePath: requestedSource || null,
          originalName: directory,
        }, null, 2), "utf8");
      }

      const contentHash = await hashDirectoryForAgentManagement(destination).catch(() => null);
      await saveImportedStudioSwitchSkill({
        directory: managedDirectory,
        name: displayName,
        description,
        agent,
        contentHash,
      });

      if (STUDIO_SKILL_SYNC_AGENTS.includes(agent)) {
        const targetRoot = standardAgentSkillDir(agent);
        const target = targetRoot ? path.join(targetRoot, managedDirectory) : "";
        if (target && path.resolve(target) !== path.resolve(destination)) {
          await mkdir(targetRoot, { recursive: true });
          await removePathIfPresent(target);
          try {
            await fsSymlink(destination, target, "dir");
          } catch {
            await copyDirectoryRecursive(destination, target);
          }
        }
      }

      return { ok: true, action, agent, directory: managedDirectory, path: destination };
    }

    if (!STUDIO_SKILL_SYNC_AGENTS.includes(agent)) {
      throw new Error("Unsupported skill agent");
    }

    const destinationRoot = standardAgentSkillDir(agent);
    const destination = path.join(destinationRoot, directory);

    if (action === "enable") {
      if (!(await isDirectory(sourceDir)) || !(await pathExists(path.join(sourceDir, "SKILL.md")))) {
        throw new Error("Skill source is missing SKILL.md");
      }
      await mkdir(destinationRoot, { recursive: true });
      await removePathIfPresent(destination);
      try {
        await fsSymlink(sourceDir, destination, "dir");
      } catch {
        await copyDirectoryRecursive(sourceDir, destination);
      }
      await setStudioSwitchSkillAgentEnabled(directory, agent, true);
      return { ok: true, action, agent, directory, path: destination };
    }

    if (action === "disable") {
      if (await isSymlink(destination)) {
        await removePathIfPresent(destination);
      } else if (await isDirectory(destination)) {
        const [realSource, realDestination] = await Promise.all([
          realpath(sourceDir).catch(() => path.resolve(sourceDir)),
          realpath(destination).catch(() => path.resolve(destination)),
        ]);
        if (realSource === realDestination) {
          throw new Error("未托管 Skill 位于当前应用目录，已拒绝直接删除；请先同步到 Studio Switch/Agents 源目录后再禁用。");
        }
        await removePathIfPresent(destination);
      }
      await setStudioSwitchSkillAgentEnabled(directory, agent, false);
      return { ok: true, action, agent, directory, path: destination };
    }

    throw new Error("Unsupported skill action");
  }

  async function setStudioSwitchSkillAgentEnabled(directory, agent, enabled) {
    const dbPath = studioSwitchDatabasePath();
    const column = STUDIO_SWITCH_SKILL_COLUMNS_BY_AGENT[agent];
    if (!column || !existsSync(dbPath)) return false;
    let db;
    try {
      db = new DatabaseSync(dbPath);
      const row = db.prepare("SELECT id FROM skills WHERE lower(directory) = lower(?) LIMIT 1").get(directory);
      if (!row) return false;
      db.prepare(`UPDATE skills SET ${column} = ?, updated_at = ? WHERE id = ?`).run(enabled ? 1 : 0, Math.floor(Date.now() / 1000), row.id);
      return true;
    } finally {
      try {
        db?.close();
      } catch {
        // ignore
      }
    }
  }

  async function findSkillDirsRecursive(root, maxDepth = 4) {
    const found = [];
    async function walk(current, depth) {
      if (depth > maxDepth || !(await isDirectory(current))) return;
      if (await pathExists(path.join(current, "SKILL.md"))) {
        found.push(current);
        return;
      }
      const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name.startsWith(".") && entry.name !== ".system") continue;
        const child = path.join(current, entry.name);
        if (entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(child)))) {
          await walk(child, depth + 1);
        }
      }
    }
    await walk(root, 0);
    return found;
  }

  async function scanAgentManagementSkills(projectDir) {
    const LOCALE_KEYS = ["display_name_zh", "display_name_en", "description_zh", "description_en"];
    const studioSwitchManaged = readStudioSwitchManagedSkills();
    const claudeRuntimeSkills = await collectClaudeRuntimeSkills(projectDir);
    const skills = new Map();

    for (const source of await collectAgentSkillRoots(projectDir)) {
      for (const skillDir of await findSkillDirsRecursive(source.root)) {
        const directory = path.basename(skillDir);
        const key = skillSourceKey(skillDir);
        let raw = "";
        try {
          raw = await readFile(path.join(skillDir, "SKILL.md"), "utf8");
        } catch {
          raw = "";
        }
        const managed = studioSwitchManaged.get(key) ?? null;
        const localeMap = extractFrontmatterMap(raw, LOCALE_KEYS);
        const existing = skills.get(key) ?? {
          name: directory,
          path: skillDir,
          description: undefined,
          trigger: undefined,
          root: source.root,
          readonly: source.scope === "builtin",
          displayNameZh: undefined,
          displayNameEn: undefined,
          descriptionZh: undefined,
          descriptionEn: undefined,
          agents: [],
          scopeLabel: "本机",
          sources: [],
          managedByStudioSwitch: false,
          studioSwitch: null,
          kind: "skill",
          pluginName: null,
          lastSeenAt: null,
        };

        const sourceAgents = uniqueAgentList([...(managed?.agents ?? []), source.agent]);
        existing.name = managed?.directory || existing.name || directory;
        existing.description = existing.description || managed?.description || extractDescription(raw) || undefined;
        existing.trigger = existing.trigger || extractTrigger(raw) || undefined;
        existing.displayNameZh = existing.displayNameZh || localeMap.display_name_zh;
        existing.displayNameEn = existing.displayNameEn || localeMap.display_name_en || managed?.name;
        existing.descriptionZh = existing.descriptionZh || localeMap.description_zh;
        existing.descriptionEn = existing.descriptionEn || localeMap.description_en;
        existing.readonly = existing.readonly || source.scope === "builtin";
        existing.managedByStudioSwitch = existing.managedByStudioSwitch || Boolean(managed);
        existing.studioSwitch = existing.studioSwitch || managed;
        existing.agents = uniqueAgentList([...existing.agents, ...sourceAgents]);
        existing.sources.push({
          agent: source.agent,
          label: source.label,
          scope: source.scope,
          root: source.root,
          path: skillDir,
          managedByStudioSwitch: Boolean(managed),
          kind: "skill",
          pluginName: null,
        });
        skills.set(key, existing);
      }
    }

    for (const [key, runtimeSkill] of claudeRuntimeSkills) {
      const plainNameKey = skillNameKey(runtimeSkill.name);
      const existingKey = [...skills.keys()].find((candidate) => candidate === plainNameKey || candidate.endsWith(`:${plainNameKey}`));
      if (existingKey) {
        const existing = skills.get(existingKey);
        existing.description = existing.description || runtimeSkill.description;
        existing.readonly = existing.readonly || runtimeSkill.readonly;
        existing.agents = uniqueAgentList([...existing.agents, "claude"]);
        existing.sources.push(...runtimeSkill.sources);
        existing.lastSeenAt = existing.lastSeenAt || runtimeSkill.lastSeenAt;
        skills.set(existingKey, existing);
      } else {
        skills.set(key, runtimeSkill);
      }
    }

    for (const [key, managed] of studioSwitchManaged) {
      if (skills.has(key)) continue;
      skills.set(key, {
        name: managed.directory,
        path: path.join(studioSwitchSkillsRoot(), managed.directory),
        description: managed.description || undefined,
        trigger: undefined,
        root: studioSwitchSkillsRoot(),
        readonly: false,
        displayNameZh: undefined,
        displayNameEn: managed.name,
        descriptionZh: undefined,
        descriptionEn: undefined,
        agents: uniqueAgentList(managed.agents.length ? managed.agents : ["unknown"]),
        scopeLabel: "Studio Switch",
        sources: [{
          agent: "unknown",
          label: "Studio Switch",
          scope: "studio-switch-db",
          root: studioSwitchSkillsRoot(),
          path: path.join(studioSwitchSkillsRoot(), managed.directory),
          managedByStudioSwitch: true,
          kind: "skill",
          pluginName: null,
        }],
        managedByStudioSwitch: true,
        studioSwitch: managed,
        kind: "skill",
        pluginName: null,
        lastSeenAt: null,
      });
    }

    return [...skills.values()]
      .map((skill) => ({
        ...skill,
        agents: uniqueAgentList([
          ...(skill.agents.length ? skill.agents : skillAgentsFromPath(skill)),
          ...skill.sources.map((source) => source.agent),
        ]),
        scopeLabel: skill.managedByStudioSwitch ? "Studio Switch" : skill.kind === "runtime-skill" ? "Claude Runtime" : skill.kind === "slash-command" ? "Slash Command" : skillScopeLabel(skill, projectDir),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function skillScopeLabel(skill, workspaceRoot) {
    const root = String(skill.root ?? "");
    const skillPath = String(skill.path ?? "");
    const bundledRoot = bundledSkillsRootPath();
    if (bundledRoot && (root === bundledRoot || skillPath.startsWith(bundledRoot))) return "内置";
    if (root === onmyagentUserSkillsRoot() || skillPath.startsWith(onmyagentUserSkillsRoot())) return "OnMyAgent";
    if (workspaceRoot && skillPath.startsWith(path.resolve(workspaceRoot))) return "项目";
    return "本机";
  }

  return {
    agentManagementSkillAction,
    scanAgentManagementSkills,
    copyDirectoryRecursive,
    removePathIfPresent,
  };
}
