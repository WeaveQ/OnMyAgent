/**
 * Strip / detect agent skill-catalog dumps that leak into assistant transcript
 * text (e.g. Grok bundled skill JSON concatenated without newlines).
 */

export type AssistantTextSanitizeResult = {
  text: string;
  /** True when the original text was (almost) only a skill catalog dump. */
  wasSkillCatalogDump: boolean;
  /** Count of SKILL.md markers found in the stripped dump, if any. */
  skillCatalogCount: number;
};

const SKILL_MD_RE = /SKILL\.md/gi;
const SCOPE_RE = /"scope"\s*:\s*"(bundled|user|project|workspace)"/g;
const META_RE = /"_meta"\s*:/g;
const NAME_FIELD_RE = /"name"\s*:\s*"/g;

/** Count skill-catalog markers in a string. */
export function countSkillCatalogMarkers(text: string): {
  skillMd: number;
  scope: number;
  meta: number;
  names: number;
} {
  const s = String(text ?? "");
  return {
    skillMd: (s.match(SKILL_MD_RE) || []).length,
    scope: (s.match(SCOPE_RE) || []).length,
    meta: (s.match(META_RE) || []).length,
    names: (s.match(NAME_FIELD_RE) || []).length,
  };
}

/**
 * True when text is primarily a dumped skill inventory (not a normal reply).
 */
export function looksLikeSkillCatalogDump(text: string): boolean {
  const s = String(text ?? "").trim();
  if (s.length < 48 || !s.includes("{")) return false;
  const { skillMd, scope, meta, names } = countSkillCatalogMarkers(s);
  if (skillMd >= 2 && (scope + meta) >= 2) return true;
  if (skillMd >= 1 && names >= 3 && meta >= 1 && s.startsWith("{")) return true;
  if (skillMd >= 2 && s.startsWith("{") && (s.match(/\{/g) || []).length >= 3) {
    // High JSON density: little readable prose outside braces.
    const prose = s
      .replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (prose.length < 40) return true;
  }
  return false;
}

/**
 * Remove top-level JSON objects that look like skill catalog entries; keep prose.
 */
export function stripSkillCatalogDump(text: string): string {
  const s = String(text ?? "");
  if (!s.trim()) return "";

  if (looksLikeSkillCatalogDump(s) && !hasSubstantialProse(removeTopLevelJsonObjects(s))) {
    return "";
  }

  const withoutSkillObjects = removeTopLevelJsonObjects(s, { onlySkillCatalog: true });
  if (looksLikeSkillCatalogDump(withoutSkillObjects) && !hasSubstantialProse(withoutSkillObjects)) {
    return "";
  }
  return withoutSkillObjects.trim();
}

/** Scan top-level `{...}` objects; drop those that look like skill catalog entries. */
function removeTopLevelJsonObjects(
  text: string,
  options: { onlySkillCatalog?: boolean } = {},
): string {
  const s = String(text ?? "");
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] !== "{") {
      out += s[i];
      i += 1;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let j = i; j < s.length; j += 1) {
      const ch = s[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) {
      out += s.slice(i);
      break;
    }
    const objectText = s.slice(i, end + 1);
    const drop =
      options.onlySkillCatalog !== false
        ? /SKILL\.md/i.test(objectText)
          || (/"scope"\s*:\s*"(bundled|user|project|workspace)"/.test(objectText)
            && /"_meta"\s*:/.test(objectText))
        : true;
    if (!drop) out += objectText;
    i = end + 1;
  }
  return out;
}

function hasSubstantialProse(text: string): boolean {
  const prose = String(text ?? "").replace(/\s+/g, " ").trim();
  if (prose.length < 12) return false;
  if (/[\u4e00-\u9fff]/.test(prose)) return true;
  const words = prose.split(/\s+/).filter((w) => /[A-Za-z]{3,}/.test(w));
  return words.length >= 3;
}

/**
 * Sanitize assistant-facing transcript text for display.
 */
export function sanitizeAssistantTranscriptText(text: string): AssistantTextSanitizeResult {
  const original = String(text ?? "");
  const markers = countSkillCatalogMarkers(original);
  const wasDump = looksLikeSkillCatalogDump(original);
  const cleaned = stripSkillCatalogDump(original);
  return {
    text: cleaned,
    wasSkillCatalogDump: wasDump && !cleaned.trim(),
    skillCatalogCount: markers.skillMd,
  };
}
