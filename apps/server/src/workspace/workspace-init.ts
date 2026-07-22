import { basename, join } from "node:path";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";

import { ensureDir, exists } from "../core/utils.js";
import { ApiError } from "../core/errors.js";
import { isBrowserAutomationEnabled } from "../services/browser-plugin-enablement.js";
import { buildArtifactPluginGuidance } from "../services/artifact-plugin-guidance.js";
import { opencodeBrowserNodeReplToolSource } from "./browser-tool-source.js";
import {
  visualDesignSpecToolSource,
  visualizerReadMeToolSource,
} from "./visualizer-tool-source.js";
import { onmyagentConfigPath, opencodeConfigPath } from "./workspace-files.js";
import {
  readJsoncFile,
  updateJsoncTopLevel,
  writeJsoncFile,
} from "../core/jsonc.js";
import type { ReloadReason } from "@onmyagent/types/server";
import { APP_NAME, APP_NAME_LOWER } from "../core/brand.js";

const DEFAULT_OPENCODE_AGENT = APP_NAME_LOWER;

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

const ONMYAGENT_PRESENTATION_GUIDANCE = `<!-- ${APP_NAME}_PRESENTATION_START -->
## User-facing presentation

- Do not mention specific tool names in user-facing replies or status descriptions. Describe the action and result in natural language.
- Intermediate tool calls, observations, reasoning, and progress may be folded or hidden. The final reply must stand on its own and restate every substantive result the user needs, including important outputs or changed files, findings, conclusions, errors, unresolved risks, and next steps when relevant.
- Explicit requests to show, visualize, diagram, chart, draw, or graph require an inline visual when no file artifact or specialized connected tool is the intended destination; the same applies when the user asks to illustrate something or asks what it looks like. First read the relevant visual design module, then call \`render_visual\`.
- Always use an inline visual for educational or teaching requests when no file artifact or specialized connected tool is intended, except for a pure dictionary-style word-definition lookup.
- Data comparisons and architecture or system design requests should proactively use an inline chart or diagram when the visual communicates the structure more clearly than prose.
- A noun-phrase specification of a visual artifact is itself a render request even when it has no verb. Render specifications such as a comparison table, timeline, form, or state machine instead of substituting a prose description or Markdown table.
- Between multiple visuals, write a short paragraph that explains the next visual and connects it to the previous one.
- Never expose the visual machinery. Use a natural preamble, and do not paste generated SVG or HTML source into the reply.

### Progress narration

- Use user-facing body text as the boundary between meaningful stages of tool-backed work. Before the first operation group, write one or two short, natural sentences that acknowledge the goal, state your immediate intent, and say what you will do next.
- After receiving a material result and before starting the next operation group, write a new short paragraph that states the useful outcome of the previous stage and the next action. When something fails, state the obstacle briefly and explain the recovery action instead of exposing raw diagnostics.
- Every visible process fold should therefore have preceding body text that lets the user follow the work from top to bottom without opening the fold. Do not put progress narration inside reasoning content.
- Related low-level calls that serve one stage may share one preceding paragraph. Do not narrate every low-level call; start a new paragraph when the result, direction, or immediate goal changes.
- Keep each progress paragraph to one or two sentences. Do not restate the full user request, expose internal reasoning, name specific tools or skills, recite arguments, or paste raw tool output.
- Output these explanations directly as assistant body text. Never use a shell command, tool result, fold label, or synthetic UI summary to communicate them.

Required message rhythm (the labels describe structure only and must not be copied into the reply):

\`Text -> operation group -> text -> operation group\`

- Text: "I'll open the requested site and get to the first post. First I'll prepare browser access."
- Operation group: prepare browser access.
- Text: "Browser access is ready. Next I'll open the site and locate the first post."
- Operation group: open and inspect the site.
<!-- ${APP_NAME}_PRESENTATION_END -->`;

