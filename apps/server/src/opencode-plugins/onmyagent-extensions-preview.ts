import { z } from "zod";

type OpenCodeContext = {
  agent?: string;
  sessionID?: string;
  messageID?: string;
  directory?: string;
  worktree?: string;
};

type ExtensionActionPayload = {
  extensionId: string;
  action: string;
  args: Record<string, unknown>;
  context: ReturnType<typeof contextPayload>;
};

const listActionsArgsSchema = z.object({
  extensionId: z.string().optional().describe("Optional extension id to filter by."),
});

const callArgsSchema = z.object({
  extensionId: z.string().describe("Extension id from onmyagent_extension_list_actions."),
  action: z.string().describe("Action id from onmyagent_extension_list_actions."),
  args: z.record(z.string(), z.unknown()).optional().describe("JSON arguments for the action."),
});

function serverUrl(): string {
  return String(process.env.ONMYAGENT_SERVER_URL || "").replace(/\/$/, "");
}

function serverToken(): string {
  return String(process.env.ONMYAGENT_SERVER_TOKEN || "");
}

function requireOnMyAgentServer(): { url: string; token: string } {
  const url = serverUrl();
  const token = serverToken();
  if (!url || !token) {
    throw new Error("OnMyAgent extension tools are only available when OpenCode is launched by OnMyAgent.");
  }
  return { url, token };
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return { message: text };
  }
}

function getStringProperty(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const property = Reflect.get(value, key);
  return typeof property === "string" ? property : null;
}

function addContext(payload: unknown, context: OpenCodeContext): object {
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    return Object.assign({}, payload, { context: contextPayload(context) });
  }
  return { payload, context: contextPayload(context) };
}

function errorMessage(payload: unknown, fallback: string): string {
  return getStringProperty(payload, "message") ?? getStringProperty(payload, "code") ?? fallback;
}

async function postJson(path: string, body: ExtensionActionPayload): Promise<unknown> {
  const { url, token } = requireOnMyAgentServer();
  const response = await fetch(url + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await parseResponse(response);
  if (!response.ok) {
    throw new Error(errorMessage(payload, "OnMyAgent extension call failed"));
  }
  return payload;
}

function contextPayload(context: OpenCodeContext) {
  return {
    agent: context.agent,
    sessionId: context.sessionID,
    messageId: context.messageID,
    directory: context.directory,
    worktree: context.worktree,
  };
}

export const OnMyAgentExtensionsPreview = async () => ({
  tool: {
    onmyagent_extension_list_actions: {
      description: "List extension actions currently exposed by OnMyAgent.",
      args: listActionsArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = listActionsArgsSchema.parse(rawArgs);
        const query = args.extensionId ? `?extensionId=${encodeURIComponent(args.extensionId)}` : "";
        const { url, token } = requireOnMyAgentServer();
        const response = await fetch(`${url}/experimental/extensions/actions${query}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await parseResponse(response);
        if (!response.ok) throw new Error(errorMessage(payload, "OnMyAgent extension action listing failed"));
        return JSON.stringify(addContext(payload, context), null, 2);
      },
    },
    onmyagent_extension_call: {
      description: "Call an OnMyAgent extension action. Use onmyagent_extension_list_actions first to inspect available actions and schemas.",
      args: callArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = callArgsSchema.parse(rawArgs);
        const payload = await postJson("/experimental/extensions/call", {
          extensionId: args.extensionId,
          action: args.action,
          args: args.args ?? {},
          context: contextPayload(context),
        });
        return JSON.stringify(payload, null, 2);
      },
    },
  },
});
