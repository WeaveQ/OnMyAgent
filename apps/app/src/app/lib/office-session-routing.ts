/**
 * Office session create/prompt routing. OpenCode stays on the SDK async
 * shape. The Pi text shim is only used when the workspace engine is `"pi"`.
 */

export type OfficeAgentEngine = "opencode" | "pi";

export function shouldUsePiSessionWriteShim(engine: unknown): boolean {
  return engine === "pi";
}

export function buildOfficeCreateSessionInput(parameters?: {
  directory?: string;
  title?: string;
  agent?: string;
  agentId?: string;
  model?: { providerID: string; modelID: string };
}): {
  directory?: string;
  title?: string;
  agentId?: string;
  model?: { providerID: string; modelID: string };
} {
  const directory = parameters?.directory?.trim() ?? "";
  const title = parameters?.title?.trim() ?? "";
  const agentId = (parameters?.agentId ?? parameters?.agent)?.trim() ?? "";
  const model = parameters?.model;
  return {
    ...(directory ? { directory } : {}),
    ...(title ? { title } : {}),
    ...(agentId ? { agentId } : {}),
    ...(model?.providerID && model?.modelID ? { model } : {}),
  };
}

export type OfficePromptDispatch =
  | { kind: "sdk-prompt-async" }
  | { kind: "pi-text"; text: string };

export function resolveOfficePromptDispatch(
  engine: unknown,
  parameters: { parts?: unknown[] },
): OfficePromptDispatch {
  if (!shouldUsePiSessionWriteShim(engine)) {
    return { kind: "sdk-prompt-async" };
  }
  const parts = parameters.parts;
  const text = Array.isArray(parts)
    ? parts
        .map((part) => {
          if (!part || typeof part !== "object") return "";
          const record = part as { type?: unknown; text?: unknown };
          return record.type === "text" && typeof record.text === "string"
            ? record.text
            : "";
        })
        .filter(Boolean)
        .join("\n")
    : "";
  return { kind: "pi-text", text };
}