const ONMYAGENT_VISUAL_GUIDANCE = `<!-- ${APP_NAME}_VISUALS_START -->
## Inline visuals

${APP_NAME} can render safe SVG/HTML fragments directly inside the completed assistant response.

- When a chart, architecture diagram, process, comparison, timeline, or metric dashboard communicates the result more clearly than prose alone, call \`read_me\` with every relevant module and then \`render_visual\`. For charts, request \`modules: ["chart"]\`.
- Pass a concise title. Use \`widget_code\` only for a small fragment; for a substantial visual, write one \`.svg\` or \`.html\` file in the workspace and pass its workspace-relative path as \`file_path\`. Do not read the file back into the tool call.
- If writing a large visual risks an incomplete tool call, create or update the file in smaller chunks before calling \`render_visual\`. Never send a complete HTML document, iframe, form, event handler, storage access, or script outside the chart module's CDN allowlist.
- Prefer responsive SVG for diagrams and compact static visuals. For quantitative charts, follow the chart module and use responsive Chart.js HTML instead of hand-calculating absolute SVG coordinates. Keep the explanation in normal Markdown and use the visual as supporting evidence.
- Do not paste the SVG/HTML source into the final response after calling the tool. The client hoists the rendered visual beneath the final answer automatically.
<!-- ${APP_NAME}_VISUALS_END -->`;

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
  description: "Render a safe SVG or HTML fragment inline in the conversation. For substantial visuals, write a workspace file and pass file_path instead of embedding long widget_code JSON. Call read_me first and keep the normal explanation in the final response.",
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

const ONMYAGENT_BROWSER_AUTOMATION_GUIDANCE = `<!-- ${APP_NAME}_BROWSER_AUTOMATION_START -->
## Browser automation

${APP_NAME} has a built-in in-app browser. For any web task (open a site, search, read or fill a page, scrape content), drive it directly instead of asking the user to browse manually.

- Invoke the Browser plugin skill (\`browser-automation\`) for the full API. The single tool is \`onmyagent_browser_node_repl\`; state persists for the session, so keep Browser/Tab handles in variables across calls.
- Entry point: \`globalThis.browser ??= await agent.browsers.getDefault()\`, then \`globalThis.tab ??= await browser.tabs.new({ url })\` (fast direct open when the URL is known).
- Return plain JSON from the tool (e.g. \`{ id: tab.id, url: await tab.url() }\`). Do not expect \`return tab\` to print a full object.
- Use \`tab.playwright.waitForLoadState\` / \`waitForURL\` — there is no top-level \`tab.waitForLoadState\`.
- The built-in browser needs no URL or port from you. Never invent localhost endpoints, CDP, the \`opencode-chrome-devtools\` plugin, or any external browser tool.
- Finalize temporary tabs when the task is done; leave user-owned tabs open unless the user asks otherwise.
<!-- ${APP_NAME}_BROWSER_AUTOMATION_END -->`;

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

${ONMYAGENT_PRESENTATION_GUIDANCE}

${ONMYAGENT_BROWSER_AUTOMATION_GUIDANCE}

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

// Agents that opencode ships built in; they resolve without a workspace
// agent file, so a default_agent pointing at them is always valid.
const BUILTIN_OPENCODE_AGENTS = new Set([
  "build",
  "plan",
  "general",
  "explore",
  "compaction",
  "title",
  "summary",
]);

// Legacy builds loaded the built-in browser through this CDP plugin (the
// 127.0.0.1:9823 path). Browsing now goes through the managed
// onmyagent_browser_node_repl tool, so the plugin entry is retired.
const LEGACY_BROWSER_PLUGIN = "opencode-chrome-devtools";

function isLegacyBrowserPlugin(entry: unknown): boolean {
  return (
    typeof entry === "string" &&
    (entry === LEGACY_BROWSER_PLUGIN ||
      entry.startsWith(`${LEGACY_BROWSER_PLUGIN}@`))
  );
}

