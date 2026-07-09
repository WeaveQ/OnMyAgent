/**
 * Read-only status aggregation for the Local Agent session page.
 *
 * These view-models are pure derivations from data that the runtime already
 * owns:
 *   - agent metadata (native_skills_dirs, handshake capabilities/commands)
 *   - conversation event stream (permission messages, tool groups)
 *   - approval-store persistent decisions
 *
 * Nothing here writes, activates, or mutates skill / MCP / permission state.
 * Session-page consumers must NOT gain edit affordances from this module.
 * The management tab remains the sole owner of write operations.
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

// Aligned with management page scanner (main.mjs::findSkillDirsRecursive):
// a skill package is any directory that contains SKILL.md. We stop recursing
// once we find one, and we skip hidden directories except ".system" which
// holds bundled system skills (e.g. ~/.codex/skills/.system/*).
const SKILL_INDEX_FILENAME = "SKILL.md";
const MAX_SKILL_ENTRIES_PER_ROOT = 500;
const MAX_DIRECTORY_DEPTH = 4;
const DENIED_DECISIONS = new Set(["reject", "deny", "decline", "cancel", "reject_once", "cancelled"]);

async function pathExists(p) {
  return safeStat(p).then((s) => Boolean(s)).catch(() => false);
}

async function safeReaddir(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

async function safeStat(p) {
  try {
    return await stat(p);
  } catch {
    return null;
  }
}

async function collectSkillEntriesForRoot(root) {
  const entries = [];
  const rootStat = await safeStat(root);
  if (!rootStat || !rootStat.isDirectory()) {
    return { root, exists: false, entries };
  }
  // Recursive walk mirroring main.mjs::findSkillDirsRecursive: a directory
  // that contains SKILL.md is a leaf skill; we do not recurse further.
  async function walk(current, depth) {
    if (entries.length >= MAX_SKILL_ENTRIES_PER_ROOT) return;
    if (depth > MAX_DIRECTORY_DEPTH) return;
    const currentStat = await safeStat(current);
    if (!currentStat || !currentStat.isDirectory()) return;
    const indexFile = path.join(current, SKILL_INDEX_FILENAME);
    if (await pathExists(indexFile)) {
      entries.push({
        id: path.relative(root, indexFile),
        name: path.basename(current),
        indexFile,
        source: root,
        // Provenance is always "workspace" because these come from disk scan
        // rooted at native_skills_dirs which live outside the runtime's write
        // surface. We tag them so the UI never claims we manage them.
        provenance: "workspace",
      });
      return;
    }
    const children = await safeReaddir(current);
    if (!children) return;
    for (const child of children) {
      if (entries.length >= MAX_SKILL_ENTRIES_PER_ROOT) break;
      // Skip hidden directories except ".system" which is the bundled-skills
      // convention used by Codex/Claude/OpenCode/etc.
      if (child.name.startsWith(".") && child.name !== ".system") continue;
      const abs = path.join(current, child.name);
      let isDir = child.isDirectory();
      if (child.isSymbolicLink()) {
        const target = await safeStat(abs);
        isDir = target ? target.isDirectory() : false;
      }
      if (!isDir) continue;
      await walk(abs, depth + 1);
    }
  }
  await walk(root, 0);
  return { root, exists: true, entries };
}

/**
 * Build a read-only skill status view-model.
 *
 * @param {object} input
 * @param {string[]} [input.nativeSkillsDirs] - authoritative skill roots declared
 *   by the underlying CLI agent metadata (native_skills_dirs).
 * @returns {Promise<{ skills: Array<{ id, name, indexFile, source, provenance }>,
 *   roots: Array<{ path: string, exists: boolean, count: number }>,
 *   error: null | string }>}
 */
export async function buildSkillStatus(input = {}) {
  const roots = Array.isArray(input.nativeSkillsDirs)
    ? input.nativeSkillsDirs.filter((s) => typeof s === "string" && s.trim().length)
    : [];
  if (roots.length === 0) {
    return { skills: [], roots: [], error: null };
  }
  const perRoot = await Promise.all(roots.map((r) => collectSkillEntriesForRoot(r)));
  const skills = [];
  const rootSummaries = [];
  const seen = new Set();
  for (const bucket of perRoot) {
    rootSummaries.push({ path: bucket.root, exists: bucket.exists, count: bucket.entries.length });
    for (const entry of bucket.entries) {
      const dedupeKey = entry.indexFile;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      skills.push(entry);
    }
  }
  return { skills, roots: rootSummaries, error: null };
}

