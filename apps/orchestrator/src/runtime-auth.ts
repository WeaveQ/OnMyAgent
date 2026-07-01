import { randomBytes } from "node:crypto";

import { readBool, type ParsedArgs } from "./cli-args.js";

const MANAGED_OPENCODE_CREDENTIAL_LENGTH = 512;
const INTERNAL_OPENCODE_CREDENTIALS_ENV =
  "ONMYAGENT_INTERNAL_ALLOW_OPENCODE_CREDENTIALS";

export function encodeBasicAuth(username: string, password: string): string {
  return Buffer.from(`${username}:${password}`, "utf8").toString("base64");
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1"
  );
}

function randomCredential(length: number): string {
  return randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
}

function generateManagedOpencodeCredentials(): {
  username: string;
  password: string;
} {
  return {
    username: randomCredential(MANAGED_OPENCODE_CREDENTIAL_LENGTH),
    password: randomCredential(MANAGED_OPENCODE_CREDENTIAL_LENGTH),
  };
}

export function resolveManagedOpencodeCredentials(args: ParsedArgs): {
  username: string;
  password: string;
} {
  const explicitUsernameFlag = args.flags.get("opencode-username");
  const explicitPasswordFlag = args.flags.get("opencode-password");
  const requestedUsername =
    typeof explicitUsernameFlag === "string"
      ? explicitUsernameFlag
      : process.env.ONMYAGENT_OPENCODE_USERNAME ??
        process.env.OPENCODE_SERVER_USERNAME;
  const requestedPassword =
    typeof explicitPasswordFlag === "string"
      ? explicitPasswordFlag
      : process.env.ONMYAGENT_OPENCODE_PASSWORD ??
        process.env.OPENCODE_SERVER_PASSWORD;
  const allowInjectedCredentials =
    (process.env[INTERNAL_OPENCODE_CREDENTIALS_ENV] ?? "").trim() === "1";
  const hasExplicitCredentialFlags =
    typeof explicitUsernameFlag === "string" ||
    typeof explicitPasswordFlag === "string";

  if (
    hasExplicitCredentialFlags &&
    ((requestedUsername && !requestedPassword) ||
      (!requestedUsername && requestedPassword))
  ) {
    throw new Error(
      "OpenCode credentials must include both username and password.",
    );
  }

  if (requestedUsername && requestedPassword && hasExplicitCredentialFlags) {
    if (!allowInjectedCredentials) {
      throw new Error(
        "OpenCode credentials are managed by OnMyAgent. Custom --opencode-username/--opencode-password values are not supported.",
      );
    }
    return {
      username: requestedUsername,
      password: requestedPassword,
    };
  }

  if (requestedUsername && requestedPassword && allowInjectedCredentials) {
    return {
      username: requestedUsername,
      password: requestedPassword,
    };
  }

  return generateManagedOpencodeCredentials();
}

export function assertManagedOpencodeAuth(args: ParsedArgs) {
  const authEnabled = readBool(
    args.flags,
    "opencode-auth",
    true,
    "ONMYAGENT_OPENCODE_AUTH",
  );
  if (!authEnabled) {
    throw new Error(
      "OpenCode basic auth is always enabled when OnMyAgent launches OpenCode.",
    );
  }
}

export function resolveManagedOpencodeHost(requestedHost?: string): string {
  const host = requestedHost?.trim() || "127.0.0.1";
  if (!isLoopbackHost(host)) {
    throw new Error(
      "OpenCode is always bound to a loopback interface when launched by OnMyAgent. Use --remote-access for onmyagent-server instead.",
    );
  }
  return host;
}
