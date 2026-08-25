import { ApiError } from "../core/errors.js";
import type {
  AgentRuntimeConnectorId,
  AgentRuntimeConnectorToolsResponse,
  AgentRuntimeKind,
} from "@onmyagent/types/agent-runtime";

export type ConnectorMcpDescriptor =
  | {
      name: string;
      transport: "http" | "sse";
      url: string;
      headers?: Readonly<Record<string, string>>;
    }
  | {
      name: string;
      transport: "stdio";
      command: string;
      args?: readonly string[];
      env?: Readonly<Record<string, string>>;
    };

export type ConnectorAccountProjectionStatus = {
  connectorId: AgentRuntimeConnectorId;
  accountConnected: boolean;
  opencodeAvailable: boolean;
};

export type ConnectorMcpProjectionSnapshot = {
  descriptors: readonly ConnectorMcpDescriptor[];
  accounts: readonly ConnectorAccountProjectionStatus[];
  complete: boolean;
};

export type GrokAcpMcpServer =
  | {
      type: "http" | "sse";
      name: string;
      url: string;
      headers: Array<{ name: string; value: string }>;
    }
  | {
      name: string;
      command: string;
      args: string[];
      env: Array<{ name: string; value: string }>;
    };

const MAX_SERVERS = 32;
const MAX_NAME_LENGTH = 128;
const MAX_URL_LENGTH = 4_096;
const MAX_COMMAND_LENGTH = 1_024;
const MAX_ARGS = 64;
const MAX_PAIRS = 64;
const MAX_VALUE_LENGTH = 16_384;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_PAIR_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function invalidProjection(): never {
  throw new ApiError(
    409,
    "agent_runtime_mcp_projection_invalid",
    "A connected MCP integration cannot be projected to this runtime",
  );
}

function boundedString(value: unknown, max: number): string {
  if (typeof value !== "string") return invalidProjection();
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\r\n\0]/u.test(normalized)) {
    return invalidProjection();
  }
  return normalized;
}

function pairs(
  value: Readonly<Record<string, string>> | undefined,
): Array<{ name: string; value: string }> {
  const entries = Object.entries(value ?? {});
  if (entries.length > MAX_PAIRS) return invalidProjection();
  return entries.map(([rawName, rawValue]) => {
    const name = boundedString(rawName, MAX_NAME_LENGTH);
    if (!SAFE_PAIR_NAME.test(name)) return invalidProjection();
    return { name, value: boundedString(rawValue, MAX_VALUE_LENGTH) };
  });
}

/**
 * Compile trusted Electron connector snapshots into the ACP wire contract.
 * The result is intentionally ephemeral: credentials never enter selection,
 * session-binding, archive, renderer, HTTP, or diagnostic state.
 */
export function compileGrokMcpServers(
  descriptors: readonly ConnectorMcpDescriptor[],
): GrokAcpMcpServer[] {
  if (!Array.isArray(descriptors) || descriptors.length > MAX_SERVERS) {
    return invalidProjection();
  }
  const names = new Set<string>();
  return descriptors.map((descriptor) => {
    const name = boundedString(descriptor?.name, MAX_NAME_LENGTH);
    if (!SAFE_NAME.test(name) || names.has(name)) return invalidProjection();
    names.add(name);
    if (descriptor.transport === "http" || descriptor.transport === "sse") {
      const url = boundedString(descriptor.url, MAX_URL_LENGTH);
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return invalidProjection();
      }
      if (parsed.protocol !== "https:") return invalidProjection();
      return {
        type: descriptor.transport,
        name,
        url: parsed.toString(),
        headers: pairs(descriptor.headers),
      };
    }
    if (descriptor.transport !== "stdio") return invalidProjection();
    const args = descriptor.args ?? [];
    if (!Array.isArray(args) || args.length > MAX_ARGS) return invalidProjection();
    return {
      name,
      command: boundedString(descriptor.command, MAX_COMMAND_LENGTH),
      args: args.map((argument) => boundedString(argument, MAX_VALUE_LENGTH)),
      env: pairs(descriptor.env),
    };
  });
}

const CONNECTOR_IDS: readonly AgentRuntimeConnectorId[] = [
  "tencent-docs",
  "baidu-drive",
  "kdocs",
  "dingtalk",
  "tencent-meeting",
];

function connectorForDescriptor(name: string): AgentRuntimeConnectorId | null {
  if (name === "tencent-docs" || name.startsWith("tencent-docs-")) return "tencent-docs";
  if (name === "baidu-netdisk") return "baidu-drive";
  if (name === "kdocs") return "kdocs";
  if (name === "dingtalk") return "dingtalk";
  if (name === "tencent-meeting") return "tencent-meeting";
  return null;
}

export function buildRuntimeConnectorToolsResponse(input: {
  runtimeKind: AgentRuntimeKind;
  workspaceId: string;
  descriptors: readonly ConnectorMcpDescriptor[];
  accounts: readonly ConnectorAccountProjectionStatus[];
  complete?: boolean;
}): AgentRuntimeConnectorToolsResponse {
  if (input.runtimeKind === "grok-build") compileGrokMcpServers(input.descriptors);
  const projected = new Set(input.descriptors.flatMap((descriptor) => {
    const connectorId = connectorForDescriptor(descriptor.name);
    return connectorId ? [connectorId] : [];
  }));
  const accounts = new Map(input.accounts.map((item) => [item.connectorId, item]));
  return {
    runtimeKind: input.runtimeKind,
    workspaceId: input.workspaceId,
    complete: input.complete ?? true,
    items: CONNECTOR_IDS.map((connectorId) => {
      const account = accounts.get(connectorId);
      const accountConnected = account?.accountConnected === true;
      const toolAvailable = input.runtimeKind === "grok-build"
        ? accountConnected && projected.has(connectorId)
        : accountConnected && account?.opencodeAvailable === true;
      return {
        connectorId,
        accountConnected,
        toolAvailable,
        reason: toolAvailable
          ? "available"
          : accountConnected
            ? "runtime_projection_unavailable"
            : "account_not_connected",
      };
    }),
  };
}
