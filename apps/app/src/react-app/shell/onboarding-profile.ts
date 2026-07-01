import type { OnboardingProfile } from "../kernel/local-provider";

function joinValues(label: string, values: string[]) {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? `${label}：${normalized.join("、")}` : null;
}

export function buildOnboardingProfileSystemPrompt(
  profile: OnboardingProfile | null,
) {
  if (!profile || profile.skipped) return null;
  const lines = [
    profile.userName.trim() ? `用户姓名：${profile.userName.trim()}` : null,
    profile.assistantName.trim()
      ? `在个人助理对话中，用户希望助手名字是：${profile.assistantName.trim()}`
      : null,
    profile.mbti.trim() ? `用户 MBTI：${profile.mbti.trim()}` : null,
    joinValues("用户职业角色", profile.roles),
    joinValues("用户所在行业", profile.industries),
    joinValues("用户常用工具", profile.tools),
    joinValues("用户经常做的事", profile.tasks),
  ].filter((line): line is string => Boolean(line));

  if (lines.length === 0) return null;
  return [
    "用户首次引导中提供了以下个人工作偏好。请在个人助理和智能体对话中持续参考；不要主动复述，除非用户要求。",
    "优先级规则：当当前会话绑定的智能体有独立的身份、语气、称呼、背景或心智配置时，智能体配置优先于以下偏好信息；仅在智能体未提供对应配置的领域，才参考以下偏好。",
    ...lines.map((line) => `- ${line}`),
  ].join("\n");
}
