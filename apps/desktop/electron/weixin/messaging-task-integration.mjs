import { createMessagingTaskAdapter } from "../channels/messaging-task-adapter.mjs";

export function createWeixinMessagingTaskIntegration(options = {}) {
  const adapter = createMessagingTaskAdapter({ taskMessageRouter: options.taskMessageRouter });
  return Object.freeze({
    canRoute: adapter.canRoute,
    simulatedMessageId(input = {}) {
      return adapter.canRoute(input.text) && input.messageId == null ? "" : (input.messageId ?? `sim-${Date.now()}`);
    },
    route: (event, hooks) => adapter.tryRoute({
      platform: "weixin",
      accountId: event.accountId,
      chatId: event.chatId,
      senderId: event.senderId,
      messageId: event.messageId,
      text: event.text,
      attachments: event.mediaFiles,
    }, hooks),
  });
}

export async function sendWeixinTaskDelivery(active, state, input, sendText) {
  if (!active || state.status !== "running") return { ok: false, error: "Weixin is not running" };
  if (input.accountId && String(input.accountId) !== String(active.account.accountId)) return { ok: false, error: "Weixin account is not active" };
  const chatId = String(input.chatId ?? "").trim();
  const text = String(input.text ?? "").trim();
  if (!chatId || !text) return { ok: false, error: "chatId and text are required" };
  await sendText(active, chatId, text);
  return { ok: true };
}

export async function simulateWeixinInbound({ input, state, active, store, runtimeOptions, processMessage, messagingTasks }) {
  const accountId = String(input.accountId ?? state.accountId ?? "").trim();
  const account = active?.account?.accountId === accountId ? active.account : await store.loadAccount(accountId);
  if (!account) return { ok: false, error: "Weixin account is not configured" };
  const session = active?.account?.accountId === account.accountId
    ? active
    : { account, store, options: runtimeOptions(input), controller: new AbortController() };
  const event = await processMessage(session, {
    from_user_id: input.fromUserId ?? input.senderId ?? "studio-test-user",
    to_user_id: account.accountId,
    message_id: messagingTasks.simulatedMessageId(input),
    context_token: input.contextToken ?? "",
    item_list: [{ type: 1, text_item: { text: String(input.text ?? "ping") } }],
  });
  return { ok: true, event, status: state.snapshot() };
}
