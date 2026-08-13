import path from "node:path";

const TASK_CONTROL_SERVER = "onmyagent-task-control";
const CONTRACT_TOOL = "propose_contract";

function text(value) {
  return String(value ?? "").trim();
}

function toolCallUpdate(event) {
  if (event?.type !== "acp_tool_call") return null;
  if (event?.update && typeof event.update === "object") return event.update;
  try {
    const parsed = JSON.parse(String(event?.text ?? ""));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Codex ACP asks for permission before invoking even a task-scoped MCP tool.
 * Alignment may auto-approve only its own inert, schema-validated contract
 * submission. Every other approval remains fail-closed.
 */
export function isContractProposalApproval(task, snapshot, approval) {
  return taskControlMcpCallForApproval({
    provider: task?.primary?.provider,
    workspaceRoot: task?.workspaceRoot,
  }, snapshot, approval)?.tool === CONTRACT_TOOL;
}

/** Return the exact correlated task MCP call, or null for any ambiguity. */
export function taskControlMcpCallForApproval(context, snapshot, approval) {
  const toolCallId = text(approval?.params?.toolCall?.toolCallId);
  const approvalCwd = text(approval?.cwd);
  const workspaceRoot = text(context?.workspaceRoot);
  if (
    !toolCallId
    || text(approval?.id) === ""
    || !approvalCwd
    || !workspaceRoot
    || approval?.provider !== context?.provider
    || approval?.method !== "session/request_permission"
    || approval?.kind !== "command"
    || text(approval?.command) !== ""
    || approval?.params?._meta?.is_mcp_tool_approval !== true
    || path.resolve(approvalCwd) !== path.resolve(workspaceRoot)
  ) return null;

  for (const event of Array.isArray(snapshot?.events) ? snapshot.events : []) {
    const update = toolCallUpdate(event);
    if (update?.sessionUpdate === "tool_call"
      && text(update?.toolCallId) === toolCallId
      && update?._meta?.is_mcp_tool_call === true
      && update?.rawInput?.server === TASK_CONTROL_SERVER
      && text(update?.rawInput?.tool)
    ) return update.rawInput;
  }
  return null;
}
