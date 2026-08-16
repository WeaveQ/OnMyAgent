import type { ModelRef, SuggestedPlugin } from "./types";
import { t } from "../i18n";
import { readDenBootstrapConfig } from "./lib/den";
import {
  getBuiltInOnMyAgentExtensionManifests,
  extensionContribution,
  extensionResource,
  isTrustedBuiltInExtension,
  type OnMyAgentExtensionManifest,
} from "./extensions";

export const MODEL_PREF_KEY = "onmyagent.defaultModel";
export const SESSION_MODEL_PREF_KEY = "onmyagent.sessionModels";
export const THINKING_PREF_KEY = "onmyagent.showThinking";
export const VARIANT_PREF_KEY = "onmyagent.modelVariant";
export const LANGUAGE_PREF_KEY = "onmyagent.language";
export const HIDE_TITLEBAR_PREF_KEY = "onmyagent.hideTitlebar";

export const DEFAULT_MODEL: ModelRef = {
  providerID: "opencode",
  modelID: "big-pickle",
};

export const SUGGESTED_PLUGINS: SuggestedPlugin[] = [];

export type ExtensionKind = "mcp" | "plugin" | "skill" | "ui-control" | "extension";

export type McpDirectoryInfo = {
  id?: string;
  /** Display name shown in the UI. */
  name: string;
  /** Safe server name for opencode.jsonc (alphanumeric, - and _ only). Auto-derived from name if omitted. */
  serverName?: string;
  description: string;
  url?: string;
  type?: "remote" | "local";
  command?: string[];
  oauth: boolean;
  /** Extension category for UI grouping. Defaults to "mcp". */
  kind?: ExtensionKind;
  /** Simple Icons slug for brand icon (e.g. "notion", "stripe", "figma"). */
  iconSlug?: string;
  /** Direct icon URL (e.g. local SVG). Takes priority over iconSlug. */
  iconSrc?: string;
  /** Prompt inserted from the composer extension picker. */
  composerPrompt?: string;
  /** Ready-to-run prompts shown in the composer extension picker. */
  suggestedPrompts?: string[];
  /** Whether OnMyAgent should show this extension as enabled before user setup. */
  defaultEnabled?: boolean;
  /** Whether OnMyAgent should hide this extension from the default catalog view. */
  defaultHidden?: boolean;
  /** Whether this extension is still in preview. */
  preview?: boolean;
  /** Normalized extension manifest backing this catalog entry. */
  extensionManifest?: OnMyAgentExtensionManifest;
};

function loadBuiltInManifest(id: string): OnMyAgentExtensionManifest {
  const manifest = getBuiltInOnMyAgentExtensionManifests().find((item) => item.id === id);
  if (!manifest) {
    throw new Error(`Unknown built-in extension: ${id}`);
  }
  return manifest;
}

/**
 * Map a built-in extension id to directory info with live `t()` getters so
 * name/description follow the active locale (not frozen at module load).
 */
function extensionManifestToDirectoryInfo(id: string): McpDirectoryInfo {
  return {
    id,
    get name() {
      return loadBuiltInManifest(id).name;
    },
    get serverName() {
      const mcpResource = extensionResource(loadBuiltInManifest(id), "mcp");
      return mcpResource?.mcpServerName ?? id;
    },
    get description() {
      return loadBuiltInManifest(id).description;
    },
    get type() {
      const mcpResource = extensionResource(loadBuiltInManifest(id), "mcp");
      return mcpResource?.command ? "local" : undefined;
    },
    get command() {
      return extensionResource(loadBuiltInManifest(id), "mcp")?.command;
    },
    oauth: false,
    kind: "extension",
    get iconSlug() {
      return loadBuiltInManifest(id).icon?.simpleIconSlug;
    },
    get iconSrc() {
      return loadBuiltInManifest(id).icon?.src;
    },
    get composerPrompt() {
      const manifest = loadBuiltInManifest(id);
      return (
        extensionContribution(manifest, "composer-prompt")?.prompt ??
        manifest.composer?.prompt
      );
    },
    get suggestedPrompts() {
      return loadBuiltInManifest(id).composer?.suggestions;
    },
    get defaultEnabled() {
      return loadBuiltInManifest(id).defaultEnabled;
    },
    get defaultHidden() {
      return loadBuiltInManifest(id).defaultHidden;
    },
    get preview() {
      return loadBuiltInManifest(id).preview;
    },
    get extensionManifest() {
      return loadBuiltInManifest(id);
    },
  };
}

