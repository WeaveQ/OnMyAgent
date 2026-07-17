import type { ReloadReason } from "./types";
import { t } from "../i18n";
import { APP_NAME } from "../i18n/locales/brand";

export type OnMyAgentExtensionSourceFormat =
  | "onmyagent-builtin"
  | "onmyagent-extension-manifest"
  | "claude-plugin"
  | "opencode-plugin"
  | "mcp-directory"
  | "manual";

export type OnMyAgentExtensionSource = {
  format: OnMyAgentExtensionSourceFormat;
  trusted: boolean;
  origin?: "builtin" | "den" | "workspace" | "local";
  reference?: string;
};

export type OnMyAgentExtensionResourceType =
  | "skill"
  | "agent"
  | "command"
  | "tool"
  | "mcp"
  | "opencode-plugin"
  | "provider"
  | "hook"
  | "context"
  | "secret"
  | "file"
  | "local-service"
  | "native-binary";

export type OnMyAgentExtensionResource = {
  type: OnMyAgentExtensionResourceType;
  id: string;
  label?: string;
  description?: string;
  path?: string;
  command?: string[];
  envKey?: string;
  packageName?: string;
  providerId?: string;
  mcpServerName?: string;
  localCommandRef?: "onmyagent.computerUseMcp" | "onmyagent.uiMcp";
  required?: boolean;
};

export type OnMyAgentExtensionContributionType =
  | "settings-panel"
  | "setup-instructions"
  | "composer-prompt"
  | "session-side-panel"
  | "session-rail-item"
  | "control-actions"
  | "server-route"
  | "native-capability"
  | "test-action";

export type OnMyAgentExtensionContribution = {
  type: OnMyAgentExtensionContributionType;
  ref?: string;
  label?: string;
  description?: string;
  prompt?: string;
  location?:
    | "settings-detail"
    | "composer"
    | "session-right-pane"
    | "session-rail"
    | "server"
    | "native";
};

export type OnMyAgentExtensionSetup = {
  instructions?: string;
  primaryCta?: string;
  secondaryCta?: string;
  requiredEnv?: string[];
  testActionRef?: string;
};

export type OnMyAgentExtensionLifecycle = {
  reload?: ReloadReason[];
  detection?: string[];
};

// ---------------------------------------------------------------------------
// Enablement — declarative conditions for extension "active" state
// ---------------------------------------------------------------------------

export type EnablementConditionType =
  | "mcp-connected"
  | "plugin-loaded"
  | "provider-connected"
  | "env-set"
  | "permission-granted"
  | "toggle-enabled";

export type EnablementCondition = {
  type: EnablementConditionType;
  /** What to check — MCP server name, plugin id, env key, etc. */
  ref: string;
  /** Human-readable label shown in the UI. */
  label: string;
};

/** Result of evaluating a single enablement condition at runtime. */
export type EnablementResult = {
  condition: EnablementCondition;
  met: boolean;
};

export type OnMyAgentExtensionManifest = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  preview?: boolean;
  source: OnMyAgentExtensionSource;
  icon?: {
    src?: string;
    simpleIconSlug?: string;
  };
  composer?: {
    prompt: string;
    suggestions?: string[];
  };
  setup?: OnMyAgentExtensionSetup;
  resources: OnMyAgentExtensionResource[];
  contributions?: OnMyAgentExtensionContribution[];
  lifecycle?: OnMyAgentExtensionLifecycle;
  /** Declarative conditions that must ALL be true for the extension to be "active". */
  enablement?: EnablementCondition[];
  defaultEnabled?: boolean;
  defaultHidden?: boolean;
  platform?: Array<"darwin" | "linux" | "windows" | "web">;
};

export function extensionContribution(
  manifest: OnMyAgentExtensionManifest | undefined,
  type: OnMyAgentExtensionContributionType,
): OnMyAgentExtensionContribution | undefined {
  return manifest?.contributions?.find(
    (contribution) => contribution.type === type,
  );
}

export function extensionResource(
  manifest: OnMyAgentExtensionManifest | undefined,
  type: OnMyAgentExtensionResourceType,
): OnMyAgentExtensionResource | undefined {
  return manifest?.resources.find((resource) => resource.type === type);
}

export function isTrustedBuiltInExtension(
  manifest: OnMyAgentExtensionManifest | undefined,
): boolean {
  return manifest?.source.origin === "builtin" && manifest.source.trusted;
}

