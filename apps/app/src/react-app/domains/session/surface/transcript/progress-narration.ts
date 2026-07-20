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

  return `session.progress_narration.${intent}_${position}`;
}
