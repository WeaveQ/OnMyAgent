/**
 * Expert sessions must run on a light OpenCode agent, never the home
 * oh-my-openagent default (Sisyphus - ultraworker) which dumps global skill
 * catalogs into ~100k input tokens.
 */

export const EXPERT_PROMPT_DEFAULT_AGENT = "onmyagent";

const HEAVY_ORCHESTRATOR_AGENT_PATTERN =
  /sisyphus|ultraworker|oh-my-openagent|oh-my-opencode/i;

/**
 * Resolve the OpenCode `agent` field for promptAsync on expert turns.
 * - Prefer a safe composer selection when set.
 * - Otherwise use the light default.
 * - Never pass through heavy orchestrator agent ids.
 */
export function resolveExpertPromptAgent(
  selectedAgent: string | null | undefined,
): string {
  const selected = selectedAgent?.trim() ?? "";
  if (!selected) return EXPERT_PROMPT_DEFAULT_AGENT;
  if (HEAVY_ORCHESTRATOR_AGENT_PATTERN.test(selected)) {
    return EXPERT_PROMPT_DEFAULT_AGENT;
  }
  return selected;
}

/**
 * Parse `skills: [a, b, c]` from agent markdown frontmatter (YAML-ish).
 */
export function parseSkillNamesFromAgentMarkdown(markdown: string): string[] {
  const raw = markdown ?? "";
  const fence = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const body = fence?.[1] ?? raw;
  // skills: [foo, bar] or skills: [foo]
  const bracket = body.match(/^skills:\s*\[([^\]]*)\]/m);
  if (bracket) {
    return uniqueSafeSkillNames(
      bracket[1]
        .split(",")
        .map((part) => part.trim().replace(/^["']|["']$/g, "")),
    );
  }
  // skills:\n  - foo\n  - bar
  const listBlock = body.match(/^skills:\s*\n((?:[ \t]*-[ \t]*.+\n?)+)/m);
  if (listBlock) {
    return uniqueSafeSkillNames(
      listBlock[1]
        .split(/\r?\n/)
        .map((line) => line.replace(/^[ \t]*-[ \t]*/, "").trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean),
    );
  }
  return [];
}

function uniqueSafeSkillNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
