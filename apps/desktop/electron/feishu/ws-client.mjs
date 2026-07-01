import { Buffer } from "node:buffer";

const FRAME_CONTROL = 0;
const FRAME_DATA = 1;
const TYPE_EVENT = "event";
const TYPE_CARD = "card";
const TYPE_PING = "ping";
const TYPE_PONG = "pong";
const HEADER_TYPE = "type";
const HEADER_MESSAGE_ID = "message_id";
const HEADER_SUM = "sum";
const HEADER_SEQ = "seq";
const HEADER_TRACE_ID = "trace_id";
const HEADER_BIZ_RT = "biz_rt";
const DEVICE_ID = "device_id";
const SERVICE_ID = "service_id";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeVarint(value) {
  let n = BigInt(value);
  const out = [];
  while (n >= 0x80n) {
    out.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  out.push(Number(n));
  return Buffer.from(out);
}

function decodeVarint(buffer, offset) {
  let shift = 0n;
  let result = 0n;
  let cursor = offset;
  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    result |= BigInt(byte & 0x7f) << shift;
    cursor += 1;
    if ((byte & 0x80) === 0) return { value: result, offset: cursor };
    shift += 7n;
  }
  throw new Error("invalid protobuf varint");
}

function encodeField(tag, payload) {
  return Buffer.concat([encodeVarint(tag), payload]);
}

function encodeUintField(fieldNumber, value) {
  return encodeField((fieldNumber << 3) | 0, encodeVarint(value));
}

function encodeStringField(fieldNumber, value) {
  const payload = Buffer.from(String(value ?? ""), "utf8");
  return encodeField((fieldNumber << 3) | 2, Buffer.concat([encodeVarint(payload.length), payload]));
}

function encodeBytesField(fieldNumber, value) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value ?? "");
  return encodeField((fieldNumber << 3) | 2, Buffer.concat([encodeVarint(payload.length), payload]));
}

function skipProtobufField(buffer, wireType, offset) {
  if (wireType === 0) return decodeVarint(buffer, offset).offset;
  if (wireType === 1) return offset + 8;
  if (wireType === 2) {
    const length = decodeVarint(buffer, offset);
    return length.offset + Number(length.value);
  }
  if (wireType === 5) return offset + 4;
  throw new Error(`unsupported protobuf wire type ${wireType}`);
}

function encodeHeader(header) {
  return Buffer.concat([
    encodeStringField(1, header.key),
    encodeStringField(2, header.value),
  ]);
}

function decodeHeader(buffer) {
  const header = { key: "", value: "" };
  let offset = 0;
  while (offset < buffer.length) {
    const tag = decodeVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n);
    if (wireType !== 2) {
      offset = skipProtobufField(buffer, wireType, offset);
      continue;
    }
    const length = decodeVarint(buffer, offset);
    offset = length.offset;
    const end = offset + Number(length.value);
    const text = buffer.subarray(offset, end).toString("utf8");
    offset = end;
    if (fieldNumber === 1) header.key = text;
    if (fieldNumber === 2) header.value = text;
  }
  return header;
}

export function encodeFeishuFrame(frame = {}) {
  const chunks = [
    encodeUintField(1, BigInt(frame.seqId ?? frame.SeqID ?? 0)),
    encodeUintField(2, BigInt(frame.logId ?? frame.LogID ?? 0)),
    encodeUintField(3, Number(frame.service ?? 0)),
    encodeUintField(4, Number(frame.method ?? 0)),
  ];
  for (const header of frame.headers ?? []) chunks.push(encodeBytesField(5, encodeHeader(header)));
  if (frame.payloadEncoding) chunks.push(encodeStringField(6, frame.payloadEncoding));
  if (frame.payloadType) chunks.push(encodeStringField(7, frame.payloadType));
  if (frame.payload !== undefined) chunks.push(encodeBytesField(8, frame.payload));
  if (frame.logIdNew) chunks.push(encodeStringField(9, frame.logIdNew));
  return Buffer.concat(chunks);
}

