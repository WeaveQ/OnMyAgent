/**
 * Den API parsers for org plugins, marketplaces, and OnMyAgent extension projections.
 */

import type { ReloadReason } from "../types";
import type {
  OnMyAgentExtensionContribution,
  OnMyAgentExtensionContributionType,
  OnMyAgentExtensionLifecycle,
  OnMyAgentExtensionManifest,
  OnMyAgentExtensionResource,
  OnMyAgentExtensionResourceType,
  OnMyAgentExtensionSetup,
  OnMyAgentExtensionSource,
  OnMyAgentExtensionSourceFormat,
} from "../extensions";
import { isRecord } from "./den-url-parse";
import { parsePluginConfigObject } from "./den-api-parse";
import type {
  DenOrgExtensionProjection,
  DenOrgMarketplace,
  DenOrgMarketplaceResolved,
  DenOrgPlugin,
  DenOrgPluginResolved,
  DenPluginMembership,
} from "./den-api-types";

function parseExtensionSourceFormat(value: unknown): OnMyAgentExtensionSourceFormat | null {
  switch (value) {
    case "onmyagent-builtin":
    case "onmyagent-extension-manifest":
    case "claude-plugin":
    case "opencode-plugin":
    case "mcp-directory":
    case "manual":
      return value;
    default:
      return null;
  }
}

function parseExtensionSourceOrigin(value: unknown): OnMyAgentExtensionSource["origin"] | undefined {
  switch (value) {
    case "builtin":
    case "den":
    case "workspace":
    case "local":
      return value;
    default:
      return undefined;
  }
}

function parseExtensionSource(value: unknown): OnMyAgentExtensionSource | null {
  if (!isRecord(value) || typeof value.trusted !== "boolean") return null;
  const format = parseExtensionSourceFormat(value.format);
  if (!format) return null;
  const origin = parseExtensionSourceOrigin(value.origin);
  return {
    format,
    trusted: value.trusted,
    ...(origin ? { origin } : {}),
    ...(typeof value.reference === "string" ? { reference: value.reference } : {}),
  };
}

function parseStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return undefined;
  return value;
}

function parseExtensionResourceType(value: unknown): OnMyAgentExtensionResourceType | null {
  switch (value) {
    case "skill":
    case "agent":
    case "command":
    case "tool":
    case "mcp":
    case "opencode-plugin":
    case "provider":
    case "hook":
    case "context":
    case "secret":
    case "file":
    case "local-service":
    case "native-binary":
      return value;
    default:
      return null;
  }
}

function parseExtensionLocalCommandRef(value: unknown): OnMyAgentExtensionResource["localCommandRef"] | undefined {
  switch (value) {
    case "onmyagent.computerUseMcp":
    case "onmyagent.uiMcp":
      return value;
    default:
      return undefined;
  }
}

function parseExtensionResource(value: unknown): OnMyAgentExtensionResource | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const type = parseExtensionResourceType(value.type);
  if (!type) return null;
  const command = parseStringList(value.command);
  const localCommandRef = parseExtensionLocalCommandRef(value.localCommandRef);
  return {
    type,
    id: value.id,
    ...(typeof value.label === "string" ? { label: value.label } : {}),
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(typeof value.path === "string" ? { path: value.path } : {}),
    ...(command ? { command } : {}),
    ...(typeof value.envKey === "string" ? { envKey: value.envKey } : {}),
    ...(typeof value.packageName === "string" ? { packageName: value.packageName } : {}),
    ...(typeof value.providerId === "string" ? { providerId: value.providerId } : {}),
    ...(typeof value.mcpServerName === "string" ? { mcpServerName: value.mcpServerName } : {}),
    ...(localCommandRef ? { localCommandRef } : {}),
    ...(typeof value.required === "boolean" ? { required: value.required } : {}),
  };
}

