/**
 * Den API response parsers (auth, orgs, workers, skills, LLM providers, billing).
 */

import type { DenOrgSkillCard } from "../types";
import type { DenUser } from "./den-types";
import { isRecord } from "./den-url-parse";
import type {
  DenAppVersionMetadata,
  DenOrgLlmProvider,
  DenOrgLlmProviderConnection,
  DenOrgLlmProviderModel,
  DenOrgSkillHub,
  DenOrgSkillHubSummary,
  DenOrgSummary,
  DenWorkerSummary,
  DenWorkerTokens,
  DenPluginConfigObject,
  DenPluginConfigObjectType,
  DenPluginConfigObjectVersion,
} from "./den-api-types";

function getDenAppVersionMetadata(payload: unknown): DenAppVersionMetadata | null {
  if (!isRecord(payload)) return null;

  const latestAppVersion =
    typeof payload.latestAppVersion === "string" ? payload.latestAppVersion.trim() : "";
  if (!latestAppVersion) return null;

  return {
    minAppVersion:
      typeof payload.minAppVersion === "string" ? payload.minAppVersion.trim() : "",
    latestAppVersion,
  };
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }

  if (!isRecord(payload)) {
    return fallback;
  }

  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }

  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }

  return fallback;
}

function getUser(payload: unknown): DenUser | null {
  if (!isRecord(payload) || !isRecord(payload.user)) {
    return null;
  }

  const user = payload.user;
  if (typeof user.id !== "string" || typeof user.email !== "string") {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: typeof user.name === "string" ? user.name : null,
  };
}

function getToken(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.token !== "string") {
    return null;
  }
  return payload.token.trim() || null;
}

function getOrgList(payload: unknown): DenOrgSummary[] {
  if (!isRecord(payload) || !Array.isArray(payload.orgs)) {
    return [];
  }

  return payload.orgs.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    if (
      typeof entry.id !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.slug !== "string" ||
      (entry.role !== "owner" && entry.role !== "admin" && entry.role !== "member")
    ) {
      return [];
    }

    return [
      {
        id: entry.id,
        name: entry.name,
        slug: entry.slug,
        role: entry.role,
      } satisfies DenOrgSummary,
    ];
  });
}

function getWorkers(payload: unknown): DenWorkerSummary[] {
  if (!isRecord(payload) || !Array.isArray(payload.workers)) {
    return [];
  }

  return payload.workers.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const instance = isRecord(entry.instance) ? entry.instance : null;
    if (typeof entry.id !== "string" || typeof entry.name !== "string") {
      return [];
    }
    return [
      {
        workerId: entry.id,
        workerName: entry.name,
        status: typeof entry.status === "string" ? entry.status : "unknown",
        instanceUrl: instance && typeof instance.url === "string" ? instance.url : null,
        provider: instance && typeof instance.provider === "string" ? instance.provider : null,
        isMine: Boolean(entry.isMine),
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : null,
      } satisfies DenWorkerSummary,
    ];
  });
}

function getWorkerTokens(payload: unknown): DenWorkerTokens | null {
  if (!isRecord(payload) || !isRecord(payload.tokens)) {
    return null;
  }

  const tokens = payload.tokens;
  const connect = isRecord(payload.connect) ? payload.connect : null;
  return {
    clientToken: typeof tokens.client === "string" ? tokens.client : null,
    ownerToken: typeof tokens.owner === "string" ? tokens.owner : null,
    hostToken: typeof tokens.host === "string" ? tokens.host : null,
    onmyagentUrl: connect && typeof connect.onmyagentUrl === "string" ? connect.onmyagentUrl : null,
    workspaceId: connect && typeof connect.workspaceId === "string" ? connect.workspaceId : null,
  };
}

function parseDenOrgSkillRow(record: Record<string, unknown>, hubName: string | null): DenOrgSkillCard | null {
  if (typeof record.id !== "string" || typeof record.title !== "string" || typeof record.skillText !== "string") {
    return null;
  }
  const description = typeof record.description === "string" ? record.description : null;
  const shared = record.shared === "org" || record.shared === "public" ? record.shared : null;
  return {
    id: record.id,
    title: record.title,
    description,
    skillText: record.skillText,
    hubName,
    shared,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
  };
}

function getDenOrgSkillsFromPayload(payload: unknown): DenOrgSkillCard[] {
  if (!isRecord(payload) || !Array.isArray(payload.skills)) {
    return [];
  }
  return payload.skills.flatMap((entry) => {
    const skill = isRecord(entry) ? parseDenOrgSkillRow(entry, null) : null;
    return skill ? [skill] : [];
  });
}

function parseOrgSkillHubEntry(hub: Record<string, unknown>): DenOrgSkillHub | null {
  const hubId = hub.id;
  const hubName = hub.name;
  const hubSkills = hub.skills;
  if (typeof hubId !== "string" || typeof hubName !== "string" || !Array.isArray(hubSkills)) {
    return null;
  }
  const skills = hubSkills.flatMap((s) => {
    const skill = isRecord(s) ? parseDenOrgSkillRow(s, hubName) : null;
    return skill ? [skill] : [];
  });
  return { id: hubId, name: hubName, skills };
}

