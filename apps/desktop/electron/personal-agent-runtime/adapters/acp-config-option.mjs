import { extractAcpSessionId } from "../acp-client.mjs";

function textValue(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function isAcpMethodUnsupported(error) {
  if (Number(error?.acpRpcCode) === -32601) return true;
  return /\bmethod(?:\s+[\w/.-]+)?\s+(?:not found|not supported|unsupported)\b/i.test(String(error?.message ?? error));
}

function isAcpSessionNotFound(error) {
  const message = String(error?.message ?? error);
  return /\bno conversation found with session id\b/i.test(message)
    || /(?:^|:\s*)session not found\b/i.test(message)
    || /\bsession(?:\s+id)?\s+(?:[0-9a-z][0-9a-z-]{7,}|"[^"]+"|'[^']+')\s+(?:was\s+)?not found\b/i.test(message)
    || /\bsession(?:\s+id)?\s+(?:does not exist|is missing)\b/i.test(message);
}

async function setOption(client, workdir, sessionId, optionId, value) {
  try {
    return await client.setConfigOption(sessionId, optionId, value, { cwd: workdir });
  } catch (error) {
    if (!isAcpMethodUnsupported(error)) throw error;
    // Older ACP backends such as CodeBuddy predate the standard method and
    // expose `config/set`. Keep this compatibility path bounded to UI config.
    try {
      return await client.setLegacyConfigOption(sessionId, optionId, value, { cwd: workdir });
    } catch (legacyError) {
      if (!isAcpMethodUnsupported(legacyError) || optionId !== "model") throw legacyError;
      // Oldest model-capable agents may expose only `session/set_model`.
      // That method cannot represent "use provider default". Fail instead of
      // sending the literal string "null" and reporting a false reset.
      if (value === null) {
        throw new Error("This ACP backend does not support resetting the model to its default");
      }
      return client.setModel(sessionId, String(value), { cwd: workdir });
    }
  }
}

async function createConfigSession(client, workdir) {
  // ACP session/new requires mcpServers even when no servers are configured.
  const created = await client.createSession({ cwd: workdir, mcpServers: [] });
  return extractAcpSessionId(created);
}

export async function setAcpConfigOptionWithSessionRecovery(input) {
  const { client, workdir, optionId, value } = input;
  let sessionId = textValue(input.sessionId);
  const suppliedSessionId = sessionId;
  if (!sessionId) sessionId = await createConfigSession(client, workdir);
  if (!sessionId) throw new Error("session/set_config_option requires an ACP sessionId");

  let result;
  try {
    result = await setOption(client, workdir, sessionId, optionId, value);
  } catch (error) {
    // Some ACP bridges keep sessions only for their process lifetime. A config
    // call owns a short-lived process, so a prior session can be stale. Recover
    // only from an explicit session-not-found error and retry exactly once.
    if (!suppliedSessionId || !isAcpSessionNotFound(error)) throw error;
    sessionId = await createConfigSession(client, workdir);
    if (!sessionId) throw new Error("session/new returned no sessionId while recovering ACP config");
    result = await setOption(client, workdir, sessionId, optionId, value);
  }

  const configOptions = Array.isArray(result?.configOptions)
    ? result.configOptions
    : Array.isArray(result?.config_options)
      ? result.config_options
      : [];
  return {
    ok: true,
    sessionId,
    optionId,
    value,
    confirmation: textValue(result?.confirmation ?? result?.message) || null,
    configOptions,
    raw: result,
  };
}