async function ensureOpencodeConfig(workspaceRoot: string): Promise<boolean> {
  const path = opencodeConfigPath(workspaceRoot);
  if (!(await exists(path))) {
    await writeJsoncFile(path, {
      $schema: "https://opencode.ai/config.json",
      default_agent: DEFAULT_OPENCODE_AGENT,
    });
    return true;
  }

  const { data: config } = await readJsoncFile<Record<string, unknown>>(path, {});

  // Only repair configs in workspaces the desktop app manages (marked by
  // .opencode/onmyagent.json). External projects opened as workspaces keep
  // their own opencode.jsonc byte-for-byte untouched.
  if (!(await exists(onmyagentConfigPath(workspaceRoot)))) return false;

  const defaultAgent =
    typeof config.default_agent === "string"
      ? config.default_agent.trim()
      : "";
  if (!defaultAgent) {
    // Only stamp desktop-created schema-only configs. A config that carries
    // real user keys (plugin, provider, ...) but no default_agent belongs to
    // an external project and must stay byte-for-byte stable across route
    // reads — import previews fingerprint it.
    const schemaOnly = Object.keys(config).every((key) => key === "$schema");
    if (!schemaOnly) return false;
    await updateJsoncTopLevel(path, { default_agent: DEFAULT_OPENCODE_AGENT });
    return false;
  }

  let changed = false;
  if (
    defaultAgent !== DEFAULT_OPENCODE_AGENT &&
    !BUILTIN_OPENCODE_AGENTS.has(defaultAgent) &&
    !(await exists(
      join(workspaceRoot, ".opencode", "agents", `${defaultAgent}.md`),
    ))
  ) {
    // A default_agent left behind by another brand build (teamwork, …)
    // whose agent file no longer exists makes every prompt fail with
    // `default agent "<name>" not found`. Fall back to the managed agent.
    await updateJsoncTopLevel(path, { default_agent: DEFAULT_OPENCODE_AGENT });
    changed = true;
  }

  if (Array.isArray(config.plugin)) {
    const plugins = config.plugin.filter(
      (entry) => !isLegacyBrowserPlugin(entry),
    );
    if (plugins.length !== config.plugin.length) {
      // jsonc-parser removes the key when the value is undefined.
      await updateJsoncTopLevel(path, {
        plugin: plugins.length > 0 ? plugins : undefined,
      });
      changed = true;
    }
  }

  return changed;
}

function resolveAgentTemplate(): string {
  return ONMYAGENT_AGENT;
}

