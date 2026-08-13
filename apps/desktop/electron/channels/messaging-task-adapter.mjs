const TASK_COMMAND_PATTERN = /^(?:#task|\/task)(?=$|\s)/i;

const READ_ONLY_ACTIONS = new Set(["help", "status", "list"]);
const ACTION_ALIASES = new Map([
  ["help", "help"],
  ["status", "status"],
  ["list", "list"],
  ["ls", "list"],
  ["runs", "list"],
  ["create", "create"],
  ["run", "create"],
  ["start", "create"],
  ["new", "create"],
  ["cancel", "cancel"],
  ["pause", "pause"],
  ["resume", "resume"],
  ["retry", "retry"],
  ["approve", "approve"],
  ["reject", "reject"],
]);

export const TASK_ROUTER_SAFE_ERROR_REPLY =
  "Task 命令处理失败，请稍后重试，或在 Studio 的 Task Center 查看详情。";

export const TASK_ROUTER_MESSAGE_ID_REQUIRED_REPLY =
  "这条 Task 命令缺少稳定的消息 ID，已拒绝执行以避免重复创建或重复操作。请重新发送。";

/**
 * Parse only the explicit #task or /task namespace. Existing Personal channel
 * commands (#status, #cancel, #approve, ...) intentionally do not match.
 */
export function parseMessagingTaskCommand(text) {
  const rawText = String(text ?? "").trim();
  const prefix = rawText.match(TASK_COMMAND_PATTERN);
  if (!prefix) return null;

  const body = rawText.slice(prefix[0].length).trim();
  if (!body) {
    return {
      namespace: "task",
      action: "help",
      args: "",
      rawText,
      requiresStableMessageId: false,
    };
  }

  const separator = body.search(/\s/);
  const firstToken = (separator === -1 ? body : body.slice(0, separator)).toLowerCase();
  const aliasedAction = ACTION_ALIASES.get(firstToken);
  const action = aliasedAction ?? "create";
  const args = aliasedAction
    ? (separator === -1 ? "" : body.slice(separator).trim())
    : body;

  return {
    namespace: "task",
    action,
    args,
    rawText,
    requiresStableMessageId: !READ_ONLY_ACTIONS.has(action),
  };
}

/**
 * Shared, transport-agnostic Task command seam for messaging channels.
 *
 * The router is optional. When absent, tryRoute() always returns handled:false,
 * preserving the existing Personal Agent path byte-for-byte. Once an explicit
 * Task command is claimed, failures are fail-closed and never fall through to
 * Personal, preventing the same inbound message from being executed twice.
 */
export function createMessagingTaskAdapter(options = {}) {
  const taskMessageRouter = typeof options.taskMessageRouter === "function"
    ? options.taskMessageRouter
    : null;

  function canRoute(text) {
    return Boolean(taskMessageRouter && parseMessagingTaskCommand(text));
  }

  async function tryRoute(input = {}, hooks = {}) {
    const command = parseMessagingTaskCommand(input.text);
    if (!taskMessageRouter || !command) return { handled: false };

    const appendLog = typeof hooks.appendLog === "function" ? hooks.appendLog : () => undefined;
    const reply = typeof hooks.reply === "function" ? hooks.reply : null;
    const messageId = String(input.messageId ?? "").trim();
    const envelope = {
      platform: String(input.platform ?? "").trim(),
      accountId: String(input.accountId ?? "").trim(),
      chatId: String(input.chatId ?? "").trim(),
      senderId: String(input.senderId ?? "").trim(),
      messageId,
      text: command.rawText,
      command,
      attachments: boundedAttachmentReferences(input.attachments),
    };

    if (command.requiresStableMessageId && !messageId) {
      appendLog({
        type: "warn",
        text: `${envelope.platform || "channel"} task command rejected: stable messageId required`,
      });
      await deliverSafeReply(reply, TASK_ROUTER_MESSAGE_ID_REQUIRED_REPLY, appendLog, envelope.platform);
      return {
        handled: true,
        ok: false,
        code: "stable_message_id_required",
        command,
      };
    }

    try {
      const result = await taskMessageRouter(envelope);
      const replyText = String(result?.replyText ?? "").trim();
      if (replyText) {
        const delivered = await deliverSafeReply(reply, replyText, appendLog, envelope.platform);
        const receipt = result?.deliveryReceipt;
        if (delivered) await receipt?.acknowledge?.();
        else await receipt?.release?.();
      }
      return {
        handled: true,
        ok: result?.ok !== false,
        command,
        result,
      };
    } catch (error) {
      // Do not include the router error message or user command in channel logs:
      // either may contain provider details, local paths, or prompt secrets.
      appendLog({
        type: "error",
        text: `${envelope.platform || "channel"} task router failed (${errorName(error)})`,
      });
      await deliverSafeReply(reply, TASK_ROUTER_SAFE_ERROR_REPLY, appendLog, envelope.platform);
      return {
        handled: true,
        ok: false,
        code: "task_router_failed",
        command,
      };
    }
  }

  return {
    enabled: Boolean(taskMessageRouter),
    canRoute,
    tryRoute,
  };
}

function boundedAttachmentReferences(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((entry) => ({
    name: String(entry?.name ?? entry?.filename ?? "attachment").slice(0, 240),
    mimeType: String(entry?.mimeType ?? entry?.mime ?? "application/octet-stream").slice(0, 120),
    size: Number.isSafeInteger(Number(entry?.size)) && Number(entry.size) >= 0 ? Number(entry.size) : null,
    sha256: /^[a-f0-9]{64}$/i.test(String(entry?.sha256 ?? "")) ? String(entry.sha256).toLowerCase() : null,
  }));
}

async function deliverSafeReply(reply, text, appendLog, platform) {
  if (!reply) return false;
  try {
    await reply(text);
    return true;
  } catch (error) {
    appendLog({
      type: "error",
      text: `${platform || "channel"} task reply failed (${errorName(error)})`,
    });
    return false;
  }
}

function errorName(error) {
  const name = String(error?.name ?? "Error").trim();
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ? name : "Error";
}