export function decodeFeishuFrame(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const frame = { seqId: 0n, logId: 0n, service: 0, method: 0, headers: [], payload: Buffer.alloc(0), payloadEncoding: "", payloadType: "", logIdNew: "" };
  let offset = 0;
  while (offset < buffer.length) {
    const tag = decodeVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n);
    if (wireType === 0) {
      const value = decodeVarint(buffer, offset);
      offset = value.offset;
      if (fieldNumber === 1) frame.seqId = value.value;
      if (fieldNumber === 2) frame.logId = value.value;
      if (fieldNumber === 3) frame.service = Number(value.value);
      if (fieldNumber === 4) frame.method = Number(value.value);
      continue;
    }
    if (wireType !== 2) {
      offset = skipProtobufField(buffer, wireType, offset);
      continue;
    }
    const length = decodeVarint(buffer, offset);
    offset = length.offset;
    const end = offset + Number(length.value);
    const payload = buffer.subarray(offset, end);
    offset = end;
    if (fieldNumber === 5) frame.headers.push(decodeHeader(payload));
    if (fieldNumber === 6) frame.payloadEncoding = payload.toString("utf8");
    if (fieldNumber === 7) frame.payloadType = payload.toString("utf8");
    if (fieldNumber === 8) frame.payload = Buffer.from(payload);
    if (fieldNumber === 9) frame.logIdNew = payload.toString("utf8");
  }
  return frame;
}

function getHeader(frame, key) {
  return frame.headers.find((header) => header.key === key)?.value ?? "";
}

function addHeader(frame, key, value) {
  return { ...frame, headers: [...frame.headers, { key, value: String(value) }] };
}

function parseClientConfig(value = {}) {
  return {
    reconnectCount: Number.isFinite(Number(value.ReconnectCount ?? value.reconnect_count)) ? Number(value.ReconnectCount ?? value.reconnect_count) : -1,
    reconnectIntervalMs: Number.isFinite(Number(value.ReconnectInterval ?? value.reconnect_interval)) ? Math.max(1, Number(value.ReconnectInterval ?? value.reconnect_interval)) * 1000 : 120_000,
    reconnectNonceMs: Number.isFinite(Number(value.ReconnectNonce ?? value.reconnect_nonce)) ? Math.max(0, Number(value.ReconnectNonce ?? value.reconnect_nonce)) * 1000 : 30_000,
    pingIntervalMs: Number.isFinite(Number(value.PingInterval ?? value.ping_interval)) ? Math.max(1, Number(value.PingInterval ?? value.ping_interval)) * 1000 : 120_000,
  };
}

function websocketStateName(socket) {
  if (!socket) return "closed";
  if (socket.readyState === 0) return "connecting";
  if (socket.readyState === 1) return "open";
  if (socket.readyState === 2) return "closing";
  return "closed";
}