function getDenOrgSkillHubsFromPayload(payload: unknown): DenOrgSkillHub[] {
  if (!isRecord(payload) || !Array.isArray(payload.skillHubs)) {
    return [];
  }
  return payload.skillHubs.flatMap((entry) => {
    const hub = isRecord(entry) ? parseOrgSkillHubEntry(entry) : null;
    return hub ? [hub] : [];
  });
}

function parseDenOrgLlmProviderModel(value: unknown): DenOrgLlmProviderModel | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    config: isRecord(value.config) ? value.config : {},
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
  };
}

function parseDenOrgLlmProvider(value: unknown): DenOrgLlmProvider | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.providerId !== "string" ||
    typeof value.name !== "string" ||
    (value.source !== "models_dev" &&
      value.source !== "custom" &&
      value.source !== "onmyagent")
  ) {
    return null;
  }

  return {
    id: value.id,
    source: value.source,
    providerId: value.providerId,
    name: value.name,
    providerConfig: isRecord(value.providerConfig) ? value.providerConfig : {},
    hasApiKey: value.hasApiKey === true,
    models: Array.isArray(value.models)
      ? value.models.flatMap((model) => {
          const parsed = parseDenOrgLlmProviderModel(model);
          return parsed ? [parsed] : [];
        })
      : [],
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

function getDenOrgLlmProviders(payload: unknown): DenOrgLlmProvider[] {
  if (!isRecord(payload) || !Array.isArray(payload.llmProviders)) {
    return [];
  }

  return payload.llmProviders.flatMap((provider) => {
    const parsed = parseDenOrgLlmProvider(provider);
    return parsed ? [parsed] : [];
  });
}

function getDenOrgLlmProviderConnection(payload: unknown): DenOrgLlmProviderConnection | null {
  if (!isRecord(payload) || !payload.llmProvider) {
    return null;
  }

  const provider = parseDenOrgLlmProvider(payload.llmProvider);
  if (!provider || !isRecord(payload.llmProvider)) {
    return null;
  }

  return {
    ...provider,
    apiKey: typeof payload.llmProvider.apiKey === "string" ? payload.llmProvider.apiKey : null,
  };
}

function getOrgSkillHubSummaries(payload: unknown): DenOrgSkillHubSummary[] {
  if (!isRecord(payload) || !Array.isArray(payload.skillHubs)) {
    return [];
  }

  return payload.skillHubs.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    if (typeof entry.id !== "string" || typeof entry.name !== "string" || typeof entry.canManage !== "boolean") {
      return [];
    }
    return [{ id: entry.id, name: entry.name, canManage: entry.canManage }];
  });
}

function getCreatedOrgSkillId(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.skill)) return null;
  return typeof payload.skill.id === "string" ? payload.skill.id : null;
}

function parsePluginConfigObjectType(value: unknown): DenPluginConfigObjectType | null {
  return value === "skill" || value === "agent" || value === "command" || value === "tool" ||
    value === "mcp" || value === "hook" || value === "context" || value === "custom"
    ? value
    : null;
}

function parsePluginConfigObjectVersion(value: unknown): DenPluginConfigObjectVersion | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    rawSourceText: typeof value.rawSourceText === "string" ? value.rawSourceText : null,
    normalizedPayloadJson: isRecord(value.normalizedPayloadJson) ? value.normalizedPayloadJson : null,
    sourceRevisionRef: typeof value.sourceRevisionRef === "string" ? value.sourceRevisionRef : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
  };
}

function parsePluginConfigObject(value: unknown): DenPluginConfigObject | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") return null;
  const objectType = parsePluginConfigObjectType(value.objectType);
  if (!objectType) return null;
  return {
    id: value.id,
    objectType,
    title: value.title,
    description: typeof value.description === "string" ? value.description : null,
    currentFileName: typeof value.currentFileName === "string" ? value.currentFileName : null,
    currentFileExtension: typeof value.currentFileExtension === "string" ? value.currentFileExtension : null,
    currentRelativePath: typeof value.currentRelativePath === "string" ? value.currentRelativePath : null,
    status: typeof value.status === "string" ? value.status : "active",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    latestVersion: parsePluginConfigObjectVersion(value.latestVersion),
  };
}

export {
  getDenAppVersionMetadata,
  getErrorMessage,
  getUser,
  getToken,
  getOrgList,
  getWorkers,
  getWorkerTokens,
  getDenOrgSkillsFromPayload,
  getDenOrgSkillHubsFromPayload,
  getDenOrgLlmProviders,
  getDenOrgLlmProviderConnection,
  getOrgSkillHubSummaries,
  getCreatedOrgSkillId,
  parsePluginConfigObject,
};
