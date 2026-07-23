import type { UIMessage } from "ai";

import type { Locale } from "@/i18n";

type UIMessagePart = UIMessage["parts"][number];

export type ProgressNarrationIntent =
  | "command"
  | "edit"
  | "generic"
  | "plan"
  | "read"
  | "search"
  | "skill"
  | "task"
  | "visual"
  | "web";

export type ProgressNarrationMessageKey =
  `session.progress_narration.${ProgressNarrationIntent}_${"start" | "continue"}`;

export type ProgressNarrationStep = {
  intent: ProgressNarrationIntent;
  target: string | null;
};

export type ProgressNarrationTransitionMessageKey =
  | `session.progress_narration.completed_${ProgressNarrationIntent}`
  | `session.progress_narration.next_${ProgressNarrationIntent}`
  | "session.progress_narration.completed_read_target"
  | "session.progress_narration.completed_skill_target"
  | "session.progress_narration.next_read_target"
  | "session.progress_narration.next_skill_target";

function toolName(part: UIMessagePart): string | null {
  if (part.type === "dynamic-tool") return part.toolName.trim().toLowerCase();
  if (part.type.startsWith("tool-")) return part.type.slice("tool-".length).toLowerCase();
  return null;
}

export function isTranscriptToolPart(part: UIMessagePart): boolean {
  return toolName(part) !== null;
}

const CJK_CHARACTER_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/u;
const LATIN_CHARACTER_PATTERN = /[A-Za-z]/g;

export function isWrongLanguageProgressNarration(
  text: string,
  locale: Locale,
): boolean {
  if (locale === "en" || CJK_CHARACTER_PATTERN.test(text)) return false;
  return (text.match(LATIN_CHARACTER_PATTERN)?.length ?? 0) >= 8;
}

export function progressNarrationKey(
  part: UIMessagePart,
  position: "start" | "continue",
): ProgressNarrationMessageKey {
  const intent = progressNarrationIntent(part);
  return `session.progress_narration.${intent}_${position}`;
}

function progressNarrationIntent(part: UIMessagePart): ProgressNarrationIntent {
  const name = toolName(part) ?? "";
  let intent: ProgressNarrationIntent = "generic";

  if (/visual|widget|chart|diagram|render/.test(name)) intent = "visual";
  else if (/browser|playwright|puppeteer|chrome|webfetch|web_fetch|fetch_url|computer/.test(name)) intent = "web";
  else if (/skill/.test(name)) intent = "skill";
  else if (/subtask|taskcreate|taskupdate|taskrun|delegate/.test(name)) intent = "task";
  else if (/todowrite|todoread|todo_|plancreate|planupdate/.test(name)) intent = "plan";
  else if (/apply_patch|patch|write|edit|replace|append/.test(name)) intent = "edit";
  else if (/read|cat|view_file/.test(name)) intent = "read";
  else if (/grep|glob|search|find/.test(name)) intent = "search";
  else if (/bash|shell|terminal|command|exec|repl/.test(name)) intent = "command";

  return intent;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function inputValue(part: UIMessagePart): Record<string, unknown> | null {
  return "input" in part ? recordValue(part.input) : null;
}

function stringValue(input: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = input?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function basename(value: string) {
  const normalized = value.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) || normalized;
}

export function progressNarrationStep(part: UIMessagePart): ProgressNarrationStep {
  const intent = progressNarrationIntent(part);
  const input = inputValue(part);
  const target = intent === "skill"
    ? stringValue(input, ["name", "skill", "skillName", "skill_name"])
    : intent === "read"
      ? stringValue(input, ["filePath", "file_path", "path", "file"])
      : null;
  return {
    intent,
    target: target ? basename(target) : null,
  };
}

export function completedProgressNarrationStep(
  part: UIMessagePart,
): ProgressNarrationStep | null {
  if (!("state" in part) || part.state !== "output-available") return null;
  return progressNarrationStep(part);
}

export function progressNarrationTransitionKey(
  phase: "completed" | "next",
  step: ProgressNarrationStep,
): ProgressNarrationTransitionMessageKey {
  if ((step.intent === "read" || step.intent === "skill") && step.target) {
    return `session.progress_narration.${phase}_${step.intent}_target`;
  }
  return `session.progress_narration.${phase}_${step.intent}`;
}
