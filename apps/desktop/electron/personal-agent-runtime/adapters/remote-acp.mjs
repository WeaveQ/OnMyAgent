function remoteUrlFromAgent(agent) {
  return String(agent?.remote?.webSocketUrl ?? agent?.remote?.url ?? agent?.webSocketUrl ?? agent?.wsUrl ?? "").trim();
}

function requestOverWebSocket(ws, pending, nextIdRef, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = nextIdRef.next++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(method + " timed out"));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}

export function normalizeRemoteAgent(agent) {
  const url = remoteUrlFromAgent(agent);
  return { ...agent, provider: "remote", id: String(agent?.id ?? "remote").trim() || "remote", remote: { ...(agent?.remote ?? {}), url } };
}

export function createRemoteAcpAdapter({ appendEvent, registerCancel }) {
  return {
    async sendMessage(ctx) {
      const url = remoteUrlFromAgent(ctx.agent);
      if (!url) throw new Error("remote agent WebSocket URL is required");
      appendEvent?.({ type: "status", text: "Remote ACP WebSocket connecting" });
      const ws = new WebSocket(url);
      const pending = new Map();
      const nextIdRef = { next: 1 };
      ws.addEventListener("message", (event) => {
        let message;
        try {
          message = JSON.parse(String(event.data));
        } catch (parseError) {
          appendEvent?.({ type: "error", text: `Remote ACP invalid message: ${parseError.message}` });
          return;
        }
        if (message.method === "session/update") {
          appendEvent?.({ type: "acp_session_update", update: message.params });
          return;
        }
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        message.error ? entry.reject(new Error(message.error.message || JSON.stringify(message.error))) : entry.resolve(message.result);
      });
      registerCancel?.(() => ws.close());
      await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve, { once: true });
        ws.addEventListener("error", () => reject(new Error("remote agent WebSocket connection failed")), { once: true });
      });
      const request = (method, params) => requestOverWebSocket(ws, pending, nextIdRef, method, params, Number(ctx.agent?.remote?.timeoutMs) || 30000);
      try {
        const initialized = await request("initialize", { protocolVersion: 1, clientInfo: { name: "onmyagent-personal-agent", version: "0.1.0" } });
        const session = await request(ctx.providerSessionId ? "session/resume" : "session/new", { sessionId: ctx.providerSessionId ?? undefined, cwd: ctx.workspaceRoot });
        const sessionId = String(session?.sessionId ?? session?.session_id ?? session?.id ?? ctx.providerSessionId ?? "").trim() || null;
        if (!sessionId) throw new Error("remote ACP session/resume returned no sessionId");
        const result = await request("session/prompt", { sessionId, prompt: ctx.prompt, cwd: ctx.workspaceRoot });
        const output = String(result?.output ?? result?.text ?? result?.message ?? "");
        return {
          output,
          command: "remote-acp " + url,
          connectionMode: "Remote ACP WebSocket session",
          providerSessionId: String(result?.sessionId ?? result?.session_id ?? sessionId ?? "").trim() || sessionId,
          resumeKey: String(result?.resumeKey ?? result?.resume_key ?? result?.sessionId ?? result?.session_id ?? sessionId ?? "").trim() || sessionId,
          metadata: { agent_type: "remote", initialized },
        };
      } finally {
        ws.close();
      }
    },
  };
}
