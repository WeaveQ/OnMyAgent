import { GrokExtensionClient } from "./grok-extension-client.js";
import type { GrokExtensionTransport } from "./grok-extension-client.js";

export type GrokNativeMcpInventory = {
  source: "runtime-native";
  items: Array<{ name: string; status: "connected" | "unknown" }>;
  complete: boolean;
  toolInjectionVerified: false;
};

export async function listGrokNativeMcpInventory(
  transport: GrokExtensionTransport,
): Promise<GrokNativeMcpInventory> {
  const listed = await new GrokExtensionClient(transport).call(
    "mcp.inventory",
    {},
    decodeInventory,
  );
  if (!listed.ok) {
    return {
      source: "runtime-native",
      items: [],
      complete: false,
      toolInjectionVerified: false,
    };
  }
  return listed.value;
}

function decodeInventory(value: unknown): GrokNativeMcpInventory {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { servers?: unknown }).servers)
      ? (value as { servers: unknown[] }).servers
      : value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
        ? (value as { items: unknown[] }).items
        : [];
  return {
    source: "runtime-native",
    items: list.slice(0, 64).flatMap((entry) => {
      const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      const name = typeof item.name === "string" ? item.name.trim() : "";
      return name ? [{ name, status: "unknown" as const }] : [];
    }),
    complete: true,
    toolInjectionVerified: false,
  };
}