const BUILT_IN_EXTENSION_IDS = [
  "computer-use",
  "browser-skill",
  "knowledge-search",
] as const;

export function isBuiltInOnMyAgentExtension(entry: Pick<McpDirectoryInfo, "kind" | "extensionManifest">): boolean {
  return entry.kind === "extension" && isTrustedBuiltInExtension(entry.extensionManifest);
}

/** Derive a safe MCP server name from a display name or explicit serverName. */
export function getMcpServerName(entry: McpDirectoryInfo): string {
  if (entry.serverName) return entry.serverName;
  return entry.name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "mcp";
}

export const MCP_QUICK_CONNECT: McpDirectoryInfo[] = [
  {
    get name() { return t("mcp.quick_connect_notion_title"); },
    serverName: "notion",
    get description() { return t("mcp.quick_connect_notion_desc"); },
    url: "https://mcp.notion.com/mcp",
    type: "remote",
    oauth: true,
    kind: "mcp",
    iconSlug: "notion",
    iconSrc: "/ext-notion.svg",
  },
  {
    get name() { return t("mcp.quick_connect_linear_title"); },
    serverName: "linear",
    get description() { return t("mcp.quick_connect_linear_desc"); },
    url: "https://mcp.linear.app/mcp",
    type: "remote",
    oauth: true,
    kind: "mcp",
    iconSlug: "linear",
    iconSrc: "/ext-linear.svg",
  },
  {
    get name() { return t("mcp.quick_connect_sentry_title"); },
    serverName: "sentry",
    get description() { return t("mcp.quick_connect_sentry_desc"); },
    url: "https://mcp.sentry.dev/mcp",
    type: "remote",
    oauth: true,
    kind: "mcp",
    iconSlug: "sentry",
    iconSrc: "/ext-sentry.svg",
  },
  {
    get name() { return t("mcp.quick_connect_stripe_title"); },
    serverName: "stripe",
    get description() { return t("mcp.quick_connect_stripe_desc"); },
    url: "https://mcp.stripe.com",
    type: "remote",
    oauth: true,
    kind: "mcp",
    iconSlug: "stripe",
    iconSrc: "/ext-stripe.svg",
  },
  {
    get name() { return t("mcp.quick_connect_context7_title"); },
    serverName: "context7",
    get description() { return t("mcp.quick_connect_context7_desc"); },
    url: "https://mcp.context7.com/mcp",
    type: "remote",
    oauth: false,
    kind: "mcp",
    iconSlug: "semanticscholar",
    iconSrc: "/ext-context7.svg",
  },
  {
    get name() { return t("mcp.quick_connect_onmyagent_cloud_title"); },
    serverName: "onmyagent-cloud",
    get description() { return t("mcp.quick_connect_onmyagent_cloud_desc"); },
    get url() {
      try {
        return `${readDenBootstrapConfig().baseUrl.replace(/\/+$/, "")}/mcp`;
      } catch {
        return "https://app.onmyagentlabs.com/mcp";
      }
    },
    type: "remote",
    oauth: true,
    kind: "mcp",
    iconSrc: "/on-my-agent-logo.png",
  },
  {
    get name() { return t("mcp.quick_connect_onmyagent_ui_title"); },
    serverName: "onmyagent-ui",
    get description() { return t("mcp.quick_connect_onmyagent_ui_desc"); },
    type: "local",
    // Dev builds replace this with the local checkout path before writing config.
    command: ["npx", "-y", "onmyagent-ui-mcp"],
    oauth: false,
    kind: "ui-control",
    iconSrc: "/on-my-agent-logo.png",
  },
  ...BUILT_IN_EXTENSION_IDS.map((id) => extensionManifestToDirectoryInfo(id)),
];

export const ONMYAGENT_EXTENSION_CATALOG = MCP_QUICK_CONNECT.filter(
  (entry) => entry.kind === "extension",
);
