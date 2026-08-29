import { writeSession } from "./session-store.mjs";

export function failedToolUpdateCode(detail) {
  const text = String(detail ?? "");
  return /"exit_code"\s*:\s*null/i.test(text)
    || /conversation interrupted|ACP client disposed|ACP transport interrupted/i.test(text)
    ? "acp_bridge_interrupted"
    : "acp_tool_failed";
}

export async function persistFailedToolSessionHealth(input) {
  const code = failedToolUpdateCode(input.detail);
  if (code !== "acp_bridge_interrupted") return code;
  const now = Date.now();
  await writeSession(input.workspaceRoot, input.provider, input.agentId, {
    sessionId: input.sessionId,
    workdir: input.workdir,
    health: "unhealthy",
    lastFailureCode: code,
    lastFailure: input.detail,
    lastFailureAt: now,
    updatedAt: now,
  });
  return code;
}