export function createFeishuWebSocketClient(options = {}) {
  const client = options.client;
  const WebSocketCtor = options.WebSocketCtor ?? globalThis.WebSocket;
  const onEvent = typeof options.onEvent === "function" ? options.onEvent : async () => undefined;
  const onState = typeof options.onState === "function" ? options.onState : () => undefined;
  const appendLog = typeof options.appendLog === "function" ? options.appendLog : () => undefined;
  const reconnectOverride = Number.isFinite(Number(options.reconnectIntervalMs)) ? Math.max(50, Number(options.reconnectIntervalMs)) : null;
  const endpointRetryMs = Number.isFinite(Number(options.endpointRetryMs)) ? Math.max(50, Number(options.endpointRetryMs)) : 1_000;
  let socket = null;
  let stopped = false;
  let connecting = false;
  let pingTimer = null;
  let reconnectTimer = null;
  let config = parseClientConfig();
  let serviceId = 0;
  let reconnectAttempts = 0;
  const fragments = new Map();

  function emitState(patch) {
    onState({ websocketState: websocketStateName(socket), ...patch });
  }

  function clearTimers() {
    if (pingTimer) clearInterval(pingTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    pingTimer = null;
    reconnectTimer = null;
  }

  function sendFrame(frame) {
    if (!socket || socket.readyState !== 1) throw new Error("Feishu websocket is not open");
    socket.send(encodeFeishuFrame(frame));
  }

  function startPingLoop() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      try {
        sendFrame({ service: serviceId, method: FRAME_CONTROL, headers: [{ key: HEADER_TYPE, value: TYPE_PING }] });
      } catch (error) {
        appendLog({ type: "warn", text: `feishu websocket ping failed: ${error.message}` });
      }
    }, config.pingIntervalMs);
  }

  function scheduleReconnect(reason) {
    if (stopped || reconnectTimer) return;
    const max = config.reconnectCount;
    if (max >= 0 && reconnectAttempts >= max) {
      emitState({ status: "error", lastError: `websocket reconnect limit reached: ${reason}` });
      return;
    }
    reconnectAttempts += 1;
    const delay = reconnectOverride ?? (reconnectAttempts === 1 ? Math.floor(Math.random() * config.reconnectNonceMs) : config.reconnectIntervalMs);
    emitState({ status: "reconnecting", lastDisconnectAt: Date.now(), lastError: reason, reconnectAttempts });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect().catch((error) => scheduleReconnect(error.message));
    }, delay);
  }

  function closeSocket() {
    const current = socket;
    socket = null;
    if (!current) return;
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
    if (current.readyState === 0 || current.readyState === 1) current.close();
  }

  async function connect() {
    if (connecting || stopped) return;
    if (typeof WebSocketCtor !== "function") throw new Error("Feishu websocket mode requires WebSocket support");
    if (!client?.getWebSocketEndpoint) throw new Error("Feishu client is missing getWebSocketEndpoint");
    connecting = true;
    clearTimers();
    closeSocket();
    emitState({ websocketState: "connecting", lastError: null });
    try {
      const endpoint = await client.getWebSocketEndpoint(options.account);
      config = { ...config, ...parseClientConfig(endpoint.clientConfig ?? {}) };
      const url = new URL(endpoint.url);
      serviceId = Number(url.searchParams.get(SERVICE_ID) ?? 0);
      const deviceId = url.searchParams.get(DEVICE_ID) ?? "";
      await new Promise((resolve, reject) => {
        const ws = new WebSocketCtor(endpoint.url);
        socket = ws;
        ws.binaryType = "arraybuffer";
        ws.onopen = () => {
          reconnectAttempts = 0;
          emitState({ websocketState: "open", lastConnectAt: Date.now(), connId: deviceId, serviceId, lastError: null });
          startPingLoop();
          resolve();
        };
        ws.onerror = () => reject(new Error("Feishu websocket connection failed"));
        ws.onclose = (event) => {
          clearTimers();
          emitState({ websocketState: "closed", lastDisconnectAt: Date.now() });
          if (!stopped) scheduleReconnect(`websocket closed${event?.code ? ` code=${event.code}` : ""}`);
        };
        ws.onmessage = (event) => {
          void handleMessage(event.data).catch((error) => {
            appendLog({ type: "error", text: `feishu websocket frame failed: ${error.message}` });
            emitState({ lastError: error.message });
          });
        };
      });
    } catch (error) {
      emitState({ websocketState: "closed", lastError: error instanceof Error ? error.message : String(error) });
      await sleep(endpointRetryMs);
      throw error;
    } finally {
      connecting = false;
    }
  }

  async function handleMessage(data) {
    const frame = decodeFeishuFrame(Buffer.from(data));
    if (frame.method === FRAME_CONTROL) {
      const type = getHeader(frame, HEADER_TYPE);
      if (type === TYPE_PONG && frame.payload.length) config = { ...config, ...parseClientConfig(JSON.parse(frame.payload.toString("utf8"))) };
      return;
    }
    if (frame.method !== FRAME_DATA) return;
    const type = getHeader(frame, HEADER_TYPE);
    if (type !== TYPE_EVENT && type !== TYPE_CARD) return;
    let payload = frame.payload;
    const messageId = getHeader(frame, HEADER_MESSAGE_ID);
    const sum = Number(getHeader(frame, HEADER_SUM) || 1);
    const seq = Number(getHeader(frame, HEADER_SEQ) || 0);
    if (sum > 1) {
      const key = messageId || `${getHeader(frame, HEADER_TRACE_ID)}:${sum}`;
      const parts = fragments.get(key) ?? Array.from({ length: sum }, () => null);
      parts[seq] = payload;
      if (parts.some((part) => !part)) {
        fragments.set(key, parts);
        return;
      }
      fragments.delete(key);
      payload = Buffer.concat(parts);
    }
    const startedAt = Date.now();
    const response = { code: 200 };
    try {
      await onEvent(JSON.parse(payload.toString("utf8")), { frame, type });
    } catch (error) {
      response.code = 500;
      appendLog({ type: "error", text: `feishu websocket event failed: ${error instanceof Error ? error.message : String(error)}` });
    }
    const ackFrame = addHeader(frame, HEADER_BIZ_RT, String(Date.now() - startedAt));
    sendFrame({ ...ackFrame, payload: Buffer.from(JSON.stringify(response), "utf8") });
  }

  return {
    start: connect,
    stop() {
      stopped = true;
      clearTimers();
      closeSocket();
      emitState({ websocketState: "closed", lastDisconnectAt: Date.now() });
    },
    status() {
      return { websocketState: websocketStateName(socket), serviceId, reconnectAttempts };
    },
  };
}

export const __test__ = {
  encodeVarint,
  decodeVarint,
  encodeFeishuFrame,
  decodeFeishuFrame,
  TYPE_EVENT,
  TYPE_PING,
  TYPE_PONG,
  FRAME_CONTROL,
  FRAME_DATA,
  HEADER_TYPE,
  HEADER_MESSAGE_ID,
  HEADER_SUM,
  HEADER_SEQ,
  HEADER_TRACE_ID,
};