function parseExtensionContributionType(value: unknown): OnMyAgentExtensionContributionType | null {
  switch (value) {
    case "settings-panel":
    case "setup-instructions":
    case "composer-prompt":
    case "session-side-panel":
    case "session-rail-item":
    case "control-actions":
    case "server-route":
    case "native-capability":
    case "test-action":
      return value;
    default:
      return null;
  }
}

function parseExtensionContributionLocation(value: unknown): OnMyAgentExtensionContribution["location"] | undefined {
  switch (value) {
    case "settings-detail":
    case "composer":
    case "session-right-pane":
    case "session-rail":
    case "server":
    case "native":
      return value;
    default:
      return undefined;
  }
}

function parseExtensionContribution(value: unknown): OnMyAgentExtensionContribution | null {
  if (!isRecord(value)) return null;
  const type = parseExtensionContributionType(value.type);
  if (!type) return null;
  const location = parseExtensionContributionLocation(value.location);
  return {
    type,
    ...(typeof value.ref === "string" ? { ref: value.ref } : {}),
    ...(typeof value.label === "string" ? { label: value.label } : {}),
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(typeof value.prompt === "string" ? { prompt: value.prompt } : {}),
    ...(location ? { location } : {}),
  };
}

function parseExtensionSetup(value: unknown): OnMyAgentExtensionSetup | undefined {
  if (!isRecord(value)) return undefined;
  const requiredEnv = parseStringList(value.requiredEnv);
  return {
    ...(typeof value.instructions === "string" ? { instructions: value.instructions } : {}),
    ...(typeof value.primaryCta === "string" ? { primaryCta: value.primaryCta } : {}),
    ...(typeof value.secondaryCta === "string" ? { secondaryCta: value.secondaryCta } : {}),
    ...(requiredEnv ? { requiredEnv } : {}),
    ...(typeof value.testActionRef === "string" ? { testActionRef: value.testActionRef } : {}),
  };
}

function parseReloadReason(value: unknown): ReloadReason | null {
  switch (value) {
    case "plugins":
    case "skills":
    case "mcp":
    case "config":
    case "agents":
    case "commands":
      return value;
    default:
      return null;
  }
}

function parseReloadReasons(value: unknown): ReloadReason[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const reasons = value.flatMap((item) => {
    const reason = parseReloadReason(item);
    return reason ? [reason] : [];
  });
  return reasons.length === value.length ? reasons : undefined;
}

function parseExtensionLifecycle(value: unknown): OnMyAgentExtensionLifecycle | undefined {
  if (!isRecord(value)) return undefined;
  const reload = parseReloadReasons(value.reload);
  const detection = parseStringList(value.detection);
  return {
    ...(reload ? { reload } : {}),
    ...(detection ? { detection } : {}),
  };
}

function parseExtensionPlatform(value: unknown): OnMyAgentExtensionManifest["platform"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const platforms = value.flatMap((item) => {
    switch (item) {
      case "darwin":
      case "linux":
      case "windows":
      case "web":
        return [item];
      default:
        return [];
    }
  });
  return platforms.length === value.length ? platforms : undefined;
}

function parseOnMyAgentExtensionManifest(value: unknown): OnMyAgentExtensionManifest | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    !Array.isArray(value.resources)
  ) {
    return null;
  }
  const source = parseExtensionSource(value.source);
  if (!source) return null;
  const resources = value.resources.flatMap((entry) => {
    const resource = parseExtensionResource(entry);
    return resource ? [resource] : [];
  });
  if (resources.length !== value.resources.length) return null;
  const contributions = Array.isArray(value.contributions)
    ? value.contributions.flatMap((entry) => {
        const contribution = parseExtensionContribution(entry);
        return contribution ? [contribution] : [];
      })
    : undefined;
  if (Array.isArray(value.contributions) && contributions?.length !== value.contributions.length) return null;
  const setup = parseExtensionSetup(value.setup);
  const lifecycle = parseExtensionLifecycle(value.lifecycle);
  const platform = parseExtensionPlatform(value.platform);
  if (Array.isArray(value.platform) && !platform) return null;
  return {
    schemaVersion: 1,
    id: value.id,
    name: value.name,
    description: value.description,
    source,
    ...(isRecord(value.icon)
      ? { icon: {
          ...(typeof value.icon.src === "string" ? { src: value.icon.src } : {}),
          ...(typeof value.icon.simpleIconSlug === "string" ? { simpleIconSlug: value.icon.simpleIconSlug } : {}),
        } }
      : {}),
    ...(isRecord(value.composer) && typeof value.composer.prompt === "string" ? { composer: { prompt: value.composer.prompt } } : {}),
    ...(setup ? { setup } : {}),
    resources,
    ...(contributions ? { contributions } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    ...(typeof value.defaultEnabled === "boolean" ? { defaultEnabled: value.defaultEnabled } : {}),
    ...(typeof value.defaultHidden === "boolean" ? { defaultHidden: value.defaultHidden } : {}),
    ...(platform ? { platform } : {}),
  };
}