async function ensureOnMyAgentAgent(
  workspaceRoot: string,
  browserEnabled: boolean,
  artifactPluginGuidance: string | undefined,
): Promise<boolean> {
  const agentsDir = join(workspaceRoot, ".opencode", "agents");
  const agentPath = join(agentsDir, `${DEFAULT_OPENCODE_AGENT}.md`);
  const agentContent = resolveAgentTemplate();
  await ensureDir(agentsDir);
  if (!(await exists(agentPath))) {
    let initial = agentContent.endsWith("\n") ? agentContent : `${agentContent}\n`;
    if (!browserEnabled) {
      const start = `<!-- ${APP_NAME}_BROWSER_AUTOMATION_START -->`;
      const end = `<!-- ${APP_NAME}_BROWSER_AUTOMATION_END -->`;
      const startIdx = initial.indexOf(start);
      const endIdx = initial.indexOf(end);
      if (startIdx >= 0 && endIdx > startIdx) {
        initial = `${initial.slice(0, startIdx).trimEnd()}\n\n${initial.slice(endIdx + end.length).trimStart()}`;
        if (!initial.endsWith("\n")) initial = `${initial}\n`;
      }
    }
    if (artifactPluginGuidance) {
      initial = `${initial.trimEnd()}\n\n<!-- ${APP_NAME}_FILE_CONNECTORS_START -->\n${artifactPluginGuidance}\n<!-- ${APP_NAME}_FILE_CONNECTORS_END -->\n`;
    }
    await writeFile(agentPath, initial, "utf8");
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

  const presentationStart = `<!-- ${APP_NAME}_PRESENTATION_START -->`;
  const presentationEnd = `<!-- ${APP_NAME}_PRESENTATION_END -->`;
  const presentationStartIdx = current.indexOf(presentationStart);
  const presentationEndIdx = current.indexOf(presentationEnd);
  if (
    presentationStartIdx >= 0 &&
    presentationEndIdx > presentationStartIdx
  ) {
    const patched = `${current.slice(0, presentationStartIdx)}${ONMYAGENT_PRESENTATION_GUIDANCE}${current.slice(presentationEndIdx + presentationEnd.length)}`;
    if (patched !== current) {
      current = patched;
      changed = true;
    }
  } else {
    current = `${current.trimEnd()}\n\n${ONMYAGENT_PRESENTATION_GUIDANCE}\n`;
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

  // Patch browser automation section (uses a distinct marker so the legacy
  // *_BROWSER_START retire pass leaves it in place). When the Browser
  // artifact plugin is disabled, strip the block so agents stop using it.
  const browserAutoStart = `<!-- ${APP_NAME}_BROWSER_AUTOMATION_START -->`;
  const browserAutoEnd = `<!-- ${APP_NAME}_BROWSER_AUTOMATION_END -->`;
  const browserAutoStartIdx = current.indexOf(browserAutoStart);
  const browserAutoEndIdx = current.indexOf(browserAutoEnd);
  if (browserEnabled) {
    if (browserAutoStartIdx >= 0 && browserAutoEndIdx > browserAutoStartIdx) {
      const patched = `${current.slice(0, browserAutoStartIdx)}${ONMYAGENT_BROWSER_AUTOMATION_GUIDANCE}${current.slice(browserAutoEndIdx + browserAutoEnd.length)}`;
      if (patched !== current) {
        current = patched;
        changed = true;
      }
    } else {
      current = `${current.trimEnd()}\n\n${ONMYAGENT_BROWSER_AUTOMATION_GUIDANCE}\n`;
      changed = true;
    }
  } else if (browserAutoStartIdx >= 0 && browserAutoEndIdx > browserAutoStartIdx) {
    current = `${current.slice(0, browserAutoStartIdx).trimEnd()}\n\n${current.slice(browserAutoEndIdx + browserAutoEnd.length).trimStart()}`;
    changed = true;
  }

  const fileConnectorsStart = `<!-- ${APP_NAME}_FILE_CONNECTORS_START -->`;
  const fileConnectorsEnd = `<!-- ${APP_NAME}_FILE_CONNECTORS_END -->`;
  const fileConnectorsStartIdx = current.indexOf(fileConnectorsStart);
  const fileConnectorsEndIdx = current.indexOf(fileConnectorsEnd);
  const fileConnectorsBlock = artifactPluginGuidance
    ? `${fileConnectorsStart}\n${artifactPluginGuidance}\n${fileConnectorsEnd}`
    : undefined;
  if (fileConnectorsBlock) {
    if (fileConnectorsStartIdx >= 0 && fileConnectorsEndIdx > fileConnectorsStartIdx) {
      const patched = `${current.slice(0, fileConnectorsStartIdx)}${fileConnectorsBlock}${current.slice(fileConnectorsEndIdx + fileConnectorsEnd.length)}`;
      if (patched !== current) {
        current = patched;
        changed = true;
      }
    } else {
      current = `${current.trimEnd()}\n\n${fileConnectorsBlock}\n`;
      changed = true;
    }
  } else if (fileConnectorsStartIdx >= 0 && fileConnectorsEndIdx > fileConnectorsStartIdx) {
    current = `${current.slice(0, fileConnectorsStartIdx).trimEnd()}\n\n${current.slice(fileConnectorsEndIdx + fileConnectorsEnd.length).trimStart()}`;
    changed = true;
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
    // Prefer early section headings. Do not use bare "## Browser" — it
    // false-matches "## Browser automation" which is often near the end.
    const anchors = [
      "## Memory",
      "## Working style",
      "## Browser automation",
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

// The built-in browser prompt is retired for every agent, regardless of the
// brand marker it was written with (OnMyAgent, TeamWork, prior product names, …).
// Older builds stamped the block into custom agent files too, so scan all of
// `.opencode/agents/*.md` instead of only the managed default agent.
const LEGACY_BROWSER_PROMPT_PATTERN =
  /[ \t]*<!--\s*[A-Za-z0-9_-]+_BROWSER_START\s*-->[\s\S]*?<!--\s*[A-Za-z0-9_-]+_BROWSER_END\s*-->\n?/g;

async function retireLegacyBrowserPrompts(workspaceRoot: string): Promise<boolean> {
  const agentsDir = join(workspaceRoot, ".opencode", "agents");
  if (!(await exists(agentsDir))) return false;
  let changed = false;
  for (const entry of await readdir(agentsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const path = join(agentsDir, entry.name);
    const current = await readFile(path, "utf8");
    const next = current.replace(LEGACY_BROWSER_PROMPT_PATTERN, "");
    if (next === current) continue;
    await writeFile(path, next, "utf8");
    changed = true;
  }
  return changed;
}

async function ensureVisualTools(
  workspaceRoot: string,
  browserEnabled: boolean,
): Promise<boolean> {
  const toolsDir = join(workspaceRoot, ".opencode", "tools");
  await ensureDir(toolsDir);
  const managedTools: Array<[string, string]> = [
    ["read_me.ts", visualizerReadMeToolSource()],
    ["get_design_spec.ts", visualDesignSpecToolSource(APP_NAME)],
    ["render_visual.ts", renderVisualToolSource()],
  ];
  if (browserEnabled) {
    managedTools.push([
      "onmyagent_browser_node_repl.ts",
      opencodeBrowserNodeReplToolSource(),
    ]);
  }
  let changed = false;

  for (const [name, source] of managedTools) {
    const path = join(toolsDir, name);
    const content = source.endsWith("\n") ? source : `${source}\n`;
    const current = await readFile(path, "utf8").catch(() => null);
    if (current === content) continue;
    await writeFile(path, content, "utf8");
    changed = true;
  }

  if (!browserEnabled) {
    const browserToolPath = join(toolsDir, "onmyagent_browser_node_repl.ts");
    if (await exists(browserToolPath)) {
      await rm(browserToolPath, { force: true });
      changed = true;
    }
  }

  return changed;
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
  const browserEnabled = await isBrowserAutomationEnabled();
  const artifactPluginGuidance = await buildArtifactPluginGuidance();
  const reloadReasons = new Set<ReloadReason>();
  if (await ensureOpencodeConfig(workspaceRoot)) reloadReasons.add("config");
  if (
    await ensureOnMyAgentAgent(
      workspaceRoot,
      browserEnabled,
      artifactPluginGuidance,
    )
  ) {
    reloadReasons.add("agents");
  }
  if (await retireLegacyBrowserPrompts(workspaceRoot)) reloadReasons.add("agents");
  if (await ensureVisualTools(workspaceRoot, browserEnabled)) {
    reloadReasons.add("commands");
  }
  const onmyagentConfigChanged = await ensureWorkspaceOnMyAgentConfig(
    workspaceRoot,
    preset,
  );
  return {
    changed: onmyagentConfigChanged || reloadReasons.size > 0,
    reloadReasons: Array.from(reloadReasons),
  };
}

/**
 * Re-apply managed `.opencode` agents/tools/config for every workspace.
 * Used on desktop/server boot so product updates (browser tool, agent
 * guidance, etc.) land without requiring the user to recreate the workspace.
 * Failures are isolated per workspace so one bad path cannot block startup.
 */
export async function ensureAllWorkspaceFiles(
  workspaces: Array<{ path: string; preset?: string | null; id?: string }>,
  options?: {
    log?: (level: "info" | "warn", message: string, meta?: Record<string, unknown>) => void;
  },
): Promise<{
  ok: number;
  failed: number;
  changed: number;
  errors: Array<{ path: string; message: string }>;
}> {
  let ok = 0;
  let failed = 0;
  let changed = 0;
  const errors: Array<{ path: string; message: string }> = [];
  for (const workspace of workspaces) {
    const workspacePath = String(workspace.path ?? "").trim();
    if (!workspacePath) continue;
    try {
      const result = await ensureWorkspaceFiles(
        workspacePath,
        workspace.preset ?? "starter",
      );
      ok += 1;
      if (result.changed) changed += 1;
      options?.log?.("info", "workspace .opencode refreshed", {
        workspaceId: workspace.id,
        path: workspacePath,
        changed: result.changed,
        reloadReasons: result.reloadReasons,
      });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ path: workspacePath, message });
      options?.log?.("warn", "workspace .opencode refresh failed", {
        workspaceId: workspace.id,
        path: workspacePath,
        error: message,
      });
    }
  }
  return { ok, failed, changed, errors };
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
