/**
 * Diff / clipboard helpers shared across tool-call renderers.
 *
 * Extracted from `domains/session/surface/tool-call.tsx` so that other
 * domains (e.g. `domains/local-agents/messages/timeline-messages`) can
 * consume them without crossing the domain boundary. `tool-call.tsx`
 * itself re-exports these names to keep session-internal callers stable.
 */
export function diffLineClass(line: string) {
  if (line.startsWith("+")) return "text-dls-status-success-fg bg-dls-status-success-soft";
  if (line.startsWith("-")) return "text-dls-status-danger-fg bg-dls-status-danger-soft";
  if (line.startsWith("@@")) return "text-dls-accent bg-dls-decision-soft";
  return "text-dls-text";
}

export function extractDiff(output: unknown) {
  if (typeof output !== "string") return null;
  if (output.includes("@@") || output.includes("+++ ") || output.includes("--- ")) {
    return output;
  }
  return null;
}

export function toKeyedLines(value: string) {
  let offset = 0;
  return value.split("\n").map((line) => {
    const key = `${offset}:${line}`;
    offset += line.length + 1;
    return { key, line };
  });
}

export async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}
