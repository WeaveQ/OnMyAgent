export const CAPABILITY_TEMPLATE_EVENT = "onmyagent-capability-template";

export type CapabilityTemplateSegment =
  | { kind: "text"; value: string }
  | { kind: "placeholder"; value: string };

const CAPABILITY_PLACEHOLDER_PATTERN = /<([^<>\r\n]+)>/g;

/**
 * Splits a capability prompt into editable prose and inline placeholder
 * labels. This parser is intentionally used only for capability-template
 * events, so ordinary prompts containing TypeScript/HTML angle brackets stay
 * plain text.
 */
export function splitCapabilityTemplate(value: string): CapabilityTemplateSegment[] {
  const segments: CapabilityTemplateSegment[] = [];
  let cursor = 0;

  for (const match of value.matchAll(CAPABILITY_PLACEHOLDER_PATTERN)) {
    const start = match.index;
    const placeholder = match[1];
    if (start === undefined || placeholder === undefined) continue;
    if (start > cursor) {
      segments.push({ kind: "text", value: value.slice(cursor, start) });
    }
    segments.push({ kind: "placeholder", value: placeholder });
    cursor = start + match[0].length;
  }

  if (cursor < value.length) {
    segments.push({ kind: "text", value: value.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ kind: "text", value }];
}
