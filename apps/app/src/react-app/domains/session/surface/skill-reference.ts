/**
 * Collapse skill / slash payloads in the transcript into { name, arguments }
 * so the UI can show a compact chip instead of the full engine expansion.
 */

export type SkillReference = {
  name: string;
  arguments: string;
};

function parseExpandedSkillReference(text: string): SkillReference | null {
  const frontmatter = text.match(
    /^---\s*\r?\n[\s\S]*?\bname:\s*["']?([A-Za-z0-9][\w.-]*)["']?\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/,
  );
  const name = frontmatter?.[1];
  if (!name) return null;

  const lines = text.trimEnd().split(/\r?\n/);
  const trailing: string[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      if (trailing.length > 0) break;
      continue;
    }
    if (
      trimmed.startsWith("#") ||
      trimmed.startsWith(">") ||
      trimmed.startsWith("- ") ||
      trimmed.startsWith("* ") ||
      trimmed.startsWith("```") ||
      trimmed.startsWith("|") ||
      /^\d+\.\s/.test(trimmed)
    ) {
      break;
    }
    trailing.unshift(line);
  }

  const args = trailing.join("\n").trim();
  if (!args || args === text.trim()) return null;
  return { name, arguments: args };
}

/**
 * Collapse harness-expanded skill payloads into a chip + user args.
 *
 *   <auto-slash-command>
 *   # /antd Command
 *   **Description**: ...
 *   **User Arguments**: what skill are you
 *   **Scope**: skill
 *   ---
 *   ## Command Instructions
 *   ...
 *   </auto-slash-command>
 */
export function parseAutoSlashCommandReference(
  text: string,
): SkillReference | null {
  const raw = text.trim();
  if (!raw) return null;

  const looksLikeAutoSlash =
    /auto-slash-command/i.test(raw) ||
    /#\s*\/[A-Za-z0-9][\w.-]*(?:\s+Command)?\b/i.test(raw) ||
    /\*\*User Arguments\*\*/i.test(raw);

  const tagged =
    raw.match(
      /<auto-slash-command\b[^>]*>\s*([\s\S]*?)\s*<\/auto-slash-command>/i,
    )?.[1] ??
    (looksLikeAutoSlash
      ? raw.replace(/<\/?auto-slash-command\b[^>]*>/gi, "").trim()
      : null);
  if (!tagged) return null;

  const nameMatch =
    tagged.match(/#\s*\/([A-Za-z0-9][\w.-]*)(?:\s+Command)?\b/i) ??
    tagged.match(/\bname:\s*["']?([A-Za-z0-9][\w.-]*)["']?/i);
  const name = nameMatch?.[1]?.trim();
  if (!name) return null;

  const argsMatch = tagged.match(
    /\*\*User Arguments\*\*\s*:\s*([\s\S]*?)(?=\n\s*\*\*[A-Za-z]|\n\s*---|\n\s*##\s|\n\s*<\/|$)/i,
  );
  let args = (argsMatch?.[1] ?? "").trim();
  if (!args) {
    const afterScope = tagged.split(/\*\*Scope\*\*\s*:[^\n]*/i)[1] ?? "";
    const body = afterScope
      .replace(/^\s*---+\s*/m, "")
      .replace(/##\s*Command Instructions[\s\S]*/i, "")
      .trim();
    if (body && !body.startsWith("#") && !body.startsWith("**")) {
      args = body;
    }
  }

  return { name, arguments: args };
}

export function parseSkillReference(text: string): SkillReference | null {
  const markerMatch = text.match(
    /^\[\[skill:([A-Za-z0-9][\w.-]*)\]\]\s*([\s\S]*)$/,
  );
  if (markerMatch?.[1]) {
    return { name: markerMatch[1], arguments: markerMatch[2] ?? "" };
  }

  const slashMatch = text.match(/^\/([A-Za-z0-9][\w.-]*)\s+([\s\S]*)$/);
  if (slashMatch?.[1]) {
    return { name: slashMatch[1], arguments: slashMatch[2] ?? "" };
  }

  const autoSlash = parseAutoSlashCommandReference(text);
  if (autoSlash) return autoSlash;

  return parseExpandedSkillReference(text);
}