/**
 * Build a read-only MCP status view-model from ACP tool-group / provider
 * events already normalized by the runtime.
 *
 * We intentionally do NOT read the CLI agent's own MCP config files here.
 * That data is the CLI's authoritative surface (opencode config, claude
 * config, etc.). We only report what the current ACP session says is
 * connected. This avoids double-source drift.
 *
 * @param {object} input
 * @param {Array} [input.conversationMessages] - normalized event stream from the
 *   current conversation, already flattened by contract.mjs.
 * @param {Array} [input.availableCommands] - handshake.available_commands entries
 *   which some CLIs annotate with `source: "mcp:<server>"`.
 * @returns {{ servers: Array<{ name: string, transport: string | null, connected: boolean, toolCount: number }>,
 *   error: null | string }}
 */
export function buildMcpStatus(input = {}) {
  const servers = new Map();
  const messages = Array.isArray(input.conversationMessages) ? input.conversationMessages : [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const toolCall = message.toolCall ?? message.tool_call ?? null;
    if (!toolCall || typeof toolCall !== "object") continue;
    const rawSource = String(toolCall.source ?? toolCall.provider ?? "").trim();
    const match = rawSource.match(/^mcp[:/]([^:/]+)/i);
    if (!match) continue;
    const name = match[1];
    const existing = servers.get(name) ?? { name, transport: null, connected: true, toolCount: 0 };
    existing.toolCount += 1;
    servers.set(name, existing);
  }
  const commands = Array.isArray(input.availableCommands) ? input.availableCommands : [];
  for (const command of commands) {
    if (!command || typeof command !== "object") continue;
    const source = String(command.source ?? "").trim();
    const match = source.match(/^mcp[:/]([^:/]+)/i);
    if (!match) continue;
    const name = match[1];
    const existing = servers.get(name) ?? { name, transport: null, connected: true, toolCount: 0 };
    servers.set(name, existing);
  }
  return { servers: [...servers.values()], error: null };
}

/**
 * Build a read-only permission status view-model.
 *
 * Aggregates:
 *   - pending: live approvals from the active run
 *   - resolved: permission messages already in the conversation store, split
 *     into approved / denied by their approval.decision
 *   - remembered: acceptForSession decisions from approval-store
 *
 * @param {object} input
 * @param {Array} [input.pendingApprovals]
 * @param {Array} [input.conversationMessages]
 * @param {Array} [input.rememberedDecisions]
 * @returns {{ pending: number, approved: number, denied: number,
 *   remembered: number, items: Array<{ id: string, state: string,
 *   summary: string, method: string, at: number | null }> }}
 */
export function buildPermissionStatus(input = {}) {
  const pending = Array.isArray(input.pendingApprovals) ? input.pendingApprovals : [];
  const messages = Array.isArray(input.conversationMessages) ? input.conversationMessages : [];
  const remembered = Array.isArray(input.rememberedDecisions) ? input.rememberedDecisions : [];

  const items = [];
  let approved = 0;
  let denied = 0;

  for (const approval of pending) {
    if (!approval || typeof approval !== "object") continue;
    items.push({
      id: String(approval.id ?? ""),
      state: "pending",
      summary: String(approval.summary ?? approval.method ?? ""),
      method: String(approval.method ?? ""),
      at: null,
    });
  }
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if (message.type !== "permission") continue;
    const approval = message.approval ?? null;
    if (!approval || typeof approval !== "object") continue;
    const decision = String(approval.decision ?? "").trim();
    if (!decision) continue;
    const state = DENIED_DECISIONS.has(decision) ? "denied" : "approved";
    if (state === "approved") approved += 1;
    else denied += 1;
    items.push({
      id: String(approval.id ?? ""),
      state,
      summary: String(approval.summary ?? approval.method ?? message.text ?? ""),
      method: String(approval.method ?? ""),
      at: Number(message.createdAt) || null,
    });
  }
  return {
    pending: pending.length,
    approved,
    denied,
    remembered: remembered.length,
    items,
  };
}
