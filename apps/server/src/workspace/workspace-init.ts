import { basename, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { ensureDir, exists } from "../core/utils.js";
import { ApiError } from "../core/errors.js";
import { onmyagentConfigPath, opencodeConfigPath } from "./workspace-files.js";
import {
  readJsoncFile,
  updateJsoncPath,
  updateJsoncTopLevel,
  writeJsoncFile,
} from "../core/jsonc.js";
import type { ReloadReason } from "@onmyagent/types/server";
import { APP_NAME, APP_NAME_LOWER } from "../core/brand.js";

const BROWSER_PLUGIN = "opencode-chrome-devtools";
const DEFAULT_OPENCODE_AGENT = APP_NAME_LOWER;
const LEGACY_BROWSER_MCP_KEYS = [
  "onmyagent-browser",
  "chrome",
  "chrome-devtools",
  "control-chrome",
];

const ONMYAGENT_ARTIFACT_GUIDANCE = `<!-- ${APP_NAME}_ARTIFACTS_START -->
## ${APP_NAME} Artifacts

${APP_NAME} can preview, edit, and download standard artifacts when you create or update them in the workspace.

- Prefer standard output files for user-visible deliverables: Markdown (\`.md\`), CSV (\`.csv\`), Excel workbooks (\`.xlsx\`), and browser previews (\`index.html\` or a local \`http://localhost:<port>\` URL).
- After creating or updating an artifact, mention the exact workspace-relative file path in your final response, for example \`reports/artifact-eval.md\` or \`reports/artifact-eval.xlsx\`.
- Do not invent \`Workspace/<id>/...\` paths unless a tool returns them; prefer clean workspace-relative paths.
- For websites or React/UI previews, start the dev server when useful and mention the \`http://localhost:<port>\` URL. Socket URLs such as \`ws://localhost:<port>/...\` are diagnostic hints, not primary preview links.
- For spreadsheets, use \`.csv\` for simple tabular data and \`.xlsx\` when the user asks for Excel/XLS specifically.
- For large HTML, SVG, source-code, or report artifacts, do not place the entire artifact in one JSON tool argument. Keep each file-mutation tool call bounded: write a small skeleton first, then edit or append in multiple calls, and validate the completed file before presenting it. Prefer chunks below 8,000 characters so a provider output limit cannot cut a tool call mid-JSON.
<!-- ${APP_NAME}_ARTIFACTS_END -->`;

const ONMYAGENT_VISUAL_GUIDANCE = `<!-- ${APP_NAME}_VISUALS_START -->
## Inline visuals

${APP_NAME} can render safe SVG/HTML fragments directly inside the completed assistant response.

- When a chart, architecture diagram, process, comparison, timeline, or metric dashboard communicates the result more clearly than prose alone, call \`get_design_spec\` with every relevant module and then \`render_visual\`. For charts, request \`modules: ["chart"]\`.
- Pass a concise title. Use \`widget_code\` only for a small fragment; for a substantial visual, write one \`.svg\` or \`.html\` file in the workspace and pass its workspace-relative path as \`file_path\`. Do not read the file back into the tool call.
- If writing a large visual risks an incomplete tool call, create or update the file in smaller chunks before calling \`render_visual\`. Never send a complete HTML document, iframe, form, event handler, storage access, or script outside the chart module's CDN allowlist.
- Prefer responsive SVG for diagrams and compact static visuals. For quantitative charts, follow the chart module and use responsive Chart.js HTML instead of hand-calculating absolute SVG coordinates. Keep the explanation in normal Markdown and use the visual as supporting evidence.
- Do not paste the SVG/HTML source into the final response after calling the tool. The client hoists the rendered visual beneath the final answer automatically.
<!-- ${APP_NAME}_VISUALS_END -->`;

function visualDesignSpecToolSource(): string {
  return `import { tool } from "@opencode-ai/plugin"

const DESIGN_SPEC = \`# ${APP_NAME} inline visual design spec

- Output one SVG or safe HTML fragment, never a full document.
- SVG root: <svg viewBox="0 0 680 H" width="100%" role="img" aria-label="...">.
- Use a transparent background and responsive width. Keep the height proportional to content.
- Use the host theme tokens: var(--dls-text-primary), var(--dls-text-secondary), var(--dls-surface), var(--dls-surface-muted), var(--dls-border), var(--dls-accent), var(--dls-status-success-fg), var(--dls-status-warning), var(--dls-status-danger).
- Categorical fallbacks when more series are needed: #22A06B, #3B82F6, #E05A33, #7667E8, #C77700.
- Typography: system-ui; sizes 12, 13, 14, or 15px; weights 400 or 500. Titles may use 20-24px / 600 only once.
- Geometry: 8-12px corner radius; 16-24px internal spacing; 1px borders. Avoid gradients, shadows, emoji, decorative noise, and 3D effects.
- Lines and arrows: fill="none"; stroke-width 1.5-2; define arrow markers in <defs> before use.
- Charts must include labels, units, a compact legend, and enough contrast in light and dark themes. Do not rely on color alone.
- Keep important text selectable. Add <title> or aria-label for accessibility.
- SVG must never include scripts or event handlers. HTML may use inline scripts and the chart module's allowlisted CDN, but never iframe, object, embed, form, storage APIs, fixed positioning, or javascript: URLs.
\`

const CHART_SPEC = \`# Chart module (Chart.js)

- Use an HTML fragment with Chart.js for quantitative charts. Do not hand-calculate a large chart as SVG; manual absolute coordinates easily overlap labels, legends, and axes.
- Start with a visually hidden h2 summary, then a compact title/legend, a position:relative wrapper with an explicit pixel height, and a canvas. Set height on the wrapper only.
- Load only https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js, followed by a plain inline script. The widget runs in an isolated CSP iframe.
- Configure responsive:true and maintainAspectRatio:false. For mixed bar/line charts, give percentage series yAxisID:"y1" and amount series yAxisID:"y".
- Disable the default legend and render a compact wrapping HTML legend above the chart. Keep labels and units explicit; do not rely on color alone.
- Keep category count at 12 or fewer. Use ticks.autoSkip:false and maxRotation:45 when every category must remain visible.
- Canvas cannot resolve host CSS variables, so choose accessible light/dark-safe hex colors for datasets and grid lines.
- Metric cards below a chart use one fixed known-count strip: for N cards, write repeat(N,minmax(0,1fr)) with the actual card count in place of N; never use auto-fit or a fixed minimum card width. Use 12px gaps and min-width:0 on every card. Keep labels and values on one line with white-space:nowrap, overflow:hidden, and text-overflow:ellipsis so compact transcript widths do not create an orphan final row.

Minimal structure:
<div><h2 class="sr-only">Chart summary</h2><div aria-hidden="true">Custom legend</div><div style="position:relative;width:100%;height:360px"><canvas id="chart" role="img" aria-label="Chart description">Chart fallback.</canvas></div><script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"><\\/script><script>new Chart(document.getElementById("chart"),{type:"bar",data:{labels:[],datasets:[]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}})<\\/script></div>
\`

export default tool({
  description: "Read the ${APP_NAME} design rules for inline SVG/HTML visuals before calling render_visual. Pass chart for quantitative charts.",
  args: {
    modules: tool.schema.array(tool.schema.enum(["diagram", "mockup", "interactive", "chart", "art"])).min(1).max(5).optional().describe("Every visual module needed for this result"),
  },
  async execute(args) {
    return args.modules?.includes("chart") ? DESIGN_SPEC + "\\n\\n" + CHART_SPEC : DESIGN_SPEC
  },
})
`;
}

function renderVisualToolSource(): string {
  return `import { readFile, realpath } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import { tool } from "@opencode-ai/plugin"

const COMPLETE_DOCUMENT = /<!doctype|<\\/?(?:html|head|body)(?:\\s|>)/i
const BLOCKED_CONTENT = /<\\s*(?:iframe|object|embed|base|meta|link|form)\\b|\\b(?:localStorage|sessionStorage)\\b|position\\s*:\\s*fixed/i
const HTML_ROOT = /^<(?:div|section|article|figure|main|h2|style|canvas)\\b/i
const SCRIPT_TAG = /<script\\b([^>]*)>/gi
const SCRIPT_SRC = /\\bsrc\\s*=\\s*["']([^"']+)["']/i
const ALLOWED_SCRIPT_HOSTS = new Set(["cdnjs.cloudflare.com", "esm.sh", "cdn.jsdelivr.net", "unpkg.com"])
const MAX_SOURCE_LENGTH = 200000

function hasUnsafeScriptSource(source) {
  for (const match of source.matchAll(SCRIPT_TAG)) {
    const scriptSource = (match[1] || "").match(SCRIPT_SRC)?.[1]
    if (!scriptSource) continue
    try {
      const url = new URL(scriptSource)
      if (url.protocol !== "https:" || !ALLOWED_SCRIPT_HOSTS.has(url.hostname)) return true
    } catch {
      return true
    }
  }
  return false
}

export default tool({
  description: "Render a safe SVG or HTML fragment inline in the conversation. For substantial visuals, write a workspace file and pass file_path instead of embedding long widget_code JSON. Call get_design_spec first and keep the normal explanation in the final response.",
  args: {
    title: tool.schema.string().min(1).max(120).describe("Concise visual title and export name"),
    widget_code: tool.schema.string().min(1).max(MAX_SOURCE_LENGTH).optional().describe("A small bare SVG/HTML fragment; omit when file_path is used"),
    file_path: tool.schema.string().min(1).max(500).optional().describe("Workspace-relative path to a substantial .svg or .html fragment; do not read it back into widget_code"),
    loading_messages: tool.schema.array(tool.schema.string().min(1).max(80)).min(1).max(4).optional().describe("One to four short rendering progress labels"),
  },
  async execute(args, context) {
    const inlineSource = args.widget_code?.trim()
    const filePath = args.file_path?.trim()
    if ((!inlineSource && !filePath) || (inlineSource && filePath)) {
      throw new Error("Provide exactly one of widget_code or file_path")
    }

    let source = inlineSource || ""
    if (filePath) {
      if (!/\\.(?:svg|html?)$/i.test(filePath)) {
        throw new Error("file_path must point to a .svg or .html file")
      }
      const workspaceRoot = await realpath(resolve(context.directory || context.worktree || process.cwd()))
      const absolutePath = await realpath(resolve(workspaceRoot, filePath))
      const workspaceRelativePath = relative(workspaceRoot, absolutePath)
      if (!workspaceRelativePath || workspaceRelativePath.startsWith("..") || isAbsolute(workspaceRelativePath)) {
        throw new Error("file_path must stay inside the current workspace")
      }
      source = (await readFile(absolutePath, "utf8")).trim()
    }

    if (!source) throw new Error("Visual source must not be empty")
    if (source.length > MAX_SOURCE_LENGTH) throw new Error("Visual source exceeds the maximum length")
    if (COMPLETE_DOCUMENT.test(source)) throw new Error("Visual source must be a fragment, not a complete HTML document")
    if (BLOCKED_CONTENT.test(source)) throw new Error("Visual source contains content that is not allowed in the widget sandbox")
    if (/^<svg\\b/i.test(source)) {
      if (/<script\\b/i.test(source)) throw new Error("SVG visual source cannot contain scripts")
      if ((source.match(/<svg[\\s>]/gi) || []).length !== 1) throw new Error("SVG visual source must contain exactly one svg element")
      if (!/viewBox\\s*=\\s*["']0\\s+0\\s+680\\s+\\d+["']/i.test(source)) throw new Error("SVG visual source must use a 680px-wide viewBox")
    } else {
      if (!HTML_ROOT.test(source)) throw new Error("HTML visual source must start with a supported fragment root")
      if (hasUnsafeScriptSource(source)) throw new Error("HTML visual source contains a script outside the widget CDN allowlist")
    }
    return JSON.stringify({
      kind: "onmyagent_visual",
      title: args.title.trim(),
      widget_code: source,
      loading_messages: args.loading_messages || [],
    })
  },
})
`;
}

/**
 * Default-language instructions injected into every ${APP_NAME} agent.
 *
 * OpenCode reads the active agent's system prompt to drive every LLM
 * call (including the daemon-side session-title generator that runs
 * after the first assistant response). Without this block, all
 * auto-generated titles, replies and summaries default to English and
 * show up as英文 in the ${APP_NAME} sidebar.
 *
 * Wrapped in ${APP_NAME} comment markers so `ensureOnMyAgentAgent` can
 * keep this block in sync on every workspace reload without touching
 * user-editable content outside the markers.
 */
const ONMYAGENT_LANGUAGE_GUIDANCE = `<!-- ${APP_NAME}_LANGUAGE_START -->
## Language

- Default to **简体中文 (Simplified Chinese)** for all user-facing output: replies, session titles, summaries, and inline mentions of file paths or UI labels.
- If the user continues the conversation in another language, match the user's language for that reply only.
- Keep source code, identifiers, command names, tool names, and anything the user explicitly quotes in its original language.
<!-- ${APP_NAME}_LANGUAGE_END -->`;

const ONMYAGENT_AGENT = `---
description: ${APP_NAME} default agent
mode: primary
temperature: 0.2
---

You are a helpful AI assistant. Your specific name, role, and persona are defined by the calling system — if those instructions are present, always use them instead of inventing an identity.

When the user refers to "you", they mean the current agent and the workspace.

Your job:
- Help the user work on files safely.
- Automate repeatable work.
- Keep behavior portable and reproducible.

${ONMYAGENT_LANGUAGE_GUIDANCE}

<!-- ${APP_NAME}_BROWSER_START -->
## Browser

${APP_NAME} has a built-in browser that agents can control directly.
Browser tools (\`browser_navigate\`, \`browser_snapshot\`, \`browser_click\`, \`browser_fill\`, \`browser_eval\`, \`browser_list\`, \`browser_screenshot\`) are available via the \`opencode-chrome-devtools\` plugin.

**${APP_NAME} Browser**:
- \`browser_url\`: always use \`"http://127.0.0.1:{{BROWSER_CDP_PORT}}"\`.
- Use for browsing tasks. The user sees what you do in real time.
- Always call \`browser_list\` first to discover available targets, then use the appropriate \`target_id\`.
- Choose the built-in browser target (usually \`about:blank\` or the page URL). Do not navigate the ${APP_NAME} app target itself (title \`${APP_NAME}\` or URL containing \`:5173/#/workspace\`).
- If the user asks for personal browser cookies, sign-ins, or installed extensions, explain that only the built-in ${APP_NAME} Browser is currently supported.
<!-- ${APP_NAME}_BROWSER_END -->

## Memory

Two kinds:
1. Behavior memory (shareable, in git): \`.config/opencode/skills/**\`, \`.opencode/agents/**\`, repo docs
2. Private memory (never commit): tokens, credentials, local config, logs

Hard rule: never copy private memory into repo files. Store only redacted summaries, schemas, and stable pointers.

## Working style

- If required setup or credentials are missing, ask one targeted question and continue once provided.
- If you change code, run the smallest meaningful test.
- If steps repeat, factor them into a skill.
- Prefer clear, practical steps over abstract explanations.

${ONMYAGENT_ARTIFACT_GUIDANCE}

${ONMYAGENT_VISUAL_GUIDANCE}
`;

type WorkspaceOnMyAgentConfig = {
  version: number;
  workspace?: {
    name?: string | null;
    createdAt?: number | null;
    preset?: string | null;
  } | null;
  authorizedRoots: string[];
  reload?: {
    auto?: boolean;
    resume?: boolean;
  } | null;
};

type EnsureWorkspaceFilesResult = {
  changed: boolean;
  reloadReasons: ReloadReason[];
};

function normalizePreset(preset: string | null | undefined): string {
  const trimmed = preset?.trim() ?? "";
  if (!trimmed) return "starter";
  return trimmed;
}

function isSchemaOnlyOpencodeConfig(config: Record<string, unknown>): boolean {
  return Object.keys(config).every((key) => key === "$schema");
}

async function ensureWorkspaceOnMyAgentConfig(
  workspaceRoot: string,
  preset: string,
): Promise<boolean> {
  const path = onmyagentConfigPath(workspaceRoot);
  if (await exists(path)) return false;
  const now = Date.now();
  const config: WorkspaceOnMyAgentConfig = {
    version: 1,
    workspace: {
      name: basename(workspaceRoot) || "Workspace",
      createdAt: now,
      preset,
    },
    authorizedRoots: [workspaceRoot],
    reload: null,
  };
  await ensureDir(join(workspaceRoot, ".opencode"));
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf8");
  return true;
}

async function ensureOpencodeConfig(workspaceRoot: string): Promise<boolean> {
  const path = opencodeConfigPath(workspaceRoot);
  if (await exists(path)) {
    await readJsoncFile<Record<string, unknown>>(path, {});
    return false;
  }

  await writeJsoncFile(path, {
    $schema: "https://opencode.ai/config.json",
    default_agent: DEFAULT_OPENCODE_AGENT,
    plugin: [BROWSER_PLUGIN],
  });
  return true;
}

function resolveAgentTemplate(): string {
  const cdpPort =
    process.env.ONMYAGENT_ELECTRON_REMOTE_DEBUG_PORT?.trim() || "9222";
  return ONMYAGENT_AGENT.replace("{{BROWSER_CDP_PORT}}", cdpPort);
}

async function ensureOnMyAgentAgent(workspaceRoot: string): Promise<boolean> {
  const agentsDir = join(workspaceRoot, ".opencode", "agents");
  const agentPath = join(agentsDir, `${DEFAULT_OPENCODE_AGENT}.md`);
  const agentContent = resolveAgentTemplate();
  await ensureDir(agentsDir);
  if (!(await exists(agentPath))) {
    await writeFile(
      agentPath,
      agentContent.endsWith("\n") ? agentContent : `${agentContent}\n`,
      "utf8",
    );
    return true;
  }
  let current = await readFile(agentPath, "utf8");
  let changed = false;

  // Patch identity lines: strip ANY hard-coded "You are OnMyAgent" variants
  // from legacy files. Identity is now injected via the system prompt at
  // runtime, so the .md file must not claim a specific name.
  const NEW_IDENTITY_LINE =
    "You are a helpful AI assistant. Your specific name, role, and persona are defined by the calling system — if those instructions are present, always use them instead of inventing an identity.";
  const legacyIdentityPatterns = [
    `You are ${APP_NAME}.`,
    `You are ${APP_NAME},`,
    `You are an AI assistant built on ${APP_NAME}.`,
    `You are ${APP_NAME}, the user's AI coding assistant`,
  ];
  for (const pattern of legacyIdentityPatterns) {
    const idx = current.indexOf(pattern);
    if (idx >= 0) {
      // Find the full line boundaries for replacement
      const lineStart = current.lastIndexOf("\n", idx - 1) + 1;
      let lineEnd = current.indexOf("\n", idx);
      if (lineEnd < 0) lineEnd = current.length;
      current =
        current.slice(0, lineStart) +
        NEW_IDENTITY_LINE +
        current.slice(lineEnd);
      changed = true;
      break;
    }
  }

  // Patch artifacts section
  const artStart = `<!-- ${APP_NAME}_ARTIFACTS_START -->`;
  const artEnd = `<!-- ${APP_NAME}_ARTIFACTS_END -->`;
  const artStartIdx = current.indexOf(artStart);
  const artEndIdx = current.indexOf(artEnd);
  if (artStartIdx >= 0 && artEndIdx > artStartIdx) {
    const patched = `${current.slice(0, artStartIdx)}${ONMYAGENT_ARTIFACT_GUIDANCE}${current.slice(artEndIdx + artEnd.length)}`;
    if (patched !== current) {
      current = patched;
      changed = true;
    }
  } else {
    current = `${current.trimEnd()}\n\n${ONMYAGENT_ARTIFACT_GUIDANCE}\n`;
    changed = true;
  }

  const visualStart = `<!-- ${APP_NAME}_VISUALS_START -->`;
  const visualEnd = `<!-- ${APP_NAME}_VISUALS_END -->`;
  const visualStartIdx = current.indexOf(visualStart);
  const visualEndIdx = current.indexOf(visualEnd);
  if (visualStartIdx >= 0 && visualEndIdx > visualStartIdx) {
    const patched = `${current.slice(0, visualStartIdx)}${ONMYAGENT_VISUAL_GUIDANCE}${current.slice(visualEndIdx + visualEnd.length)}`;
    if (patched !== current) {
      current = patched;
      changed = true;
    }
  } else {
    current = `${current.trimEnd()}\n\n${ONMYAGENT_VISUAL_GUIDANCE}\n`;
    changed = true;
  }

  // Patch browser section (replace with resolved CDP port)
  const browserStart = `<!-- ${APP_NAME}_BROWSER_START -->`;
  const browserEnd = `<!-- ${APP_NAME}_BROWSER_END -->`;
  const bsIdx = current.indexOf(browserStart);
  const beIdx = current.indexOf(browserEnd);
  const resolvedBrowser = agentContent.slice(
    agentContent.indexOf(browserStart),
    agentContent.indexOf(browserEnd) + browserEnd.length,
  );
  if (bsIdx >= 0 && beIdx > bsIdx) {
    const oldBrowser = current.slice(bsIdx, beIdx + browserEnd.length);
    if (oldBrowser !== resolvedBrowser) {
      current =
        current.slice(0, bsIdx) +
        resolvedBrowser +
        current.slice(beIdx + browserEnd.length);
      changed = true;
    }
  }

  // Patch language section (insert near the top, replace if present,
  // append before the first known heading if this agent file predates
  // the language block).
  const langStart = `<!-- ${APP_NAME}_LANGUAGE_START -->`;
  const langEnd = `<!-- ${APP_NAME}_LANGUAGE_END -->`;
  const langStartIdx = current.indexOf(langStart);
  const langEndIdx = current.indexOf(langEnd);
  const resolvedLanguage = agentContent.slice(
    agentContent.indexOf(langStart),
    agentContent.indexOf(langEnd) + langEnd.length,
  );
  if (langStartIdx >= 0 && langEndIdx > langStartIdx) {
    const oldLang = current.slice(
      langStartIdx,
      langEndIdx + langEnd.length,
    );
    if (oldLang !== resolvedLanguage) {
      current =
        current.slice(0, langStartIdx) +
        resolvedLanguage +
        current.slice(langEndIdx + langEnd.length);
      changed = true;
    }
  } else {
    // Pick a stable anchor right before the first section we know about
    // so the block lands near "Your job:" where the template puts it.
    const anchors = [
      `<!-- ${APP_NAME}_BROWSER_START -->`,
      "## Browser",
      "## Memory",
      "## Working style",
    ];
    const anchor = anchors.find((marker) => current.includes(marker));
    if (anchor) {
      const insertAt = current.indexOf(anchor);
      current =
        current.slice(0, insertAt) +
        resolvedLanguage +
        "\n\n" +
        current.slice(insertAt);
    } else {
      current = `${current.trimEnd()}\n\n${resolvedLanguage}\n`;
    }
    changed = true;
  }

  if (changed) {
    await writeFile(agentPath, current, "utf8");
    return true;
  }
  return false;
}

async function ensureVisualTools(workspaceRoot: string): Promise<boolean> {
  const toolsDir = join(workspaceRoot, ".opencode", "tools");
  await ensureDir(toolsDir);
  const managedTools = [
    ["get_design_spec.ts", visualDesignSpecToolSource()],
    ["render_visual.ts", renderVisualToolSource()],
  ] as const;
  let changed = false;

  for (const [name, source] of managedTools) {
    const path = join(toolsDir, name);
    const content = source.endsWith("\n") ? source : `${source}\n`;
    const current = await readFile(path, "utf8").catch(() => null);
    if (current === content) continue;
    await writeFile(path, content, "utf8");
    changed = true;
  }

  return changed;
}

async function ensureBrowserPlugin(workspaceRoot: string): Promise<boolean> {
  const configPath = opencodeConfigPath(workspaceRoot);
  const { data: config } = await readJsoncFile<Record<string, unknown>>(
    configPath,
    {},
  );

  const hasPlugin =
    Array.isArray(config.plugin) &&
    (config.plugin as string[]).includes(BROWSER_PLUGIN);
  const mcp =
    typeof config.mcp === "object" && config.mcp !== null
      ? (config.mcp as Record<string, unknown>)
      : null;
  const hasLegacyMcps = mcp
    ? LEGACY_BROWSER_MCP_KEYS.some((key) => key in mcp)
    : false;
  const shouldClaimDesktopCreatedConfig =
    (await exists(onmyagentConfigPath(workspaceRoot))) &&
    isSchemaOnlyOpencodeConfig(config);
  const isOnMyAgentOwned =
    config.default_agent === DEFAULT_OPENCODE_AGENT ||
    shouldClaimDesktopCreatedConfig;

  if (hasPlugin && !hasLegacyMcps) return false;

  const updates: Record<string, unknown> = {};

  // Add the plugin if missing (only for OnMyAgent-owned workspaces or legacy migrations)
  if (!hasPlugin && (isOnMyAgentOwned || hasLegacyMcps)) {
    const existing = Array.isArray(config.plugin)
      ? (config.plugin as string[])
      : [];
    updates.plugin = [...existing, BROWSER_PLUGIN];
  }

  if (shouldClaimDesktopCreatedConfig) {
    updates.default_agent = DEFAULT_OPENCODE_AGENT;
  }

  if (!Object.keys(updates).length && !hasLegacyMcps) return false;

  if (Object.keys(updates).length) {
    await updateJsoncTopLevel(configPath, updates);
  }

  // Remove stale MCP entries individually to avoid clobbering other keys
  if (hasLegacyMcps && mcp) {
    for (const key of LEGACY_BROWSER_MCP_KEYS) {
      if (key in mcp) {
        await updateJsoncPath(configPath, ["mcp", key], undefined);
      }
    }
  }

  return true;
}

export async function ensureWorkspaceFiles(
  workspaceRoot: string,
  presetInput: string,
): Promise<EnsureWorkspaceFilesResult> {
  const preset = normalizePreset(presetInput);
  if (!workspaceRoot.trim()) {
    throw new ApiError(
      400,
      "invalid_workspace_path",
      "workspace path is required",
    );
  }
  await ensureDir(workspaceRoot);
  const reloadReasons = new Set<ReloadReason>();
  if (await ensureOpencodeConfig(workspaceRoot)) reloadReasons.add("config");
  if (await ensureBrowserPlugin(workspaceRoot)) reloadReasons.add("config");
  if (await ensureOnMyAgentAgent(workspaceRoot)) reloadReasons.add("agents");
  if (await ensureVisualTools(workspaceRoot)) reloadReasons.add("commands");
  const onmyagentConfigChanged = await ensureWorkspaceOnMyAgentConfig(
    workspaceRoot,
    preset,
  );
  return {
    changed: onmyagentConfigChanged || reloadReasons.size > 0,
    reloadReasons: Array.from(reloadReasons),
  };
}

export async function readRawOpencodeConfig(
  path: string,
): Promise<{ exists: boolean; content: string | null }> {
  const hasFile = await exists(path);
  if (!hasFile) {
    return { exists: false, content: null };
  }
  const content = await readFile(path, "utf8");
  return { exists: true, content };
}
