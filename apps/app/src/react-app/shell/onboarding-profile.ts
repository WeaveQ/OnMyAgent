import type { OnboardingProfile } from "../kernel/local-provider";

function joinValues(label: string, values: string[]) {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? `${label}: ${normalized.join(", ")}` : null;
}

export function buildOnboardingProfileSystemPrompt(
  profile: OnboardingProfile | null,
) {
  if (!profile || profile.skipped) return null;
  const lines = [
    profile.userName.trim() ? `User name: ${profile.userName.trim()}` : null,
    profile.assistantName.trim()
      ? `In personal assistant chats, the user wants the assistant named: ${profile.assistantName.trim()}`
      : null,
    profile.mbti.trim() ? `User MBTI: ${profile.mbti.trim()}` : null,
    joinValues("User role", profile.roles),
    joinValues("User industry", profile.industries),
    joinValues("User tools", profile.tools),
    joinValues("User common tasks", profile.tasks),
  ].filter((line): line is string => Boolean(line));

  if (lines.length === 0) return null;
  return [
    "The user provided the following personal work preferences during first-run onboarding. Keep referring to them in personal assistant and agent conversations; do not proactively recap them unless the user asks.",
    "Priority rule: when the current session is bound to an agent that has its own identity, tone, addressing, background, or mind configuration, that agent configuration takes precedence; only fall back to the preferences below for areas the agent does not define.",
    ...lines.map((line) => `- ${line}`),
  ].join("\n");
}
