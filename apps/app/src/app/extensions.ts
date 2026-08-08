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
  /** Short market-card line (≈1–2 lines). */
  description: string;
  /** Longer product blurb for connect/detail dialog. Falls back to description. */
  longDescription?: string;
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

/**
 * Built-in extension manifests. Always call this function (do not cache the
 * array across locale switches) so `t()` resolves the active language.
 */
export function getBuiltInOnMyAgentExtensionManifests(): OnMyAgentExtensionManifest[] {
  return [
    {
      schemaVersion: 1,
      id: "computer-use",
      name: t("extensions.computer_use_name"),
      description: t("extensions.computer_use_description"),
      longDescription: t("extensions.computer_use_long"),
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
      // macOS HandsFree + Windows Cua Driver (Linux not wired yet).
      platform: ["darwin", "windows"],
    },
    {
      schemaVersion: 1,
      id: "browser-skill",
      name: t("extensions.browser_skill_name"),
      description: t("extensions.browser_skill_description"),
      longDescription: t("extensions.browser_skill_long"),
      preview: true,
      source: { format: "onmyagent-builtin", origin: "builtin", trusted: true },
      icon: { src: "/on-my-agent-logo.png" },
      composer: {
        prompt: t("extensions.browser_skill_prompt"),
        suggestions: [
          t("extensions.browser_skill_suggestion_summary"),
          t("extensions.browser_skill_suggestion_form"),
          t("extensions.browser_skill_suggestion_smoke"),
        ],
      },
      setup: {
        instructions: t("extensions.browser_skill_setup"),
        primaryCta: t("extensions.browser_skill_install_extension"),
        secondaryCta: t("extensions.browser_skill_run_doctor"),
        testActionRef: "onmyagent.browserSkill.healthCheck",
      },
      resources: [
        {
          type: "skill",
          id: "browser-skill-bundled",
          label: t("extensions.browser_skill_skill_label"),
          path: "bundled-skills/browser-skill/SKILL.md",
          required: true,
        },
        {
          type: "local-service",
          id: "browser-skill-bsk-cli",
          label: t("extensions.browser_skill_cli_label"),
          description: "bsk",
          required: true,
        },
      ],
      contributions: [
        {
          type: "settings-panel",
          ref: "onmyagent.browserSkill.settings",
          location: "settings-detail",
        },
        {
          type: "setup-instructions",
          ref: "onmyagent.browserSkill.setup",
          location: "settings-detail",
        },
        {
          type: "test-action",
          ref: "onmyagent.browserSkill.healthCheck",
          label: t("extensions.browser_skill_run_doctor"),
        },
        {
          type: "composer-prompt",
          prompt: t("extensions.browser_skill_prompt"),
          location: "composer",
        },
      ],
      enablement: [
        {
          type: "toggle-enabled",
          ref: "browser-skill",
          label: t("common.enabled"),
        },
      ],
      lifecycle: {
        reload: ["config"],
        detection: ["cli:bsk", "extension:browser-skill"],
      },
      platform: ["darwin", "linux", "windows"],
    }
  ];
}

/** @deprecated Prefer getBuiltInOnMyAgentExtensionManifests() for live locale. */
export const BUILT_IN_ONMYAGENT_EXTENSION_MANIFESTS: OnMyAgentExtensionManifest[] =
  getBuiltInOnMyAgentExtensionManifests();