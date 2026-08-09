import {
  agentLabel,
  currentAgentForChat,
  currentModelForChat,
  enrichAgentModelOptions,
  renderAgentHelp,
  renderModeHelp,
  renderModelHelp,
  renderRunStatus,
  renderRunsList,
  resolveAgentAlias,
  resolveAgentModelId,
  scopedWeixinRuntimeAgent,
} from "./agent-context.mjs";
import { normalizePromptMode } from "./chat-policy.mjs";
import {
  parseAgentSwitchCommand,
  parseApprovalCommand,
  parseModeCommand,
  parseModelSwitchCommand,
  parseRunCommand,
} from "./commands.mjs";
import {
  activeRunKey,
  chatAgentHistoryKey,
  safeId,
} from "./helpers.mjs";

export function createWeixinControlCommands({
  runtime,
  store,
  appendLog,
  setState,
  sendText,
  agentBusyNoticeAt,
  readActiveRunSafely,
  listActiveRunsSafely,
  writeActiveRunSafely,
  deleteActiveRunSafely,
  scheduleActiveRunPoll,
  clearActiveRunPoll,
  closeChannelSessionForAgent,
}) {
  async function maybeHandleControlCommand(session, event) {
    const approvalCommand = parseApprovalCommand(event.text);
    if (approvalCommand) {
      await handleApprovalCommand(session, event, approvalCommand);
      return true;
    }

    const runCommand = parseRunCommand(event.text);
    if (runCommand) {
      await handleRunCommand(session, event, runCommand);
      return true;
    }

    const modeCommand = parseModeCommand(event.text);
    if (modeCommand) {
      if (!modeCommand.target) {
        await sendText(session, event.chatId, renderModeHelp(session, event.chatId), event.senderId);
        return true;
      }
      const nextMode = normalizePromptMode(modeCommand.target);
      if (nextMode !== modeCommand.target.trim().toLowerCase()) {
        await sendText(session, event.chatId, `未知微信转发模式：${modeCommand.target}\n\n${renderModeHelp(session, event.chatId)}`, event.senderId);
        return true;
      }
      session.options.promptModeByChat.set(event.chatId, nextMode);
      await store.writeChatSetting(session.account.accountId, event.chatId, { promptMode: nextMode });
      await sendText(session, event.chatId, `已切换当前微信会话的转发模式：${nextMode}`, event.senderId);
      return true;
    }

    const modelCommand = parseModelSwitchCommand(event.text);
    if (modelCommand) {
      const boundAgent = await currentAgentForChat(session, event.chatId);
      const enrichedAgent = await enrichAgentModelOptions(runtime, session, boundAgent).catch(() => boundAgent);
      const currentModel = await currentModelForChat(session, event.chatId);
      const rawTarget = modelCommand.target;
      if (!rawTarget) {
        await sendText(session, event.chatId, renderModelHelp(enrichedAgent, currentModel), event.senderId).catch((error) => {
          appendLog({ type: "error", text: `weixin model-switch help send failed: ${error?.message ?? error}` });
        });
        return true;
      }
      const lowered = rawTarget.toLowerCase();
      if (lowered === "default" || lowered === "reset" || lowered === "清除" || lowered === "重置") {
        session.options.modelByChat.set(event.chatId, "");
        await store.writeChatSetting(session.account.accountId, event.chatId, { model: "" }).catch((error) => {
          appendLog({ type: "error", text: `weixin model-switch: writeChatSetting failed: ${error?.message ?? error}` });
        });
        await sendText(session, event.chatId, `已恢复当前微信会话的默认模型（${agentLabel(enrichedAgent)}）。`, event.senderId).catch(() => undefined);
        return true;
      }
      const resolved = resolveAgentModelId(enrichedAgent, rawTarget);
      if (!resolved) {
        await sendText(session, event.chatId, `未在当前 Agent 的模型列表中找到：${rawTarget}\n\n${renderModelHelp(enrichedAgent, currentModel)}`, event.senderId).catch(() => undefined);
        return true;
      }
      session.options.modelByChat.set(event.chatId, resolved);
      await store.writeChatSetting(session.account.accountId, event.chatId, { model: resolved }).catch((error) => {
        appendLog({ type: "error", text: `weixin model-switch: writeChatSetting failed: ${error?.message ?? error}` });
      });
      await sendText(session, event.chatId, `已切换当前微信会话的模型：${resolved}`, event.senderId).catch(() => undefined);
      return true;
    }

    const agentCommand = parseAgentSwitchCommand(event.text);
    if (!agentCommand) return false;
    const availableIds = (session.options.availableAgents ?? []).map((a) => `${a.provider}/${a.id}`);
    appendLog({ type: "debug", text: `weixin agent-switch: raw=${JSON.stringify(event.text)} target=${JSON.stringify(agentCommand.target)} chat=${event.chatId} available=[${availableIds.join(",")}]` });
    if (!agentCommand.target) {
      appendLog({ type: "debug", text: "weixin agent-switch: empty target, sending help" });
      await sendText(session, event.chatId, renderAgentHelp(session, event.chatId), event.senderId).catch((error) => {
        appendLog({ type: "error", text: `weixin agent-switch help send failed: ${error?.message ?? error}` });
      });
      return true;
    }
    const nextAgent = resolveAgentAlias(session.options.availableAgents, agentCommand.target);
    if (!nextAgent) {
      appendLog({ type: "warn", text: `weixin agent-switch: target=${agentCommand.target} did not match any available agent alias; sending not-found` });
      await sendText(session, event.chatId, `未找到可切换的本地 Agent：${agentCommand.target}\n\n${renderAgentHelp(session, event.chatId)}`, event.senderId).catch((error) => {
        appendLog({ type: "error", text: `weixin agent-switch not-found send failed: ${error?.message ?? error}` });
      });
      return true;
    }
    const priorAgent = session.options.agentByChat.get(event.chatId) ?? null;
    session.options.agentByChat.set(event.chatId, nextAgent);
    try {
      await store.writeChatSetting(session.account.accountId, event.chatId, { agent: nextAgent });
    } catch (error) {
      appendLog({ type: "error", text: `weixin agent-switch: writeChatSetting failed: ${error?.message ?? error}` });
    }
    if (session.options.channelAssistantBindingStore) {
      await session.options.channelAssistantBindingStore
        .setChatAssistant("wechat", event.chatId, { assistant_id: nextAgent.id })
        .catch((error) => appendLog({ text: `Failed to persist chat binding: ${error?.message ?? error}` }));
    }
    setState({ activeAgentId: nextAgent.id, lastError: null });
    let priorRun = null;
    try {
      const priorRunKey = priorAgent ? activeRunKey(event.chatId, priorAgent) : null;
      if (priorRunKey) priorRun = await readActiveRunSafely(session.account.accountId, priorRunKey);
    } catch { /* noop */ }
    const suffix = priorRun?.runId ? `\n上一个任务（${priorAgent ? agentLabel(priorAgent) : "旧 Agent"}）仍在运行，其结果会异步返回；新消息将由新 Agent 处理。` : "";
    appendLog({ type: "debug", text: `weixin agent-switch: switched ${priorAgent ? priorAgent.id : "<none>"} -> ${nextAgent.id} priorRun=${priorRun?.runId ?? "none"}` });
    try {
      await sendText(session, event.chatId, `已切换当前微信会话的回复 Agent：${agentLabel(nextAgent)}${suffix}`, event.senderId);
      appendLog({ type: "debug", text: `weixin agent-switch: ack delivered to chat=${event.chatId}` });
    } catch (error) {
      appendLog({ type: "error", text: `weixin agent-switch ack send failed: ${error?.message ?? error}` });
    }
    return true;
  }

  async function handleRunCommand(session, event, command) {
    if (command.name === "runs") {
      const runs = await listActiveRunsSafely(session.account.accountId);
      await sendText(session, event.chatId, renderRunsList(runs), event.senderId);
      return;
    }
    const agent = await currentAgentForChat(session, event.chatId);
    const runKey = activeRunKey(event.chatId, agent);
    const run = await readActiveRunSafely(session.account.accountId, runKey);
    if (command.name === "new") {
      if (run) {
        await sendText(session, event.chatId, "当前微信会话和 Agent 还有运行中的任务。请等待完成，或先发送 #cancel 后再开启新会话。", event.senderId);
        return;
      }
      const runtimeAgent = scopedWeixinRuntimeAgent(agent, event);
      const historyKey = chatAgentHistoryKey(event.chatId, agent);
      await store.clearChatHistory?.(session.account.accountId, historyKey).catch(() => false);
      await closeChannelSessionForAgent(session, event, runtimeAgent);
      const reset = typeof runtime?.resetConversation === "function"
        ? await runtime.resetConversation({ workspaceRoot: session.options.workspaceRoot, agent: runtimeAgent }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
        : { ok: false, error: "runtime reset is unavailable" };
      if (reset?.ok === false) {
        await sendText(session, event.chatId, `已清空微信侧历史，但本地 Agent 会话重置失败：${reset.error ?? "unknown error"}`, event.senderId);
        return;
      }
      await sendText(session, event.chatId, `已为当前微信会话开启新的 ${agentLabel(agent)} 对话。后续消息不会带入该 Agent 之前的微信历史或本地 provider session。`, event.senderId);
      return;
    }
    if (command.name === "status" || command.name === "continue") {
      if (run) scheduleActiveRunPoll(session, run, 0);
      await sendText(session, event.chatId, run ? renderRunStatus(run) : "当前微信会话和 Agent 没有运行中的任务。", event.senderId);
      return;
    }
    if (command.name === "cancel") {
      if (run && !run.runId) {
        await sendText(session, event.chatId, "当前微信会话和 Agent 的任务正在启动，请稍后再发送 #cancel。", event.senderId);
        return;
      }
      if (!run?.runId) {
        await sendText(session, event.chatId, "当前微信会话和 Agent 没有可取消的任务。", event.senderId);
        return;
      }
      const cancelled = typeof runtime?.cancelRun === "function"
        ? await runtime.cancelRun(run.runId, { reason: "weixin" })
        : { ok: false, error: "runtime cancel is unavailable" };
      clearActiveRunPoll(session.account.accountId, runKey);
      agentBusyNoticeAt.delete(`${session.account.accountId}:${runKey}`);
      await deleteActiveRunSafely(session.account.accountId, runKey);
      await sendText(session, event.chatId, cancelled?.ok === false ? `已清理微信侧任务记录，但本地取消失败：${cancelled.error ?? "unknown error"}` : "已取消当前微信会话的本地 Agent 任务。", event.senderId);
    }
  }

  async function handleApprovalCommand(session, event, command) {
    if (typeof runtime?.resolveApproval !== "function") {
      await sendText(session, event.chatId, "当前本地 Agent runtime 不支持微信内审批。请在 Studio 中处理审批。", event.senderId);
      return;
    }
    const pendingRuns = await pendingApprovalRunsForChat(session, event.chatId);
    if (!pendingRuns.length) {
      await sendText(session, event.chatId, "当前微信会话没有等待审批的本地 Agent 任务。", event.senderId);
      return;
    }
    const targets = command.all ? pendingRuns : [pendingRuns[0]];
    let resolvedCount = 0;
    const errors = [];
    for (const run of targets) {
      const approvals = Array.isArray(run.pendingApprovals) ? run.pendingApprovals : [];
      const approvalTargets = command.all ? approvals : approvals.slice(0, 1);
      for (const approval of approvalTargets) {
        const result = await runtime.resolveApproval({
          runId: run.runId,
          approvalId: approval.id,
          decision: command.decision,
        }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        if (result?.ok === false) {
          errors.push(`${safeId(run.runId, 12)}: ${result.error ?? "unknown error"}`);
          continue;
        }
        resolvedCount += 1;
      }
      const remaining = command.all ? [] : approvals.slice(1);
      const updated = await writeActiveRunSafely(session.account.accountId, run.runKey, {
        status: remaining.length ? "pending_approval" : "running",
        pendingApprovals: remaining,
        pendingApprovalNotifiedAt: remaining.length ? run.pendingApprovalNotifiedAt : null,
      }, { ...run, status: remaining.length ? "pending_approval" : "running", pendingApprovals: remaining, pendingApprovalNotifiedAt: remaining.length ? run.pendingApprovalNotifiedAt : null });
      if (updated) scheduleActiveRunPoll(session, updated, 0);
    }
    if (!resolvedCount && errors.length) {
      await sendText(session, event.chatId, `审批处理失败：\n${errors.join("\n")}`, event.senderId);
      return;
    }
    const action = command.decision === "decline" ? "拒绝" : "批准";
    const suffix = errors.length ? `\n部分审批失败：\n${errors.join("\n")}` : "";
    await sendText(session, event.chatId, `已${action} ${resolvedCount} 个审批请求，Agent 将继续处理。${suffix}`, event.senderId);
  }

  async function pendingApprovalRunsForChat(session, chatId) {
    const runs = await listActiveRunsSafely(session.account.accountId);
    return runs
      .filter((run) => String(run.chatId ?? "") === String(chatId ?? ""))
      .filter((run) => Array.isArray(run.pendingApprovals) && run.pendingApprovals.length > 0)
      .sort((a, b) => Number(a.startedAt ?? a.createdAt ?? 0) - Number(b.startedAt ?? b.createdAt ?? 0));
  }

  return {
    maybeHandleControlCommand,
    handleRunCommand,
    handleApprovalCommand,
    pendingApprovalRunsForChat,
  };
}