export const BUILT_IN_ONMYAGENT_EXTENSION_MANIFESTS: OnMyAgentExtensionManifest[] =
  [
    {
      schemaVersion: 1,
      id: "onmyagent-browser",
      name: `${APP_NAME} Browser`,
      description: `Automate the built-in browser panel that stays visible inside ${APP_NAME}.`,
      source: { format: "onmyagent-builtin", origin: "builtin", trusted: true },
      icon: { src: "/on-my-agent-logo.png" },
      composer: { prompt: "Use the OnMyAgent Browser extension to " },
      setup: {
        instructions:
          "OnMyAgent Browser is ready by default in desktop workspaces.",
        primaryCta: t("extensions.browser_primary_cta"),
      },
      resources: [
        {
          type: "opencode-plugin",
          id: "opencode-chrome-devtools",
          packageName: "opencode-chrome-devtools",
          required: true,
        },
      ],
      contributions: [
        {
          type: "settings-panel",
          ref: "onmyagent.browser.settings",
          location: "settings-detail",
        },
        {
          type: "session-side-panel",
          ref: "onmyagent.browser.panel",
          location: "session-right-pane",
        },
        {
          type: "composer-prompt",
          prompt: "Use the OnMyAgent Browser extension to ",
          location: "composer",
        },
      ],
      enablement: [
        { type: "toggle-enabled", ref: "onmyagent-browser", label: t("common.enabled") },
        {
          type: "plugin-loaded",
          ref: "opencode-chrome-devtools",
          label: t("extensions.browser_plugin_loaded"),
        },
      ],
      lifecycle: {
        reload: ["plugins", "agents"],
        detection: ["plugin:opencode-chrome-devtools"],
      },
      defaultEnabled: true,
    },
    {
      schemaVersion: 1,
      id: "computer-use",
      name: t("extensions.computer_use_name"),
      description: t("extensions.computer_use_description"),
      preview: true,
      source: { format: "onmyagent-builtin", origin: "builtin", trusted: true },
      icon: { src: "/on-my-agent-logo.png" },
      composer: {
        prompt: t("extensions.computer_use_prompt"),
        suggestions: [
          t("extensions.computer_use_suggestion_playlist"),
          t("extensions.computer_use_suggestion_xcode"),
          t("extensions.computer_use_suggestion_chess"),
        ],
      },
      setup: {
        instructions: t("extensions.computer_use_builtin_setup"),
        primaryCta: t("extensions.computer_use_connect_mcp"),
        secondaryCta: t("extensions.computer_use_check_permissions"),
        testActionRef: "onmyagent.computerUse.healthCheck",
      },
      resources: [
        {
          type: "mcp",
          id: "computer-use-mcp",
          label: t("extensions.computer_use_mcp"),
          mcpServerName: "computer-use",
          command: ["npx", "-y", "@onmyagent/handsfree", "mcp"],
          localCommandRef: "onmyagent.computerUseMcp",
          required: true,
        },
        {
          type: "native-binary",
          id: "computer-use-native",
          label: t("extensions.computer_use_native_runtime"),
          packageName: "@onmyagent/handsfree",
          required: true,
        },
      ],
      contributions: [
        {
          type: "setup-instructions",
          ref: "onmyagent.computerUse.setup",
          location: "settings-detail",
        },
        {
          type: "native-capability",
          ref: "onmyagent.computerUse.axPermissions",
          label: t("extensions.computer_use_permissions"),
        },
        {
          type: "test-action",
          ref: "onmyagent.computerUse.healthCheck",
          label: t("extensions.computer_use_verify_mcp"),
        },
        {
          type: "composer-prompt",
          prompt: t("extensions.computer_use_prompt"),
          location: "composer",
        },
      ],
      enablement: [
        {
          type: "mcp-connected",
          ref: "computer-use",
          label: t("extensions.mcp_server_connected"),
        },
        {
          type: "permission-granted",
          ref: "accessibility",
          label: t("extensions.accessibility_permission"),
        },
        {
          type: "permission-granted",
          ref: "screenRecording",
          label: t("extensions.screen_recording_permission"),
        },
      ],
      lifecycle: { reload: ["mcp"], detection: ["mcp:computer-use"] },
      platform: ["darwin"],
    },
    {
      schemaVersion: 1,
      id: "openai-image-gen",
      name: "OpenAI Image Gen",
      description: t("extensions.openai_image_desc"),
      source: { format: "onmyagent-builtin", origin: "builtin", trusted: true },
      icon: { src: "/ext-openai.svg" },
      composer: { prompt: "Use the OpenAI Image Gen extension to " },
      setup: {
        instructions:
          t("extensions.openai_image_setup"),
        primaryCta: t("extensions.openai_image_enable"),
        secondaryCta: t("extensions.openai_image_test"),
        requiredEnv: ["OPENAI_API_KEY"],
        testActionRef: "onmyagent.imageGen.testGenerate",
      },
      resources: [
        {
          type: "opencode-plugin",
          id: "onmyagent-image-generation",
          path: ".opencode/plugins/onmyagent-image-generation.ts",
          required: true,
        },
        {
          type: "secret",
          id: "openai-api-key",
          envKey: "OPENAI_API_KEY",
          required: true,
        },
        {
          type: "file",
          id: "openai-image-config",
          path: ".opencode/onmyagent-extensions/openai-image-generation.json",
          required: true,
        },
      ],
      contributions: [
        {
          type: "settings-panel",
          ref: "onmyagent.imageGen.settings",
          location: "settings-detail",
        },
        {
          type: "test-action",
          ref: "onmyagent.imageGen.testGenerate",
          label: t("extensions.openai_image_test"),
        },
        {
          type: "composer-prompt",
          prompt: "Use the OpenAI Image Gen extension to ",
          location: "composer",
        },
      ],
      enablement: [
        {
          type: "plugin-loaded",
          ref: "onmyagent-image-generation",
          label: t("extensions.openai_image_plugin_installed"),
        },
        { type: "env-set", ref: "OPENAI_API_KEY", label: t("extensions.openai_api_key") },
      ],
      lifecycle: {
        reload: ["plugins"],
        detection: ["plugin:onmyagent-image-generation"],
      },
    },
    {
      schemaVersion: 1,
      id: "onmyagent-voice",
      name: "Voice Mode",
      description:
        t("extensions.voice_desc"),
      preview: true,
      source: { format: "onmyagent-builtin", origin: "builtin", trusted: true },
      icon: { src: "/on-my-agent-logo.png" },
      composer: { prompt: "Use Voice Mode to " },
      setup: {
        instructions:
          t("extensions.voice_setup"),
        primaryCta: t("extensions.voice_save_openai_key"),
        secondaryCta: t("extensions.voice_test_realtime"),
        requiredEnv: ["OPENAI_REALTIME_API_KEY", "OPENAI_API_KEY"],
        testActionRef: "onmyagent.voice.testRealtime",
      },
      resources: [
        {
          type: "secret",
          id: "openai-realtime-api-key",
          envKey: "OPENAI_REALTIME_API_KEY",
          required: false,
        },
        {
          type: "secret",
          id: "openai-api-key",
          envKey: "OPENAI_API_KEY",
          required: true,
        },
        {
          type: "local-service",
          id: "onmyagent-voice-realtime-session",
          label: t("extensions.voice_realtime_client_secret"),
          required: true,
        },
      ],
      contributions: [
        {
          type: "settings-panel",
          ref: "onmyagent.voice.settings",
          location: "settings-detail",
        },
        {
          type: "session-side-panel",
          ref: "onmyagent.voice.panel",
          location: "session-right-pane",
        },
        {
          type: "session-rail-item",
          ref: "onmyagent.voice.rail",
          label: t("extensions.voice_mode"),
          location: "session-rail",
        },
        {
          type: "server-route",
          ref: "POST /voice/realtime/session",
          location: "server",
        },
        { type: "control-actions", ref: "onmyagent.voice.controlActions" },
        {
          type: "test-action",
          ref: "onmyagent.voice.testRealtime",
          label: t("extensions.voice_test_realtime"),
        },
        {
          type: "composer-prompt",
          prompt: "Use Voice Mode to ",
          location: "composer",
        },
      ],
      enablement: [
        { type: "toggle-enabled", ref: "onmyagent-voice", label: t("common.enabled") },
        { type: "env-set", ref: "OPENAI_API_KEY", label: t("extensions.openai_api_key") },
      ],
      lifecycle: {
        reload: ["config"],
        detection: ["env:OPENAI_REALTIME_API_KEY", "env:OPENAI_API_KEY"],
      },
    },
    {
      schemaVersion: 1,
      id: "ollama",
      name: "Ollama",
      description: t("extensions.ollama_desc"),
      source: { format: "onmyagent-builtin", origin: "builtin", trusted: true },
      icon: { src: "/ext-ollama.svg" },
      composer: { prompt: "Use the Ollama extension to " },
      setup: {
        instructions:
          t("extensions.ollama_setup"),
        primaryCta: t("extensions.ollama_add_model"),
        secondaryCta: t("extensions.ollama_pull_model"),
      },
      resources: [
        {
          type: "local-service",
          id: "ollama-api",
          label: t("extensions.ollama_api"),
          description: "http://localhost:11434",
          required: true,
        },
        {
          type: "provider",
          id: "ollama",
          providerId: "ollama",
          packageName: "@ai-sdk/openai-compatible",
          required: true,
        },
      ],
      contributions: [
        {
          type: "settings-panel",
          ref: "onmyagent.ollama.settings",
          location: "settings-detail",
        },
        {
          type: "test-action",
          ref: "onmyagent.ollama.listModels",
          label: t("extensions.ollama_check_models"),
        },
        {
          type: "composer-prompt",
          prompt: "Use the Ollama extension to ",
          location: "composer",
        },
      ],
      enablement: [
        { type: "provider-connected", ref: "ollama", label: t("extensions.ollama_provider") },
      ],
      lifecycle: { reload: ["config"], detection: ["provider:ollama"] },
    },
  ];
