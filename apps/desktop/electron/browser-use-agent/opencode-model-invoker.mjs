import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

/** @returns {import("@opencode-ai/sdk/v2").TextPartInput} */
function textPart(text) {
  return { type: "text", text };
}

/** @returns {import("@opencode-ai/sdk/v2").FilePartInput} */
function filePart(mime, url) {
  return { type: "file", mime, url };
}

function unwrap(result, operation) {
  if (result?.data != null) return result.data;
  const detail = result?.error ? JSON.stringify(result.error) : "empty response";
  throw new Error(`${operation} failed: ${detail}`);
}

function messageParts(messages) {
  const parts = [];
  const text = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    const content = Array.isArray(message.content) ? message.content : [{ type: "text", text: message.content }];
    for (const item of content) {
      if (item?.type === "image_url" && typeof item.image_url?.url === "string") {
        const match = /^data:([^;,]+)[;,]/.exec(item.image_url.url);
        parts.push(filePart(match?.[1] ?? "image/png", item.image_url.url));
      } else {
        const value = typeof item === "string" ? item : String(item?.text ?? "");
        if (value) text.push(`[${message.role}] ${value}`);
      }
    }
  }
  if (text.length) parts.unshift(textPart(text.join("\n\n")));
  return parts.length ? parts : [textPart("Continue the browser task.")];
}

function systemText(messages) {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content))
    .join("\n\n");
}

function responseText(response) {
  return response.parts
    ?.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n") ?? "";
}

function parseStructuredText(value) {
  const trimmed = value.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed)?.[1]?.trim();
  const candidate = fenced || trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const objectStart = candidate.indexOf("{");
    const objectEnd = candidate.lastIndexOf("}");
    const arrayStart = candidate.indexOf("[");
    const arrayEnd = candidate.lastIndexOf("]");
    const startsWithArray = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart);
    const fragment = startsWithArray
      ? candidate.slice(arrayStart, arrayEnd + 1)
      : candidate.slice(objectStart, objectEnd + 1);
    if (!fragment) throw new Error("OpenCode model returned no structured output");
    try {
      return JSON.parse(fragment);
    } catch {
      throw new Error("OpenCode model returned invalid structured output");
    }
  }
}

function structuredFallbackInstruction(schema) {
  return [
    "Return exactly one JSON value matching this JSON Schema.",
    "Do not use Markdown fences or add explanatory text.",
    JSON.stringify(schema),
  ].join("\n");
}

/**
 * @param {{
 *   createClient?: typeof createOpencodeClient,
 *   connectionInfo: (ownerId: string) => Promise<{baseUrl: string, directory?: string, authorization?: string}>
 * }} options
 */
export function createBrowserUseOpenCodeModelInvoker(options) {
  const createClient = options.createClient ?? createOpencodeClient;
  const connectionInfo = options.connectionInfo;
  if (typeof connectionInfo !== "function") throw new Error("connectionInfo is required");
  return async function invokeBrowserUseModel(input) {
    const connection = await connectionInfo(input.ownerId);
    if (!connection?.baseUrl) throw new Error("OpenCode model connection is unavailable");
    if (!input.model?.providerID || !input.model?.modelID) {
      throw new Error("Browser Use Agent requires a selected model");
    }
    const client = createClient({
      baseUrl: connection.baseUrl,
      ...(connection.directory ? { directory: connection.directory } : {}),
      ...(connection.authorization
        ? { headers: { authorization: connection.authorization } }
        : {}),
    });
    const created = unwrap(await client.session.create({
      directory: connection.directory,
      title: "OnMyAgent Browser Use model call",
    }), "OpenCode session.create");
    const sessionID = created.id;
    const abort = () => { void client.session.abort({ sessionID }); };
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      let response = unwrap(await client.session.prompt({
        sessionID,
        directory: connection.directory,
        model: input.model,
        tools: {},
        format: input.outputSchema
          ? { type: "json_schema", schema: input.outputSchema }
          : { type: "text" },
        system: systemText(input.messages),
        parts: messageParts(input.messages),
      }), "OpenCode session.prompt");
      let value;
      if (!input.outputSchema) {
        value = responseText(response);
      } else if (response.info?.structured !== undefined) {
        value = response.info.structured;
      } else {
        try {
          value = parseStructuredText(responseText(response));
        } catch {
          response = unwrap(await client.session.prompt({
            sessionID,
            directory: connection.directory,
            model: input.model,
            tools: {},
            format: { type: "text" },
            system: systemText(input.messages),
            parts: [textPart(structuredFallbackInstruction(input.outputSchema))],
          }), "OpenCode session.prompt text fallback");
          value = parseStructuredText(responseText(response));
        }
      }
      return {
        value,
        usage: {
          inputTokens: Number(response.info?.tokens?.input ?? 0),
          outputTokens: Number(response.info?.tokens?.output ?? 0),
        },
      };
    } finally {
      input.signal?.removeEventListener("abort", abort);
      await client.session.delete({ sessionID, directory: connection.directory }).catch(() => undefined);
    }
  };
}
