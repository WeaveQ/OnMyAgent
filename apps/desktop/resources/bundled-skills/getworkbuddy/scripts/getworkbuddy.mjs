#!/usr/bin/env node

const parsed = parseArguments(process.argv.slice(2));
const serverUrl = String(process.env.ONMYAGENT_SERVER_URL ?? "").trim().replace(/\/+$/, "");
const token = String(process.env.ONMYAGENT_SERVER_TOKEN ?? "").trim();

if (!serverUrl || !token) {
  fail("getworkbuddy must run inside an active OnMyAgent assistant or expert session.");
}

const response = await request(parsed);
if (parsed.json) {
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
} else {
  process.stdout.write(`${formatResponse(parsed.action, response)}\n`);
}

async function request(input) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const url = new URL(`${serverUrl}/third-party/workbuddy/packages`);
  let init = { headers };
  if (input.action === "list") {
    if (input.kind) url.searchParams.set("kind", input.kind);
  } else if (input.action === "inspect") {
    url.searchParams.set("query", input.query);
    if (input.kind) url.searchParams.set("kind", input.kind);
  } else {
    url.pathname = "/third-party/workbuddy/import";
    init = {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: input.query,
        kind: input.kind,
        mode: input.action === "confirm" ? "commit" : "preview",
        ...(input.confirmationToken ? { confirmationToken: input.confirmationToken } : {}),
      }),
    };
  }

  let result;
  try {
    result = await fetch(url, init);
  } catch (error) {
    fail(`Cannot reach the OnMyAgent local server: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await result.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text || `HTTP ${result.status}` };
  }
  if (!result.ok) {
    const message = body?.error?.message || body?.message || `HTTP ${result.status}`;
    const details = body?.error?.details || body?.details;
    fail(details ? `${message}\n${JSON.stringify(details, null, 2)}` : message);
  }
  return body;
}

function parseArguments(argv) {
  const tokens = [...argv];
  if (tokens[0] === "/getworkbuddy") tokens.shift();
  let action = tokens.shift() ?? "list";
  let kind;
  let confirmationToken = "";
  let json = false;

  if (["列表", "列出"].includes(action)) action = "list";
  if (["查看", "检查"].includes(action)) action = "inspect";
  if (["确认", "确认导入"].includes(action)) action = "confirm";
  if (action === "导入专家") {
    action = "import";
    kind = "agent";
  }
  if (action === "导入专家团" || action === "导入团队") {
    action = "import";
    kind = "team";
  }
  if (action === "导入" && tokens[0] === "专家") {
    tokens.shift();
    action = "import";
    kind = "agent";
  }
  if (action === "导入" && ["专家团", "团队"].includes(tokens[0])) {
    tokens.shift();
    action = "import";
    kind = "team";
  }
  if (!["list", "inspect", "import", "confirm"].includes(action)) {
    tokens.unshift(action);
    action = "inspect";
  }

  const queryParts = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const tokenValue = tokens[index];
    if (tokenValue === "--dry-run") {
      continue;
    }
    if (tokenValue === "--json") {
      json = true;
      continue;
    }
    if (tokenValue === "--type") {
      kind = tokens[index + 1];
      index += 1;
      continue;
    }
    if (tokenValue === "--token") {
      confirmationToken = tokens[index + 1] ?? "";
      index += 1;
      continue;
    }
    queryParts.push(tokenValue);
  }
  if (kind && !["agent", "team"].includes(kind)) fail("--type must be agent or team");
  const query = queryParts.join(" ").trim();
  if (action !== "list" && !query) fail(`${action} requires a package ID or localized name`);
  if (action === "confirm" && !confirmationToken) fail("confirm requires --token from the preview result");
  return { action, query, kind, confirmationToken, json };
}

function formatResponse(action, body) {
  if (action === "list") {
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) return "No local WorkBuddy expert packages were found.";
    const rows = items.map((item) =>
      `- ${item.packageName} — ${item.profession || item.displayName} (${item.expertType === "team" ? `team, ${item.members} members` : "expert"})`,
    );
    return [`Found ${items.length} local WorkBuddy packages:`, ...rows].join("\n");
  }
  const item = action === "inspect" ? body?.item : body?.package;
  if (!item) return JSON.stringify(body, null, 2);
  const lines = [
    `${action === "import" ? "Import preview" : action === "confirm" ? "Import result" : "WorkBuddy package"}: ${item.profession || item.displayName}`,
    `- Package: ${item.packageName}`,
    `- Type: ${item.expertType}`,
    `- Lead: ${item.leadAgentName}`,
    `- Members: ${item.members}`,
    `- Skills: ${(["import", "confirm"].includes(action) ? body.installedSkills : item.skills)?.join(", ") || "none"}`,
  ];
  if (action === "import" || action === "confirm") {
    lines.push(`- Action: ${body.action}`);
    lines.push(`- Destination: ${body.destination}`);
  }
  if (action === "import") {
    lines.push(`- Committable: ${body.committable === true ? "yes" : "no"}`);
    if (Array.isArray(body.conflicts) && body.conflicts.length > 0) {
      lines.push(`- Conflicts: ${body.conflicts.join(", ")}`);
    }
    if (body.committable === true && body.confirmationToken) {
      const typeFlag = item.expertType ? ` --type ${item.expertType}` : "";
      lines.push("- No files were written. Confirm with:");
      lines.push(`  node scripts/getworkbuddy.mjs confirm ${JSON.stringify(item.packageName)} --token ${body.confirmationToken}${typeFlag}`);
    }
  }
  if (action === "confirm" && body.refresh) {
    lines.push(`- Runtime skill links refreshed: ${body.refresh.skillLinksRefreshed === true ? "yes" : "no"}`);
    lines.push(`- Reload events: ${body.refresh.reloadEvents ?? 0}`);
  }
  for (const warning of body?.warnings ?? item.warnings ?? []) lines.push(`- Note: ${warning}`);
  return lines.join("\n");
}

function fail(message) {
  process.stderr.write(`getworkbuddy: ${message}\n`);
  process.exit(1);
}
