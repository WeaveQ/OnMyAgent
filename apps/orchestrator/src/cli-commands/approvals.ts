import {
  type ParsedArgs,
  readBool,
  readFlag,
} from "../cli-args.js";

export async function runApprovals(args: ParsedArgs) {
  const subcommand = args.positionals[1];
  if (!subcommand || (subcommand !== "list" && subcommand !== "reply")) {
    throw new Error("approvals requires 'list' or 'reply'");
  }

  const onmyagentUrl =
    readFlag(args.flags, "onmyagent-url") ??
    process.env.ONMYAGENT_URL ??
    process.env.ONMYAGENT_SERVER_URL ??
    "";
  const hostToken =
    readFlag(args.flags, "host-token") ?? process.env.ONMYAGENT_HOST_TOKEN ?? "";

  if (!onmyagentUrl || !hostToken) {
    throw new Error("onmyagent-url and host-token are required for approvals");
  }

  const headers = {
    "Content-Type": "application/json",
    "X-OnMyAgent-Host-Token": hostToken,
  };

  if (subcommand === "list") {
    const response = await fetch(
      `${onmyagentUrl.replace(/\/$/, "")}/approvals`,
      { headers },
    );
    if (!response.ok) {
      throw new Error(`Failed to list approvals: ${response.status}`);
    }
    const body = await response.json();
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  const approvalId = args.positionals[2];
  if (!approvalId) {
    throw new Error("approval id is required for approvals reply");
  }

  const allow = readBool(args.flags, "allow", false);
  const deny = readBool(args.flags, "deny", false);
  if (allow === deny) {
    throw new Error("use --allow or --deny");
  }

  const payload = { reply: allow ? "allow" : "deny" };
  const response = await fetch(
    `${onmyagentUrl.replace(/\/$/, "")}/approvals/${approvalId}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to reply to approval: ${response.status}`);
  }
  const body = await response.json();
  console.log(JSON.stringify(body, null, 2));
}
