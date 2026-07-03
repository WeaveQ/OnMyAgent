export class AcpE2EStreamInjector {
  constructor({ appendEvent }) {
    this.appendEvent = appendEvent;
  }

  emit(update) {
    const kind = String(update?.sessionUpdate ?? update?.type ?? "").trim();
    if (kind === "available_commands") {
      this.appendEvent({ type: "status", text: `acp_available_commands> ${JSON.stringify(update.commands ?? [])}` });
      return;
    }
    if (kind === "context_usage") {
      this.appendEvent({ type: "status", text: `acp_context_usage> ${JSON.stringify({ used: update.used, total: update.total })}` });
      return;
    }
    if (kind === "error") {
      this.appendEvent({ type: "tips", text: update.message, category: "error", ownership: update.ownership, resolution: update.resolution });
      return;
    }
    if (kind === "plan") {
      this.appendEvent({ type: "plan", text: update.entries?.[0]?.title ?? "Plan", entries: update.entries });
      return;
    }
    if (kind === "thinking") {
      this.appendEvent({ type: "thinking", text: update.content ?? "Thinking", status: update.status, msgId: update.msg_id });
      return;
    }
    if (kind === "tool_call") {
      this.appendEvent({ type: "acp_tool_call", text: update.title, update: { toolCallId: update.tool_call_id, title: update.title, kind: update.kind, status: update.status, output: update.output }, msgId: update.msg_id });
    }
  }

  emitAll() {
    this.emit({ sessionUpdate: "plan", entries: [{ id: "plan-1", title: "Plan item", status: "completed" }] });
    this.emit({ sessionUpdate: "thinking", content: "Thinking item", status: "thinking", msg_id: "msg-1" });
    this.emit({ sessionUpdate: "tool_call", tool_call_id: "tool-1", title: "Read file", kind: "read", status: "completed", msg_id: "msg-1", output: "ok" });
    this.emit({ sessionUpdate: "tool_call", tool_call_id: "tool-2", title: "Run command", kind: "execute", status: "completed", msg_id: "msg-1", output: "done" });
    this.emit({ sessionUpdate: "available_commands", commands: [{ name: "/help", description: "Help" }] });
    this.emit({ sessionUpdate: "context_usage", used: 10, total: 100 });
    this.emit({ sessionUpdate: "error", message: "Provider timeout", ownership: "provider", resolution: { target: "provider", kind: "retry", message: "Retry later" } });
  }
}
