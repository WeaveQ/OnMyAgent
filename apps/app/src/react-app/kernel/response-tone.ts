/**
 * Assistant default response tone (settings → personalization).
 * Stored in local preferences; injected as system guidance on send.
 */

export const RESPONSE_TONE_IDS = [
  "default",
  "professional",
  "friendly",
  "direct",
  "imaginative",
  "pragmatic",
  "sarcastic",
  "socratic",
] as const;

export type ResponseToneId = (typeof RESPONSE_TONE_IDS)[number];

const TONE_SET = new Set<string>(RESPONSE_TONE_IDS);

/** Map legacy prefs + validate unknown values. */
export function normalizeResponseTone(value: unknown): ResponseToneId {
  if (value === "business") return "pragmatic";
  if (typeof value === "string" && TONE_SET.has(value)) {
    return value as ResponseToneId;
  }
  return "pragmatic";
}

/**
 * English system guidance for the model. Returns null for "default"
 * (no forced style).
 */
export function buildResponseToneSystemPrompt(
  tone: ResponseToneId | string | null | undefined,
): string | null {
  const id = normalizeResponseTone(tone);
  switch (id) {
    case "default":
      return null;
    case "professional":
      return "Response style: professional and rigorous — clear, accurate, and trustworthy. Prefer precise wording and well-structured answers.";
    case "friendly":
      return "Response style: warm and approachable — friendly, encouraging, and easy to talk to without being overly casual.";
    case "direct":
      return "Response style: blunt and concise — short sentences, no filler, lead with the point.";
    case "imaginative":
      return "Response style: imaginative — use vivid metaphors and analogies when they help understanding; stay grounded in correctness.";
    case "pragmatic":
      return "Response style: high-density and practical — minimum words, maximum useful information; skip pleasantries.";
    case "sarcastic":
      return "Response style: sharp wit and light roast — pointed but not mean; never insult the user personally.";
    case "socratic":
      return "Response style: Socratic coach — guide with questions so the user thinks through the answer; still give a clear takeaway when asked for one.";
  }
}

export function buildCustomInstructionsSystemPrompt(
  text: string | null | undefined,
): string | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  return [
    "User custom instructions (apply unless they conflict with a bound agent identity/persona):",
    trimmed.slice(0, 4000),
  ].join("\n");
}
