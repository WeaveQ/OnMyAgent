import type {
  ConversationMemoryState,
  OnboardingProfile,
} from "../kernel/local-provider";

function joinValues(label: string, values: string[]) {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? `${label}: ${normalized.join(", ")}` : null;
}

export function buildOnboardingProfileSystemPrompt(
  profile: OnboardingProfile | null,
  conversationMemory?: ConversationMemoryState | null,
) {
  if ((!profile || profile.skipped) && !conversationMemory?.enabled) return null;

  const lines: string[] = [];
  if (profile && !profile.skipped) {
    if (profile.userName.trim()) lines.push(`User name: ${profile.userName.trim()}`);
    if (profile.assistantName.trim()) {
      lines.push(
        `In personal assistant chats, the user wants the assistant named: ${profile.assistantName.trim()}`,
      );
    }
    if (profile.mbti.trim()) lines.push(`User MBTI: ${profile.mbti.trim()}`);
    const roleLine = joinValues("User role", profile.roles);
    if (roleLine) lines.push(roleLine);
    const industryLine = joinValues("User industry", profile.industries);
    if (industryLine) lines.push(industryLine);
    const toolsLine = joinValues("User tools", profile.tools);
    if (toolsLine) lines.push(toolsLine);
    const tasksLine = joinValues("User common tasks", profile.tasks);
    if (tasksLine) lines.push(tasksLine);
    if (profile.docPreference === "data") {
      lines.push(
        "Document preference: data-driven (prefer tables, charts, quantitative analysis).",
      );
    } else if (profile.docPreference === "narrative") {
      lines.push(
        "Document preference: narrative-driven (prefer paragraphs with highlighted key points).",
      );
    }
    if (profile.terminology.trim()) {
      lines.push(`Terminology / format preferences: ${profile.terminology.trim()}`);
    }
  }

  const memoryLines =
    conversationMemory?.enabled && conversationMemory.items.length > 0
      ? [...conversationMemory.items]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 50)
          .map((item) => item.text.trim())
          .filter(Boolean)
          .map((text) => `- ${text.slice(0, 500)}`)
      : [];

  if (lines.length === 0 && memoryLines.length === 0) return null;

  const parts: string[] = [];
  if (lines.length > 0) {
    parts.push(
      "The user provided the following personal work preferences during onboarding / settings. Keep referring to them in personal assistant and agent conversations; do not proactively recap them unless the user asks.",
      "Priority rule: when the current session is bound to an agent that has its own identity, tone, addressing, background, or mind configuration, that agent configuration takes precedence; only fall back to the preferences below for areas the agent does not define.",
      ...lines.map((line) => `- ${line}`),
    );
  }
  if (memoryLines.length > 0) {
    parts.push(
      "Conversation memories the user saved for personalization (from dialog or manual notes). Treat as durable user context; do not invent extra memories.",
      ...memoryLines,
    );
  }
  return parts.join("\n");
}
