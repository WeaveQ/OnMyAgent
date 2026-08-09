import { formatAgentResultOutput } from "../channels/AgentReplyHeader.mjs";

class RetryActiveRunPollError extends Error {}

export function createWeixinActiveRunPolling(options) {
  const queryErrorNoticeIntervalMs = 5 * 60_000;
  const queryErrorRetryMaxMs = 30_000;
  const pollers = new Map();
  const tasks = new Set();
  const inFlightPolls = new Map();
  const pendingSchedules = new Map();
  const activeRunGenerations = new Map();
  // Persistence is best-effort on Windows because antivirus/indexer locks can
  // temporarily reject atomic renames. Keep an authoritative in-process
  // overlay so a failed write never drops the conversation lock and allows a
  // second turn to start for the same chat+agent.
  const activeRunRecords = new Map();

  function recordKey(accountId, runKey) {
    return `${String(accountId)}:${String(runKey)}`;
  }

  function bumpActiveRunGeneration(key) {
    const generation = (activeRunGenerations.get(key) ?? 0) + 1;
    activeRunGenerations.set(key, generation);
    return generation;
  }

  function syntheticRecord(accountId, runKey, value, fallback = undefined) {
    const now = Date.now();
    const prior = activeRunRecords.get(recordKey(accountId, runKey));
    const base = prior && typeof prior === "object"
      ? prior
      : fallback && typeof fallback === "object"
        ? fallback
        : {};
    const record = {
      ...base,
      ...value,
      runKey: String(runKey),
      accountId: String(accountId),
      updatedAt: now,
      createdAt: base.createdAt ?? value?.createdAt ?? now,
    };
    delete record.reservationToken;
    return record;
  }

  function reserveActiveRun(accountId, runKey, value = {}) {
    const key = recordKey(accountId, runKey);
    const existing = activeRunRecords.get(key);
    if (existing) return { acquired: false, record: existing, token: null };
    const token = Symbol("weixin-active-run-reservation");
    const record = syntheticRecord(accountId, runKey, { ...value, status: "starting", reservationToken: token });
    record.reservationToken = token;
    bumpActiveRunGeneration(key);
    activeRunRecords.set(key, record);
    return { acquired: true, record, token };
  }

  function releaseActiveRunReservation(accountId, runKey, token) {
    const key = recordKey(accountId, runKey);
    const current = activeRunRecords.get(key);
    if (current?.reservationToken === token) {
      bumpActiveRunGeneration(key);
      activeRunRecords.delete(key);
    }
  }

  async function readActiveRunSafely(accountId, runKey) {
    const key = recordKey(accountId, runKey);
    if (activeRunRecords.has(key)) return activeRunRecords.get(key);
    const stored = await options.store.readActiveRun(accountId, runKey).catch(() => null);
    if (stored) activeRunRecords.set(key, stored);
    return stored;
  }

  async function listActiveRunsSafely(accountId) {
    const stored = await options.store.listActiveRuns(accountId).catch(() => []);
    const combined = new Map(stored.map((record) => [String(record?.runKey ?? ""), record]));
    const prefix = `${String(accountId)}:`;
    for (const [key, record] of activeRunRecords) {
      if (!key.startsWith(prefix)) continue;
      const runKey = key.slice(prefix.length);
      if (record) combined.set(runKey, record);
      else combined.delete(runKey);
    }
    return [...combined.values()].filter(Boolean);
  }

  async function writeActiveRunSafely(accountId, runKey, value, fallback = undefined) {
    const key = recordKey(accountId, runKey);
    const generation = activeRunGenerations.get(key) ?? 0;
    const synthetic = syntheticRecord(accountId, runKey, value, fallback);
    try {
      // Persist the fully merged overlay, not just the latest status patch. If
      // the initial write was rejected (for example by a transient Windows
      // file lock), the next successful poll must durably recover runId,
      // chat/workspace metadata, and the original user turn as well.
      const stored = await options.store.writeActiveRun(accountId, runKey, synthetic);
      const record = stored && typeof stored === "object" ? { ...synthetic, ...stored } : synthetic;
      if ((activeRunGenerations.get(key) ?? 0) !== generation) {
        const current = activeRunRecords.get(key);
        if (current === null || current === undefined) await options.store.deleteActiveRun(accountId, runKey).catch(() => undefined);
        return current;
      }
      activeRunRecords.set(key, record);
      return record;
    } catch (error) {
      options.appendLog({ type: "error", text: `weixin active run persistence failed: ${error instanceof Error ? error.message : String(error)}` });
      if ((activeRunGenerations.get(key) ?? 0) !== generation) return activeRunRecords.get(key);
      activeRunRecords.set(key, synthetic);
      return synthetic;
    }
  }

  async function deleteActiveRunSafely(accountId, runKey) {
    const key = recordKey(accountId, runKey);
    // Tombstone first so a failed disk cleanup cannot resurrect a completed
    // record during this process lifetime. A later new run overwrites it.
    bumpActiveRunGeneration(key);
    activeRunRecords.set(key, null);
    try {
      const deleted = await options.store.deleteActiveRun(accountId, runKey);
      // Successful durable cleanup no longer needs an in-memory tombstone.
      // Preserve a concurrently reserved replacement run for the same key.
      if (activeRunRecords.get(key) === null) activeRunRecords.delete(key);
      return deleted;
    } catch (error) {
      options.appendLog({ type: "error", text: `weixin active run cleanup failed: ${error instanceof Error ? error.message : String(error)}` });
      return false;
    }
  }

  async function claimTerminalDelivery(session, runKey, record) {
    const accountId = session.account.accountId;
    const pollKey = `${accountId}:${runKey}`;
    const runId = String(record?.runId ?? "").trim();
    if (!runId || options.clearedActiveRunKeys.has(pollKey)) {
      return { shouldDeliver: false, shouldCleanup: false };
    }
    clearActiveRunPoll(accountId, runKey);
    if (String(record?.terminalDeliveryClaimedRunId ?? "").trim() === runId) {
      return { shouldDeliver: false, shouldCleanup: true };
    }
    const key = recordKey(accountId, runKey);
    const generation = activeRunGenerations.get(key) ?? 0;
    const claimed = syntheticRecord(accountId, runKey, {
      status: "terminal_delivery_claimed",
      terminalDeliveryClaimedRunId: runId,
      terminalDeliveryClaimedAt: Date.now(),
    }, record);
    try {
      const stored = await options.store.writeActiveRun(accountId, runKey, claimed);
      if ((activeRunGenerations.get(key) ?? 0) !== generation) {
        const current = activeRunRecords.get(key);
        if (current === null || current === undefined) await options.store.deleteActiveRun(accountId, runKey).catch(() => undefined);
        return { shouldDeliver: false, shouldCleanup: false };
      }
      activeRunRecords.set(key, stored && typeof stored === "object" ? { ...claimed, ...stored } : claimed);
      return { shouldDeliver: true, shouldCleanup: true };
    } catch (error) {
      options.clearedActiveRunKeys.delete(pollKey);
      options.appendLog({ type: "error", text: `weixin terminal delivery claim persistence failed: ${error instanceof Error ? error.message : String(error)}` });
      throw new RetryActiveRunPollError(error instanceof Error ? error.message : String(error));
    }
  }

  async function pollActiveRun(session, runKey, fallbackRecord = null) {
    if (session.controller.signal.aborted) return;
    const pollKey = `${session.account.accountId}:${runKey}`;
    const record = await readActiveRunSafely(session.account.accountId, runKey) ?? fallbackRecord;
    if (!record?.runId || options.clearedActiveRunKeys.has(pollKey)) return;
    let result;
    try {
      result = await options.runtime.getRun(
        { runId: record.runId, workspaceRoot: record.workspaceRoot },
        { eventLimit: 200, conversationMessageEventLimit: 200 },
      );
    } catch (error) {
      if (session.controller.signal.aborted || options.clearedActiveRunKeys.has(pollKey)) return;
      const message = error instanceof Error ? error.message : String(error);
      const now = Date.now();
      const failureCount = Math.max(0, Number(record.statusQueryFailureCount ?? 0)) + 1;
      const priorNoticeAt = Number(record.statusQueryLastNotifiedAt ?? 0);
      const shouldNotify = priorNoticeAt <= 0 || now - priorNoticeAt >= queryErrorNoticeIntervalMs;
      const updated = await writeActiveRunSafely(
        session.account.accountId,
        runKey,
        {
          statusQueryFailureCount: failureCount,
          statusQueryLastNotifiedAt: shouldNotify ? now : priorNoticeAt,
        },
        record,
      );
      options.setLastError(message);
      options.appendLog({ type: "error", text: `weixin active run status query failed: ${message}` });
      if (shouldNotify) {
        await options.sendText(session, record.chatId, `任务状态查询失败：${message}`, record.senderId).catch(() => undefined);
      }
      const retryDelayMs = Math.min(
        queryErrorRetryMaxMs,
        options.pollIntervalMs * (2 ** Math.min(5, failureCount - 1)),
      );
      scheduleActiveRunPoll(session, updated, retryDelayMs);
      return;
    }
    if (session.controller.signal.aborted || options.clearedActiveRunKeys.has(pollKey)) return;
    if (!result) {
      const claim = await claimTerminalDelivery(session, runKey, record);
      if (!claim.shouldDeliver) {
        if (claim.shouldCleanup) await deleteActiveRunSafely(session.account.accountId, runKey);
        return;
      }
      const message = "本次本地 Agent 任务已不在运行（可能主进程重启/崩溃后遗留，或已超时中断）。已自动清除会话锁，可重新发送消息。";
      await options.sendText(session, record.chatId, message, record.senderId).catch(() => undefined);
      options.agentBusyNoticeAt.delete(pollKey);
      await deleteActiveRunSafely(session.account.accountId, runKey);
      return;
    }
    options.setLastRunId(record.runId);
    const resultState = options.getRunSnapshotState(result);
    if (resultState.isCompletedWithOutput) {
      const claim = await claimTerminalDelivery(session, runKey, record);
      if (!claim.shouldDeliver) {
        if (claim.shouldCleanup) await deleteActiveRunSafely(session.account.accountId, runKey);
        return;
      }
      const deliveredOutput = formatAgentResultOutput(result);
      try {
        await options.deliverAgentOutput(session, {
          chatId: record.chatId,
          peerId: record.senderId,
          agent: record.agent,
          result: { ...result, output: deliveredOutput },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.setLastError(message);
        options.appendLog({ type: "error", text: `weixin active run delivery failed: ${message}` });
        // The transport may have accepted an attachment before a later text
        // send failed. Clear the lock without replaying the terminal snapshot;
        // the full result remains available in the desktop runtime.
        clearActiveRunPoll(session.account.accountId, runKey);
        options.agentBusyNoticeAt.delete(pollKey);
        await deleteActiveRunSafely(session.account.accountId, runKey);
        return;
      }
      await options.appendAgentHistory(session, record.historyKey, record.userText, deliveredOutput, record.agent, record.historyStoreLimit ?? session.options.historyStoreLimit);
      await options.appendChannelSessionHistoryById(record.channelSessionId, record.userText, deliveredOutput, record.agent);
      clearActiveRunPoll(session.account.accountId, runKey);
      options.agentBusyNoticeAt.delete(pollKey);
      await deleteActiveRunSafely(session.account.accountId, runKey);
      return;
    }
    if (resultState.isTerminal) {
      const claim = await claimTerminalDelivery(session, runKey, record);
      if (!claim.shouldDeliver) {
        if (claim.shouldCleanup) await deleteActiveRunSafely(session.account.accountId, runKey);
        return;
      }
      const message = resultState.status === "cancelled"
        ? "本次本地 Agent 任务已取消。"
        : `本次处理失败，请在 Studio 查看本地 Agent 日志。${result?.error ? `\n${result.error}` : ""}`;
      try {
        await options.sendText(session, record.chatId, message, record.senderId);
      } finally {
        // A failed terminal notification must not leave a completed/cancelled
        // runtime holding the conversation lock forever.
        clearActiveRunPoll(session.account.accountId, runKey);
        options.agentBusyNoticeAt.delete(pollKey);
        await deleteActiveRunSafely(session.account.accountId, runKey);
      }
      return;
    }
    // Apply the backstop to every non-terminal state, including approval
    // waits. Otherwise a stale pending snapshot can hold the conversation
    // lock forever.
    if (Date.now() - (record.startedAt ?? 0) > options.activeRunMaxAgeMs) {
      const claim = await claimTerminalDelivery(session, runKey, record);
      if (!claim.shouldDeliver) {
        if (claim.shouldCleanup) await deleteActiveRunSafely(session.account.accountId, runKey);
        return;
      }
      const message = `本次本地 Agent 任务运行已超过上限（约 ${Math.round(options.activeRunMaxAgeMs / 3_600_000)} 小时），已自动超时并清除会话锁。可重新发送消息。`;
      await options.sendText(session, record.chatId, message, record.senderId).catch(() => undefined);
      options.agentBusyNoticeAt.delete(pollKey);
      await deleteActiveRunSafely(session.account.accountId, runKey);
      return;
    }
    const pendingApprovals = resultState.pendingApprovals;
    if (pendingApprovals.length && !record.pendingApprovalNotifiedAt) {
      if (options.clearedActiveRunKeys.has(pollKey)) return;
      const pendingApprovalNotifiedAt = Date.now();
      const updated = await writeActiveRunSafely(
        session.account.accountId,
        runKey,
        { status: "pending_approval", pendingApprovalNotifiedAt, pendingApprovals, statusQueryFailureCount: 0 },
        { ...record, status: "pending_approval", pendingApprovalNotifiedAt, pendingApprovals, statusQueryFailureCount: 0 },
      );
      if (!updated || options.clearedActiveRunKeys.has(pollKey)) return;
      try {
        await options.sendText(session, record.chatId, options.renderApprovalPrompt(updated, pendingApprovals), record.senderId);
      } finally {
        // The approval prompt is advisory; a transport failure must not stop
        // observation of the still-running task and its eventual result.
        scheduleActiveRunPoll(session, updated, options.pendingPollIntervalMs);
      }
      return;
    }
    if (pendingApprovals.length) {
      if (options.clearedActiveRunKeys.has(pollKey)) return;
      const updated = await writeActiveRunSafely(
        session.account.accountId,
        runKey,
        { status: "pending_approval", pendingApprovals, statusQueryFailureCount: 0 },
        { ...record, status: "pending_approval", pendingApprovals, statusQueryFailureCount: 0 },
      );
      if (!updated || options.clearedActiveRunKeys.has(pollKey)) return;
      scheduleActiveRunPoll(session, updated, options.pendingPollIntervalMs);
      return;
    }
    if (!resultState.isRunning || options.clearedActiveRunKeys.has(pollKey)) return;
    const updated = await writeActiveRunSafely(
      session.account.accountId,
      runKey,
      { status: "running", pendingApprovals: [], statusQueryFailureCount: 0 },
      { ...record, status: "running", pendingApprovals: [], statusQueryFailureCount: 0 },
    );
    if (!updated || options.clearedActiveRunKeys.has(pollKey)) return;
    scheduleActiveRunPoll(session, updated, options.pollIntervalMs);
  }

  function scheduleActiveRunPoll(session, run, delayMs = options.pollIntervalMs) {
    if (session.controller.signal.aborted || !run?.runKey || !run?.runId || !options.runtime?.getRun) return;
    const pollKey = `${session.account.accountId}:${run.runKey}`;
    if (options.clearedActiveRunKeys.has(pollKey)) return;
    if (inFlightPolls.has(pollKey)) {
      const priorPending = pendingSchedules.get(pollKey);
      if (!priorPending || delayMs < priorPending.delayMs) {
        pendingSchedules.set(pollKey, { session, run, delayMs: Math.max(0, delayMs) });
      }
      return;
    }
    const prior = pollers.get(pollKey);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(() => {
      pollers.delete(pollKey);
      const task = pollActiveRun(session, run.runKey, run).catch((error) => {
        if (session.controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        options.setLastError(message);
        // Do not blindly replay a poll after delivery-side effects. A file may
        // already have reached the recipient before a later text send fails;
        // retrying the completed snapshot would duplicate that attachment.
        options.appendLog({ type: "error", text: `weixin active run delivery failed: ${message}` });
        if (error instanceof RetryActiveRunPollError && !options.clearedActiveRunKeys.has(pollKey)) {
          scheduleActiveRunPoll(session, run, options.pollIntervalMs);
        }
      }).finally(() => {
        tasks.delete(task);
        if (inFlightPolls.get(pollKey) === task) inFlightPolls.delete(pollKey);
        const pending = pendingSchedules.get(pollKey);
        pendingSchedules.delete(pollKey);
        if (pending) scheduleActiveRunPoll(pending.session, pending.run, pending.delayMs);
      });
      tasks.add(task);
      inFlightPolls.set(pollKey, task);
    }, Math.max(0, delayMs));
    pollers.set(pollKey, timer);
  }

  function clearActiveRunPoll(accountId, runKey) {
    const pollKey = `${accountId}:${runKey}`;
    options.clearedActiveRunKeys.add(pollKey);
    const prior = pollers.get(pollKey);
    if (prior) clearTimeout(prior);
    pollers.delete(pollKey);
    pendingSchedules.delete(pollKey);
  }

  async function resumeActiveRuns(session) {
    const runs = await listActiveRunsSafely(session.account.accountId);
    for (const run of runs) scheduleActiveRunPoll(session, run, 0);
  }

  async function stopActiveRunPolling(currentTask) {
    for (const timer of pollers.values()) clearTimeout(timer);
    pollers.clear();
    pendingSchedules.clear();
    for (const [key, record] of activeRunRecords) {
      if (record?.reservationToken) {
        bumpActiveRunGeneration(key);
        activeRunRecords.delete(key);
      }
    }
    // The channel poll loop is abort-aware, but provider getRun calls may not
    // settle promptly. Their continuations check the session signal before
    // transport or persistence side effects, so do not block stop on them.
    await Promise.allSettled([currentTask].filter(Boolean));
    tasks.clear();
    inFlightPolls.clear();
  }

  return {
    clearActiveRunPoll,
    deleteActiveRunSafely,
    listActiveRunsSafely,
    readActiveRunSafely,
    releaseActiveRunReservation,
    reserveActiveRun,
    resumeActiveRuns,
    scheduleActiveRunPoll,
    stopActiveRunPolling,
    writeActiveRunSafely,
  };
}
