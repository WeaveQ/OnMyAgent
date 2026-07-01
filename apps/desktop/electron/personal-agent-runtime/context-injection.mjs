import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MARKER_BEGIN = "<!-- BEGIN ONMYAGENT-PERSONAL-ASSISTANT (auto-managed; do not edit) -->";
const MARKER_END = "<!-- END ONMYAGENT-PERSONAL-ASSISTANT -->";

function contextFileName(provider) {
  if (provider === "claude") return "CLAUDE.md";
  return "AGENTS.md";
}

function normalizeAccessibleWorkspaceRoots(value, workspaceRoot = "") {
  const primary = String(workspaceRoot ?? "").trim();
  const source = Array.isArray(value) ? value : String(value ?? "").split(",");
  const seen = new Set();
  const roots = [];
  for (const item of source) {
    const root = String(item ?? "").trim();
    if (!root || root === primary || seen.has(root)) continue;
    seen.add(root);
    roots.push(root);
  }
  return roots;
}

function buildContextBlock({ provider, workspaceRoot, accessibleWorkspaceRoots = [] }) {
  const extraRoots = normalizeAccessibleWorkspaceRoots(accessibleWorkspaceRoots, workspaceRoot);
  return [
    "# OnMyAgent Personal Assistant",
    "",
    "You are running as a local agent for OnMyAgent Personal Assistant.",
    "Use your native agent harness, tools, memory, and session behavior normally.",
    "Always produce a final answer that can be shown directly to the user.",
    "When you create, modify, or read files that matter to the answer, mention paths relative to the workspace root.",
    "",
    `Workspace root: ${workspaceRoot}`,
    extraRoots.length ? `Additional accessible roots:\n${extraRoots.map((root) => `- ${root}`).join("\n")}` : "Additional accessible roots: none",
    `Provider: ${provider}`,
  ].join("\n");
}

function replaceManagedBlock(existing, block) {
  const start = existing.indexOf(MARKER_BEGIN);
  const end = existing.indexOf(MARKER_END, start + MARKER_BEGIN.length);
  if (start >= 0 && end >= 0) {
    const afterEnd = end + MARKER_END.length;
    const tail = existing.slice(afterEnd).replace(/^\n/, "");
    return `${existing.slice(0, start)}${block}\n${tail}`;
  }
  const separator = existing.trim() ? "\n\n" : "";
  return `${existing}${separator}${block}\n`;
}

export async function injectPersonalAgentContext({ workdir, provider, workspaceRoot, accessibleWorkspaceRoots = [] }) {
  const filePath = path.join(workdir, contextFileName(provider));
  const body = buildContextBlock({ provider, workspaceRoot, accessibleWorkspaceRoots });
  const block = `${MARKER_BEGIN}\n${body}\n${MARKER_END}`;
  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch {
    existing = "";
  }
  await writeFile(filePath, replaceManagedBlock(existing, block), "utf8");
  return filePath;
}

export const __test__ = { buildContextBlock, normalizeAccessibleWorkspaceRoots };
