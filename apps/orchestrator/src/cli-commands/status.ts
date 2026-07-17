import {
  createOpencodeClient,
} from "@opencode-ai/sdk/v2/client";

import {
  encodeBasicAuth,
} from "../runtime-auth.js";

import {
  waitForHealthy,
  waitForOpencodeHealthy,
} from "../runtime-health.js";

import {
  type ParsedArgs,
  readBool,
  readFlag,
} from "../cli-args.js";

export async function runStatus(args: ParsedArgs) {
  const onmyagentUrl =
    readFlag(args.flags, "onmyagent-url") ?? process.env.ONMYAGENT_URL ?? "";
  const opencodeUrl =
    readFlag(args.flags, "opencode-url") ?? process.env.OPENCODE_URL ?? "";
  const username =
    readFlag(args.flags, "opencode-username") ??
    process.env.OPENCODE_SERVER_USERNAME;
  const password =
    readFlag(args.flags, "opencode-password") ??
    process.env.OPENCODE_SERVER_PASSWORD;
  const outputJson = readBool(args.flags, "json", false);

  const status: Record<string, unknown> = {};

  if (onmyagentUrl) {
    try {
      await waitForHealthy(onmyagentUrl, 5000, 400);
      status.onmyagent = { ok: true, url: onmyagentUrl };
    } catch (error) {
      status.onmyagent = { ok: false, url: onmyagentUrl, error: String(error) };
    }
  }

  if (opencodeUrl) {
    try {
      const headers: Record<string, string> = {};
      if (username && password) {
        headers.Authorization = `Basic ${encodeBasicAuth(username, password)}`;
      }
      const client = createOpencodeClient({
        baseUrl: opencodeUrl,
        headers,
      });
      const health = await waitForOpencodeHealthy(client, 5000, 400);
      status.opencode = { ok: true, url: opencodeUrl, health };
    } catch (error) {
      status.opencode = { ok: false, url: opencodeUrl, error: String(error) };
    }
  }

  if (outputJson) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    if (status.onmyagent) {
      const onmyagent = status.onmyagent as {
        ok: boolean;
        url: string;
        error?: string;
      };
      console.log(
        `OnMyAgent server: ${onmyagent.ok ? "ok" : "error"} (${onmyagent.url})`,
      );
      if (onmyagent.error) console.log(`  ${onmyagent.error}`);
    }
    if (status.opencode) {
      const opencode = status.opencode as {
        ok: boolean;
        url: string;
        error?: string;
      };
      console.log(
        `OpenCode server: ${opencode.ok ? "ok" : "error"} (${opencode.url})`,
      );
      if (opencode.error) console.log(`  ${opencode.error}`);
    }
  }
}
