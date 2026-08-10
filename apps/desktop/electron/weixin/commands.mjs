export function parseAgentSwitchCommand(text) {
  const raw = String(text ?? "").trim();
  const match = raw.match(/^(?:#agent|\/agent|切换agent|切换Agent|切换代理)(?:\s+(.+))?$/i);
  if (!match) return null;
  return { target: String(match[1] ?? "").trim() };
}

export function parseModeCommand(text) {
  const raw = String(text ?? "").trim();
  const match = raw.match(/^(?:#mode|\/mode|#prompt|\/prompt|切换模式)(?:\s+(.+))?$/i);
  if (!match) return null;
  return { target: String(match[1] ?? "").trim() };
}

export function parseModelSwitchCommand(text) {
  const raw = String(text ?? "").trim();
  const match = raw.match(/^(?:#model|\/model|切换模型)(?:\s+(.+))?$/i);
  if (!match) return null;
  return { target: String(match[1] ?? "").trim() };
}

export function parseRunCommand(text) {
  const raw = String(text ?? "").trim().toLowerCase();
  if (raw === "#status" || raw === "/status" || raw === "状态") return { name: "status" };
  if (raw === "#runs" || raw === "/runs" || raw === "任务") return { name: "runs" };
  if (raw === "#cancel" || raw === "/cancel" || raw === "取消") return { name: "cancel" };
  if (raw === "#continue" || raw === "/continue" || raw === "继续") return { name: "continue" };
  if (["#new", "/new", "#new session", "/new session", "#reset", "/reset", "#reset session", "/reset session", "新会话", "重置会话"].includes(raw)) return { name: "new" };
  return null;
}

export function parseApprovalCommand(text) {
  const raw = String(text ?? "").trim().toLowerCase();
  const match = raw.match(/^(?:#|\/)?(approve|allow|yes|批准|同意|通过|deny|reject|no|拒绝|不同意)(?:\s+(.+))?$/i);
  if (!match) return null;
  const verb = String(match[1] ?? "").toLowerCase();
  const args = String(match[2] ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const accept = ["approve", "allow", "yes", "批准", "同意", "通过"].includes(verb);
  const session = args.some((arg) => ["session", "always", "本次", "本轮"].includes(arg));
  return {
    decision: accept ? (session ? "acceptForSession" : "accept") : "decline",
    all: args.includes("all") || args.includes("全部"),
  };
}