function parseDenExtensionProjection(value: unknown): DenOrgExtensionProjection | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  const sourceFormat = parseExtensionSourceFormat(value.sourceFormat);
  if (!sourceFormat) return null;
  return {
    id: value.id,
    name: value.name,
    description: typeof value.description === "string" ? value.description : null,
    sourceFormat,
    manifest: parseOnMyAgentExtensionManifest(value.manifest),
  };
}

function parseOrgPlugin(value: unknown): DenOrgPlugin | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  const counts = isRecord(value.componentCounts)
    ? Object.fromEntries(
        Object.entries(value.componentCounts).filter((entry): entry is [string, number] =>
          typeof entry[0] === "string" && typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0,
        ),
      )
    : {};
  return {
    id: value.id,
    name: value.name,
    description: typeof value.description === "string" ? value.description : null,
    status: typeof value.status === "string" ? value.status : "active",
    memberCount: typeof value.memberCount === "number" && Number.isFinite(value.memberCount) ? value.memberCount : 0,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    componentCounts: counts,
    extension: parseDenExtensionProjection(value.extension),
  };
}

function parseOrgMarketplace(value: unknown): DenOrgMarketplace | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  return {
    id: value.id,
    name: value.name,
    description: typeof value.description === "string" ? value.description : null,
    status: typeof value.status === "string" ? value.status : "active",
    pluginCount: typeof value.pluginCount === "number" && Number.isFinite(value.pluginCount) ? value.pluginCount : 0,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

function parsePluginMembership(value: unknown): DenPluginMembership | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.pluginId !== "string" || typeof value.configObjectId !== "string") {
    return null;
  }
  const configObject = parsePluginConfigObject(value.configObject);
  return {
    id: value.id,
    pluginId: value.pluginId,
    configObjectId: value.configObjectId,
    ...(configObject ? { configObject } : {}),
  };
}

function getOrgMarketplaces(payload: unknown): DenOrgMarketplace[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return [];
  return payload.items.flatMap((item) => {
    const marketplace = parseOrgMarketplace(item);
    return marketplace ? [marketplace] : [];
  });
}

function getOrgMarketplaceResolved(payload: unknown): DenOrgMarketplaceResolved | null {
  if (!isRecord(payload) || !isRecord(payload.item)) return null;
  const marketplace = parseOrgMarketplace(payload.item.marketplace);
  if (!marketplace || !Array.isArray(payload.item.plugins)) return null;
  return {
    marketplace,
    plugins: payload.item.plugins.flatMap((item) => {
      const plugin = parseOrgPlugin(item);
      return plugin ? [plugin] : [];
    }),
  };
}

function getOrgPluginResolved(plugin: DenOrgPlugin, payload: unknown): DenOrgPluginResolved {
  const memberships = isRecord(payload) && Array.isArray(payload.items)
    ? payload.items.flatMap((item) => {
        const membership = parsePluginMembership(item);
        return membership ? [membership] : [];
      })
    : [];
  return { plugin, memberships };
}

export {
  getOrgMarketplaces,
  getOrgMarketplaceResolved,
  getOrgPluginResolved,
};
