/**
 * OpenCode's session loop exits only when
 * `user.id < assistant.id` (string compare) and finish !== "tool-calls".
 * Client UUIDs (`msg_<uuid>`) sort after native `msg_000…` ids and keep
 * generating after a normal stop.
 */
export function shouldForwardPromptMessageId(
  messageId: string | null | undefined,
): messageId is string {
  const id = messageId?.trim() ?? "";
  if (!id) return false;
  if (id.includes("-")) return false;
  if (/^msg_onmyagent[_-]/i.test(id)) return false;
  return /^msg_[0-9a-z]+$/i.test(id);
}
