import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { redactSensitiveText } from "../task-orchestrator/durable-redaction.mjs";

const SCHEMA_VERSION = 3;
const MAX_DELIVERY_ATTEMPTS = 10;
const DEFAULT_RECEIPT_LEASE_MS = 60_000;
const DEFAULT_DELIVERY_LEASE_MS = 30_000;

function bounded(value, max = 512) {
  return redactSensitiveText(String(value ?? ""), max);
}

function required(value, label, max = 512) {
  const text = String(value ?? "").trim();
  if (!text || text.length > max) throw new Error(`${label} is invalid`);
  return text;
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function routeFrom(input) {
  return {
    platform: required(input.platform, "platform", 40),
    accountId: required(input.accountId, "accountId", 240),
    chatId: required(input.chatId, "chatId", 240),
  };
}

function receiptIdentity(input) {
  const route = routeFrom(input);
  const messageId = required(input.messageId, "messageId", 240);
  return { ...route, messageId };
}

function deliveryRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    platform: row.platform,
    accountId: row.account_id,
    chatId: row.chat_id,
    taskId: row.task_id,
    taskRunId: row.task_run_id,
    eventId: row.event_id,
    kind: row.kind,
    payload: parseJson(row.payload_json, {}),
    status: row.status,
    attempts: Number(row.attempts),
    notBefore: Number(row.not_before),
    claimToken: row.claim_token,
    claimDeadline: row.claim_deadline == null ? null : Number(row.claim_deadline),
    lastError: row.last_error,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function createMessagingTaskStore(options = {}) {
  const userDataDir = required(options.userDataDir, "userDataDir", 4_096);
  const now = typeof options.now === "function" ? options.now : Date.now;
  const uuid = typeof options.randomUUID === "function" ? options.randomUUID : randomUUID;
  const receiptLeaseMs = Math.max(1_000, Number(options.receiptLeaseMs) || DEFAULT_RECEIPT_LEASE_MS);
  const deliveryLeaseMs = Math.max(1_000, Number(options.deliveryLeaseMs) || DEFAULT_DELIVERY_LEASE_MS);
  const root = path.join(userDataDir, "runtime-state", "channels");
  const databasePath = options.databasePath ?? path.join(root, "messaging-tasks.sqlite");
  await mkdir(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS inbound_receipts (
      platform TEXT NOT NULL,
      account_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      command_digest TEXT NOT NULL,
      command_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('available','processing','completed','failed')),
      claim_token TEXT,
      claim_deadline INTEGER,
      result_json TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(platform, account_id, chat_id, message_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS task_bindings (
      platform TEXT NOT NULL,
      account_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      task_run_id TEXT,
      revision INTEGER,
      status TEXT,
      event_cursor INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(platform, account_id, chat_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS delivery_outbox (
      id TEXT PRIMARY KEY,
      dedupe_key TEXT NOT NULL UNIQUE,
      platform TEXT NOT NULL,
      account_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      task_id TEXT,
      task_run_id TEXT,
      event_id TEXT,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('available','claimed','acked','dead')),
      attempts INTEGER NOT NULL DEFAULT 0,
      not_before INTEGER NOT NULL,
      claim_token TEXT,
      claim_deadline INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS delivery_outbox_ready_idx
      ON delivery_outbox(status, not_before, created_at);
    CREATE TABLE IF NOT EXISTS local_notifications (
      event_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      task_run_id TEXT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('unread','read')),
      event_sequence INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS notification_cursors (
      task_id TEXT PRIMARY KEY,
      event_sequence INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS notification_stream_cursors (
      stream_key TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      task_run_id TEXT,
      event_sequence INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS delivery_stream_cursors (
      platform TEXT NOT NULL,
      account_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      task_run_key TEXT NOT NULL,
      event_sequence INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(platform, account_id, chat_id, task_id, task_run_key)
    ) STRICT;
    PRAGMA user_version=${SCHEMA_VERSION};
  `);
  const bindingColumns = db.prepare("PRAGMA table_info(task_bindings)").all().map((row) => row.name);
  if (!bindingColumns.includes("event_cursor")) {
    db.exec("ALTER TABLE task_bindings ADD COLUMN event_cursor INTEGER NOT NULL DEFAULT 0");
  }

  function transaction(callback) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* best effort */ }
      throw error;
    }
  }

  function claimInbound(input, command) {
    const id = receiptIdentity(input);
    const commandJson = json({ action: bounded(command?.action, 40), args: bounded(command?.args, 4_000) });
    const commandDigest = digest(commandJson);
    const observedAt = now();
    const claimToken = uuid();
    return transaction(() => {
      const row = db.prepare(`SELECT * FROM inbound_receipts
        WHERE platform=? AND account_id=? AND chat_id=? AND message_id=?`).get(
        id.platform, id.accountId, id.chatId, id.messageId,
      );
      if (row && row.command_digest !== commandDigest) {
        throw Object.assign(new Error("Message identity was reused with a different Task command"), { code: "MESSAGE_ID_CONFLICT" });
      }
      if (row?.status === "completed") {
        return { state: "completed", result: parseJson(row.result_json, {}), identity: id };
      }
      if (row?.status === "failed") {
        return { state: "failed", error: row.last_error, identity: id };
      }
      if (row?.status === "processing" && Number(row.claim_deadline ?? 0) > observedAt) {
        return { state: "processing", identity: id };
      }
      if (row) {
        db.prepare(`UPDATE inbound_receipts SET status='processing', claim_token=?, claim_deadline=?,
          last_error=NULL, updated_at=? WHERE platform=? AND account_id=? AND chat_id=? AND message_id=?`).run(
          claimToken, observedAt + receiptLeaseMs, observedAt,
          id.platform, id.accountId, id.chatId, id.messageId,
        );
      } else {
        db.prepare(`INSERT INTO inbound_receipts
          (platform,account_id,chat_id,message_id,command_digest,command_json,status,claim_token,claim_deadline,created_at,updated_at)
          VALUES (?,?,?,?,?,?,'processing',?,?,?,?)`).run(
          id.platform, id.accountId, id.chatId, id.messageId, commandDigest, commandJson,
          claimToken, observedAt + receiptLeaseMs, observedAt, observedAt,
        );
      }
      return { state: "claimed", claimToken, identity: id };
    });
  }

  function finishInbound(claim, result) {
    const changed = db.prepare(`UPDATE inbound_receipts SET status='completed', result_json=?,
      claim_token=NULL, claim_deadline=NULL, updated_at=?
      WHERE platform=? AND account_id=? AND chat_id=? AND message_id=? AND status='processing' AND claim_token=?`).run(
      json(result), now(), claim.identity.platform, claim.identity.accountId,
      claim.identity.chatId, claim.identity.messageId, claim.claimToken,
    );
    if (Number(changed.changes) !== 1) throw new Error("Inbound Task receipt claim was lost");
  }

  function failInbound(claim, error, { retryable = true } = {}) {
    db.prepare(`UPDATE inbound_receipts SET status=?, last_error=?, claim_token=NULL,
      claim_deadline=NULL, updated_at=?
      WHERE platform=? AND account_id=? AND chat_id=? AND message_id=? AND status='processing' AND claim_token=?`).run(
      retryable ? "available" : "failed", bounded(error?.code ?? error?.name ?? "TaskCommandError", 120), now(),
      claim.identity.platform, claim.identity.accountId, claim.identity.chatId,
      claim.identity.messageId, claim.claimToken,
    );
  }

  function upsertBinding(input) {
    const route = routeFrom(input);
    const observedAt = now();
    db.prepare(`INSERT INTO task_bindings
      (platform,account_id,chat_id,task_id,task_run_id,revision,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(platform,account_id,chat_id) DO UPDATE SET
        task_id=excluded.task_id, task_run_id=excluded.task_run_id,
        revision=excluded.revision, status=excluded.status,
        event_cursor=CASE WHEN task_bindings.task_id=excluded.task_id AND
          COALESCE(task_bindings.task_run_id,'')=COALESCE(excluded.task_run_id,'')
          THEN task_bindings.event_cursor ELSE 0 END,
        updated_at=excluded.updated_at`).run(
      route.platform, route.accountId, route.chatId,
      required(input.taskId, "taskId", 240), input.taskRunId == null ? null : required(input.taskRunId, "taskRunId", 240),
      input.revision == null ? null : Math.max(1, Number(input.revision) || 1),
      bounded(input.status, 80) || null, observedAt, observedAt,
    );
  }

  function getBinding(input) {
    const route = routeFrom(input);
    const row = db.prepare(`SELECT * FROM task_bindings WHERE platform=? AND account_id=? AND chat_id=?`).get(
      route.platform, route.accountId, route.chatId,
    );
    return row ? {
      ...route,
      taskId: row.task_id,
      taskRunId: row.task_run_id,
      revision: row.revision == null ? null : Number(row.revision),
      status: row.status,
      eventCursor: Number(row.event_cursor ?? 0),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    } : null;
  }

  function listBindings(input, limit = 20) {
    const route = routeFrom(input);
    return db.prepare(`SELECT * FROM task_bindings WHERE platform=? AND account_id=? AND chat_id=?
      ORDER BY updated_at DESC LIMIT ?`).all(route.platform, route.accountId, route.chatId, Math.min(100, Math.max(1, limit)))
      .map((row) => ({ taskId: row.task_id, taskRunId: row.task_run_id, revision: row.revision, status: row.status, updatedAt: row.updated_at }));
  }

  function listBindingsForTask(taskId, limit = 100) {
    return db.prepare(`SELECT * FROM task_bindings WHERE task_id=? ORDER BY updated_at DESC LIMIT ?`).all(
      required(taskId, "taskId", 240), Math.min(500, Math.max(1, limit)),
    ).map((row) => ({
      platform: row.platform,
      accountId: row.account_id,
      chatId: row.chat_id,
      taskId: row.task_id,
      taskRunId: row.task_run_id,
      revision: row.revision,
      status: row.status,
      eventCursor: Number(row.event_cursor ?? 0),
      updatedAt: row.updated_at,
    }));
  }

  function listAllBindings(limit = 500) {
    return db.prepare("SELECT * FROM task_bindings ORDER BY updated_at DESC LIMIT ?").all(Math.min(2_000, Math.max(1, limit)))
      .map((row) => ({
        platform: row.platform,
        accountId: row.account_id,
        chatId: row.chat_id,
        taskId: row.task_id,
        taskRunId: row.task_run_id,
        revision: row.revision,
        status: row.status,
        eventCursor: Number(row.event_cursor ?? 0),
      }));
  }

  function advanceBindingEventCursor(input, sequence, taskRunId = null) {
    const route = routeFrom(input);
    db.prepare(`UPDATE task_bindings SET event_cursor=MAX(event_cursor, ?),
      task_run_id=COALESCE(?,task_run_id), updated_at=?
      WHERE platform=? AND account_id=? AND chat_id=?`).run(
      Math.max(0, Number(sequence) || 0), taskRunId == null ? null : bounded(taskRunId, 240),
      now(), route.platform, route.accountId, route.chatId,
    );
  }

  function streamKey(taskId, taskRunId = null) {
    return json([required(taskId, "taskId", 240), taskRunId == null ? null : required(taskRunId, "taskRunId", 240)]);
  }

  function advanceNotificationCursor(event) {
    const taskId = required(event?.taskId, "taskId", 240);
    const taskRunId = event?.taskRunId == null ? null : required(event.taskRunId, "taskRunId", 240);
    const sequence = Math.max(0, Number(event?.sequence) || 0);
    db.prepare(`INSERT INTO notification_stream_cursors(stream_key,task_id,task_run_id,event_sequence,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(stream_key) DO UPDATE SET
      event_sequence=MAX(event_sequence,excluded.event_sequence),updated_at=excluded.updated_at`).run(
      streamKey(taskId, taskRunId), taskId, taskRunId, sequence, now(),
    );
  }

  function notificationCursor(taskId, taskRunId = null) {
    return Number(db.prepare("SELECT event_sequence FROM notification_stream_cursors WHERE stream_key=?")
      .get(streamKey(taskId, taskRunId))?.event_sequence ?? 0);
  }

  function deliveryCursor(input, taskId, taskRunId = null) {
    const route = routeFrom(input);
    return Number(db.prepare(`SELECT event_sequence FROM delivery_stream_cursors
      WHERE platform=? AND account_id=? AND chat_id=? AND task_id=? AND task_run_key=?`).get(
      route.platform, route.accountId, route.chatId, required(taskId, "taskId", 240), taskRunId == null ? "" : required(taskRunId, "taskRunId", 240),
    )?.event_sequence ?? 0);
  }

  function advanceDeliveryCursor(input, taskId, taskRunId, sequence) {
    const route = routeFrom(input);
    db.prepare(`INSERT INTO delivery_stream_cursors
      (platform,account_id,chat_id,task_id,task_run_key,event_sequence,updated_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(platform,account_id,chat_id,task_id,task_run_key)
      DO UPDATE SET event_sequence=MAX(event_sequence,excluded.event_sequence),updated_at=excluded.updated_at`).run(
      route.platform, route.accountId, route.chatId, required(taskId, "taskId", 240),
      taskRunId == null ? "" : required(taskRunId, "taskRunId", 240), Math.max(0, Number(sequence) || 0), now(),
    );
  }

  function enqueueLocalNotification(event) {
    const eventId = required(event?.id, "eventId", 240);
    const taskId = required(event?.taskId, "taskId", 240);
    const observedAt = now();
    db.prepare(`INSERT INTO local_notifications
      (event_id,task_id,task_run_id,type,message,status,event_sequence,created_at,updated_at)
      VALUES (?,?,?,?,?,'unread',?,?,?) ON CONFLICT(event_id) DO NOTHING`).run(
      eventId, taskId, event.taskRunId == null ? null : bounded(event.taskRunId, 240),
      bounded(event.type, 80), bounded(event.message, 4_000),
      Math.max(0, Number(event.sequence) || 0), observedAt, observedAt,
    );
  }

  function unreadNotificationCount() {
    return Number(db.prepare("SELECT COUNT(*) AS count FROM local_notifications WHERE status='unread'").get()?.count ?? 0);
  }

  function enqueueDelivery(input) {
    const route = routeFrom(input);
    const dedupeKey = required(input.dedupeKey, "dedupeKey", 240);
    const observedAt = now();
    const id = `delivery-${uuid()}`;
    db.prepare(`INSERT INTO delivery_outbox
      (id,dedupe_key,platform,account_id,chat_id,task_id,task_run_id,event_id,kind,payload_json,status,attempts,not_before,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'available',0,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`).run(
      id, dedupeKey, route.platform, route.accountId, route.chatId,
      input.taskId == null ? null : bounded(input.taskId, 240),
      input.taskRunId == null ? null : bounded(input.taskRunId, 240),
      input.eventId == null ? null : bounded(input.eventId, 240),
      bounded(input.kind, 80) || "reply", json({ text: bounded(input.text, 4_000) }),
      Math.max(observedAt, Number(input.notBefore) || observedAt), observedAt, observedAt,
    );
    return deliveryRow(db.prepare("SELECT * FROM delivery_outbox WHERE dedupe_key=?").get(dedupeKey));
  }

  function claimDeliveries({ limit = 20, deliveryId = null } = {}) {
    const observedAt = now();
    return transaction(() => {
      const query = deliveryId
        ? `SELECT * FROM delivery_outbox WHERE id=? AND ((status='available' AND not_before<=?) OR (status='claimed' AND claim_deadline<=?)) LIMIT 1`
        : `SELECT * FROM delivery_outbox WHERE (status='available' AND not_before<=?) OR (status='claimed' AND claim_deadline<=?) ORDER BY created_at,id LIMIT ?`;
      const rows = deliveryId
        ? db.prepare(query).all(deliveryId, observedAt, observedAt)
        : db.prepare(query).all(observedAt, observedAt, Math.min(100, Math.max(1, limit)));
      return rows.map((row) => {
        const claimToken = uuid();
        db.prepare(`UPDATE delivery_outbox SET status='claimed', attempts=attempts+1,
          claim_token=?, claim_deadline=?, updated_at=? WHERE id=?`).run(
          claimToken, observedAt + deliveryLeaseMs, observedAt, row.id,
        );
        return deliveryRow(db.prepare("SELECT * FROM delivery_outbox WHERE id=?").get(row.id));
      });
    });
  }

  function ackDelivery(id, claimToken) {
    return Number(db.prepare(`UPDATE delivery_outbox SET status='acked', claim_token=NULL,
      claim_deadline=NULL, last_error=NULL, updated_at=? WHERE id=? AND status='claimed' AND claim_token=?`).run(
      now(), required(id, "deliveryId", 240), required(claimToken, "claimToken", 240),
    ).changes) === 1;
  }

  function releaseDelivery(id, claimToken, error) {
    const deliveryId = required(id, "deliveryId", 240);
    const token = required(claimToken, "claimToken", 240);
    const row = db.prepare("SELECT attempts FROM delivery_outbox WHERE id=? AND status='claimed' AND claim_token=?").get(deliveryId, token);
    if (!row) return false;
    const attempts = Number(row.attempts);
    const dead = attempts >= MAX_DELIVERY_ATTEMPTS;
    const delayMs = Math.min(60 * 60_000, 1_000 * (2 ** Math.min(12, Math.max(0, attempts - 1))));
    return Number(db.prepare(`UPDATE delivery_outbox SET status=?, not_before=?, claim_token=NULL,
      claim_deadline=NULL, last_error=?, updated_at=? WHERE id=? AND status='claimed' AND claim_token=?`).run(
      dead ? "dead" : "available", now() + delayMs,
      bounded(error?.code ?? error?.name ?? "DeliveryError", 120), now(), deliveryId, token,
    ).changes) === 1;
  }

  function counts() {
    return Object.fromEntries(db.prepare("SELECT status, COUNT(*) AS count FROM delivery_outbox GROUP BY status").all()
      .map((row) => [row.status, Number(row.count)]));
  }

  return Object.freeze({
    databasePath,
    claimInbound,
    finishInbound,
    failInbound,
    upsertBinding,
    getBinding,
    listBindings,
    listBindingsForTask,
    listAllBindings,
    advanceBindingEventCursor,
    deliveryCursor,
    advanceDeliveryCursor,
    enqueueLocalNotification,
    advanceNotificationCursor,
    notificationCursor,
    unreadNotificationCount,
    enqueueDelivery,
    claimDeliveries,
    ackDelivery,
    releaseDelivery,
    counts,
    close: () => db.close(),
  });
}
