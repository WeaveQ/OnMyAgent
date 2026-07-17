import {
  mkdir,
  readFile,
  rename,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import {
  type ParsedArgs,
  parseList,
  readBool,
  readFlag,
  readNumber,
} from "../cli-args.js";

import {
  fetchJson,
  outputError,
  outputResult,
  readOnMyAgentClientAuth,
  readSessionId,
} from "../cli-shared.js";

export async function runFiles(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const subcommand = args.positionals[1] ?? "";
  const { onmyagentUrl, token } = readOnMyAgentClientAuth(args);
  const baseUrl = onmyagentUrl.replace(/\/$/, "");
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  try {
    if (subcommand === "session") {
      const action = args.positionals[2] ?? "create";
      if (action === "create") {
        const workspaceId =
          readFlag(args.flags, "workspace-id") ?? args.positionals[3] ?? "";
        if (!workspaceId.trim()) {
          throw new Error("workspace-id is required for files session create");
        }
        const ttlSeconds = readNumber(args.flags, "ttl-seconds", undefined);
        const writeRequested = readBool(args.flags, "write", true);
        const result = await fetchJson(
          `${baseUrl}/workspace/${encodeURIComponent(workspaceId.trim())}/files/sessions`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              ...(typeof ttlSeconds === "number" ? { ttlSeconds } : {}),
              write: writeRequested,
            }),
          },
        );
        outputResult(result, outputJson);
        return;
      }
      if (action === "renew") {
        const sessionId = readSessionId(args, 3);
        const ttlSeconds = readNumber(args.flags, "ttl-seconds", undefined);
        const result = await fetchJson(
          `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}/renew`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              ...(typeof ttlSeconds === "number" ? { ttlSeconds } : {}),
            }),
          },
        );
        outputResult(result, outputJson);
        return;
      }
      if (action === "close" || action === "delete") {
        const sessionId = readSessionId(args, 3);
        const result = await fetchJson(
          `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}`,
          {
            method: "DELETE",
            headers,
          },
        );
        outputResult(result, outputJson);
        return;
      }
      throw new Error("files session requires create|renew|close");
    }

    if (subcommand === "catalog") {
      const sessionId = readSessionId(args, 2);
      const params = new URLSearchParams();
      const prefix = readFlag(args.flags, "prefix");
      const after = readFlag(args.flags, "after");
      const limit = readNumber(args.flags, "limit", undefined);
      const includeDirs = readBool(args.flags, "include-dirs", true);
      if (prefix?.trim()) params.set("prefix", prefix.trim());
      if (after?.trim()) params.set("after", after.trim());
      if (typeof limit === "number") params.set("limit", String(limit));
      if (!includeDirs) params.set("includeDirs", "false");
      const query = params.toString();
      const result = await fetchJson(
        `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}/catalog/snapshot${query ? `?${query}` : ""}`,
        {
          headers,
        },
      );
      outputResult(result, outputJson);
      return;
    }

    if (subcommand === "events") {
      const sessionId = readSessionId(args, 2);
      const since = readNumber(args.flags, "since", undefined);
      const query =
        typeof since === "number"
          ? `?since=${encodeURIComponent(String(since))}`
          : "";
      const result = await fetchJson(
        `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}/catalog/events${query}`,
        {
          headers,
        },
      );
      outputResult(result, outputJson);
      return;
    }

    if (subcommand === "read") {
      const sessionId = readSessionId(args, 2);
      const pathsRaw = readFlag(args.flags, "paths");
      const singlePath = readFlag(args.flags, "path") ?? args.positionals[3];
      const paths = pathsRaw
        ? parseList(pathsRaw)
        : singlePath
          ? [singlePath]
          : [];
      if (!paths.length) {
        throw new Error("path or paths is required for files read");
      }
      const result = await fetchJson(
        `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}/read-batch`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ paths }),
        },
      );
      outputResult(result, outputJson);
      return;
    }

    if (subcommand === "write") {
      const sessionId = readSessionId(args, 2);
      const path = readFlag(args.flags, "path") ?? args.positionals[3] ?? "";
      if (!path.trim()) {
        throw new Error("path is required for files write");
      }

      let contentBase64 = readFlag(args.flags, "content-base64") ?? "";
      if (!contentBase64) {
        const inlineContent = readFlag(args.flags, "content");
        if (inlineContent !== undefined) {
          contentBase64 = Buffer.from(inlineContent, "utf8").toString("base64");
        }
      }
      if (!contentBase64) {
        const filePath = readFlag(args.flags, "file");
        if (filePath?.trim()) {
          const fileBytes = await readFile(resolve(filePath.trim()));
          contentBase64 = Buffer.from(fileBytes).toString("base64");
        }
      }
      if (!contentBase64) {
        throw new Error(
          "provide one of --content, --content-base64, or --file",
        );
      }

      const ifMatchRevision = readFlag(args.flags, "if-match");
      const force = readBool(args.flags, "force", false);
      const result = await fetchJson(
        `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}/write-batch`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            writes: [
              {
                path: path.trim(),
                contentBase64,
                ...(ifMatchRevision?.trim()
                  ? { ifMatchRevision: ifMatchRevision.trim() }
                  : {}),
                ...(force ? { force: true } : {}),
              },
            ],
          }),
        },
      );
      outputResult(result, outputJson);
      return;
    }

    if (subcommand === "mkdir") {
      const sessionId = readSessionId(args, 2);
      const path = readFlag(args.flags, "path") ?? args.positionals[3] ?? "";
      if (!path.trim()) throw new Error("path is required for files mkdir");
      const result = await fetchJson(
        `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}/ops`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            operations: [{ type: "mkdir", path: path.trim() }],
          }),
        },
      );
      outputResult(result, outputJson);
      return;
    }

    if (subcommand === "delete") {
      const sessionId = readSessionId(args, 2);
      const path = readFlag(args.flags, "path") ?? args.positionals[3] ?? "";
      if (!path.trim()) throw new Error("path is required for files delete");
      const recursive = readBool(args.flags, "recursive", false);
      const result = await fetchJson(
        `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}/ops`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            operations: [
              {
                type: "delete",
                path: path.trim(),
                ...(recursive ? { recursive: true } : {}),
              },
            ],
          }),
        },
      );
      outputResult(result, outputJson);
      return;
    }

    if (subcommand === "rename") {
      const sessionId = readSessionId(args, 2);
      const from = readFlag(args.flags, "from") ?? args.positionals[3] ?? "";
      const to = readFlag(args.flags, "to") ?? args.positionals[4] ?? "";
      if (!from.trim() || !to.trim()) {
        throw new Error("from and to are required for files rename");
      }
      const result = await fetchJson(
        `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}/ops`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            operations: [{ type: "rename", from: from.trim(), to: to.trim() }],
          }),
        },
      );
      outputResult(result, outputJson);
      return;
    }

    throw new Error(
      "files requires session|catalog|events|read|write|mkdir|delete|rename",
    );
  } catch (error) {
    outputError(error, outputJson);
    process.exitCode = 1;
  }
}
