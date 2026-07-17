import { basename, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { ensureDir, exists } from "../core/utils.js";
import { ApiError } from "../core/errors.js";
import { onmyagentConfigPath, opencodeConfigPath } from "./workspace-files.js";
import {
  readJsoncFile,
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
<!-- ${APP_NAME}_ARTIFACTS_END -->`;

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

async function ensureOpencodeConfig(workspaceRoot: string): Promise<boolean> {
  const path = opencodeConfigPath(workspaceRoot);
  if (await exists(path)) {
    await readJsoncFile<Record<string, unknown>>(path, {});
    return false;
  }

  await writeJsoncFile(path, {
    $schema: "https://opencode.ai/config.json",
    default_agent: DEFAULT_OPENCODE_AGENT,
  });
  return true;
}

function resolveAgentTemplate(): string {
  return ONMYAGENT_AGENT;
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

  // Remove the retired browser prompt from workspaces created by older builds.
  const browserStart = `<!-- ${APP_NAME}_BROWSER_START -->`;
  const browserEnd = `<!-- ${APP_NAME}_BROWSER_END -->`;
  const bsIdx = current.indexOf(browserStart);
  const beIdx = current.indexOf(browserEnd);
  if (bsIdx >= 0 && beIdx > bsIdx) {
    current = `${current.slice(0, bsIdx).trimEnd()}\n\n${current.slice(beIdx + browserEnd.length).trimStart()}`;
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
    const anchors = [
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
  if (await ensureOnMyAgentAgent(workspaceRoot)) reloadReasons.add("agents");
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
