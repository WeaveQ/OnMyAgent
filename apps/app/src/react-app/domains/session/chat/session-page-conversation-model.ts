import type {
  OnMyAgentSessionMessage,
  OnMyAgentSessionSnapshot,
} from "../../../../app/lib/onmyagent-server";

export function normalizeTimestamp(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value < 10_000_000_000 ? value * 1000 : value;
}

export function formatConversationTime(value: number | null | undefined) {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDelta = Math.round(
    (today.getTime() - targetDay.getTime()) / 86_400_000,
  );
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (dayDelta === 0) return time;
  if (dayDelta === 1) return "昨天";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function sessionMessageTime(message: OnMyAgentSessionMessage) {
  const completed =
    "completed" in message.info.time ? message.info.time.completed : null;
  return (
    normalizeTimestamp(completed) ??
    normalizeTimestamp(message.info.time?.created)
  );
}

function messagePartPreview(part: OnMyAgentSessionMessage["parts"][number]) {
  if (part.type === "text") {
    if (part.synthetic || part.ignored) return "";
    return part.text.trim();
  }
  if (part.type === "reasoning") return part.text.trim();
  if (part.type === "tool") return `[工具] ${part.tool}`;
  if (part.type === "agent") return part.name ? `@${part.name}` : "@智能体";
  if (part.type === "file") return "[文件]";
  return "";
}

function sessionMessagePreview(message: OnMyAgentSessionMessage) {
  return message.parts
    .map(messagePartPreview)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function snapshotConversationSummary(
  snapshot: OnMyAgentSessionSnapshot | undefined,
  fallbackTime: number | null | undefined,
) {
  if (!snapshot) {
    return {
      preview: "新建会话",
      time: formatConversationTime(fallbackTime),
    };
  }

  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (!message) continue;
    const preview = sessionMessagePreview(message);
    if (preview) {
      return {
        preview,
        time: formatConversationTime(
          sessionMessageTime(message) ??
            snapshot.session.time?.updated ??
            snapshot.session.time?.created ??
            fallbackTime,
        ),
      };
    }
  }

  return {
    preview: "新建会话",
    time: formatConversationTime(
      snapshot.session.time?.updated ??
        snapshot.session.time?.created ??
        fallbackTime,
    ),
  };
}
