import type { ServerConfig } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import { ApprovalService } from "./approvals.js";
import { AgentRuntimeSelectionStore } from "./agent-runtime-selection.js";
import { GrokPermissionBridge } from "./grok-permission-bridge.js";
import { GrokProcessSupervisor } from "./grok-process-supervisor.js";
import type { GrokProcessPolicy } from "./grok-process-supervisor.js";
import { GrokRuntimeAdapter } from "./grok-runtime-adapter.js";
import { OpenCodeRuntimeAdapter } from "./opencode-runtime-adapter.js";
import { OpenCodeEventNormalizer } from "./opencode-event-normalizer.js";
import type { PrimaryOpencodeHostIdentity } from "./primary-runtime-host-state.js";
import {
  PrimaryRuntimeRegistry,
  type AgentRuntimeAdapter,
} from "./primary-runtime-registry.js";
import { RuntimeSessionBindingStore } from "./runtime-session-bindings.js";
import { PrimaryRuntimeEventBus } from "./primary-runtime-events.js";
import { GrokEventNormalizer } from "./grok-event-normalizer.js";
import { compileMinimalGrokExpertProfile } from "./grok-expert-profile-compiler.js";
import { assertCompiledExpertPromptBudget } from "./expert-runtime-contract.js";
import {
  grokNativeAgentProfilePayload,
  materializeGrokExpertPlugin,
} from "./grok-expert-plugin.js";
import {
  createExpertSessionRuntimeDirectory,
  ensureExpertSessionRuntimeIsolation,
  resolveExpertSessionRuntimeRoot,
} from "./expert-session-runtime.js";
import { resolveRuntimeDataRoot } from "./runtime-data-root.js";
import { isAbsolute, join, relative, resolve } from "node:path";
import { cp, lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import {
  compileGrokMcpServers,
  type ConnectorMcpProjectionSnapshot,
} from "./runtime-mcp-projection.js";

// Grok Expert minimal tool allowlist. run_terminal_cmd declares
// enabled_background=true, which Grok requires GrokBuild:get_task_output and
// GrokBuild:kill_task to satisfy (verified 2026-08-13: omitting them fails
// "Agent building failed ... Requirements unsatisfied" and the session falls
// back to the default grok-build-plan agent, silently dropping the Expert
// profile). Keep all three together.
const GROK_EXPERT_TOOL_IDS = [
  "GrokBuild:run_terminal_cmd",
  "GrokBuild:get_task_output",
  "GrokBuild:kill_task",
  "GrokBuild:read_file",
  "GrokBuild:search_replace",
  "GrokBuild:list_dir",
  "GrokBuild:grep",
] as const;

export type GrokRuntimeHostPolicy = GrokProcessPolicy & {
  profileId: string;
  profiles?: Readonly<Record<string, GrokProcessPolicy>>;
};

export type PrimaryRuntimeServerPolicy = {
  dataRoot?: string;
  opencodeIdentity?: PrimaryOpencodeHostIdentity;
  grok?: GrokRuntimeHostPolicy;
  /** Host-only credential projection. Never expose through server routes. */
  readConnectorMcpProjection?: () => Promise<ConnectorMcpProjectionSnapshot>;
  rollout?: {
    grokNewSessionsEnabled: boolean;
    grokWorkspaceAllowlist?: readonly string[];
  };
};

export function createPrimaryRuntimeServices(input: {
  config: ServerConfig;
  approvals: ApprovalService;
  policy?: PrimaryRuntimeServerPolicy;
  additionalAdapters?: readonly AgentRuntimeAdapter[];
}): {
  registry: PrimaryRuntimeRegistry;
  selection: AgentRuntimeSelectionStore;
  events: PrimaryRuntimeEventBus;
  readConnectorMcpProjection?: () => Promise<ConnectorMcpProjectionSnapshot>;
  expertRuntimeRoots: string[];
} {
  const dataRoot = input.policy?.dataRoot;
  const runtimeDataRoot = resolveRuntimeDataRoot(dataRoot);
  const selection = new AgentRuntimeSelectionStore({ dataRoot });
  const events = new PrimaryRuntimeEventBus();
  const adapters: AgentRuntimeAdapter[] = [...(input.additionalAdapters ?? [])];
  if (input.policy?.opencodeIdentity) {
    const normalizer = new OpenCodeEventNormalizer(events);
    const openCodeExpertRoot = resolveExpertSessionRuntimeRoot();
    adapters.push(new OpenCodeRuntimeAdapter({
      config: input.config,
      identity: input.policy.opencodeIdentity,
      onNativeEvent: (value) => normalizer.handle(value),
      async compileSessionProfile(runtimeInput) {
        if (runtimeInput.profile?.kind !== "expert") return {};
        const profile = runtimeInput.profile;
        const isolated = await createExpertSessionRuntimeDirectory({
          workspace: runtimeInput.workspace,
          agentName: profile.name,
          agentId: profile.expertId,
          packageName: profile.packageName ?? profile.expertId,
          sessionId: runtimeInput.productSessionId,
          runtimeKind: "opencode",
          sessionKey: Date.now().toString(),
          runtimeRoot: openCodeExpertRoot,
          skillNames: profile.declaredSkillNames,
          approvedAgentIds: profile.approvedAgentIds,
        });
        try {
          if (isolated.missingSkills.length) {
            throw new ApiError(
              409,
              "opencode_expert_skills_missing",
              "One or more declared OpenCode Expert skills are unavailable",
              { missingSkills: isolated.missingSkills },
            );
          }
          return {
            cwd: isolated.directory,
            cleanup: () => removeManagedExpertDirectory(
              openCodeExpertRoot,
              isolated.directory,
              "opencode_expert_runtime_unauthorized",
            ),
            async bindRuntimeIdentity(runtimeSessionId: string) {
              const bound = await ensureExpertSessionRuntimeIsolation({
                workspace: runtimeInput.workspace,
                directory: isolated.directory,
                runtimeRoot: openCodeExpertRoot,
                agentId: profile.expertId,
                packageName: profile.packageName ?? profile.expertId,
                sessionId: runtimeInput.productSessionId,
                runtimeKind: "opencode",
                runtimeSessionId,
                profileId: runtimeInput.profileId,
                skillNames: profile.declaredSkillNames,
                approvedAgentIds: profile.approvedAgentIds,
              });
              if (!bound || bound.isolationVersion !== 4) {
                throw new ApiError(
                  409,
                  "opencode_expert_identity_binding_failed",
                  "OpenCode Expert runtime identity could not be persisted",
                );
              }
            },
          };
        } catch (error) {
          await removeManagedExpertDirectory(
            openCodeExpertRoot,
            isolated.directory,
            "opencode_expert_runtime_unauthorized",
          );
          throw error;
        }
      },
      async cleanupSession(binding) {
        if (binding.profile?.kind !== "expert") return;
        await removeManagedExpertDirectory(
          openCodeExpertRoot,
          binding.cwd,
          "opencode_expert_runtime_unauthorized",
        );
      },
    }));
  }
  const grok = input.policy?.grok;
  if (grok) {
    const permissions = new GrokPermissionBridge(input.approvals, events);
    const normalizer = new GrokEventNormalizer(events);
    const supervisor = new GrokProcessSupervisor({
      onRequest: (method, params) => permissions.handle(method, params),
      onNotification: (method, params) => normalizer.handle(method, params),
    });
    adapters.push(new GrokRuntimeAdapter({
      supervisor,
      readCommandCatalog: (runtimeSessionId) => normalizer.commandCatalog(runtimeSessionId),
      availableProfileIds: [grok.profileId, ...Object.keys(grok.profiles ?? {})],
      respondQuestion: (productSessionId, questionId, answers) =>
        permissions.respondQuestion({ productSessionId, questionId, answers }),
      async resolveMcpServers(profile) {
        // Expert runtimes remain least-privilege: connector inheritance is an
        // Assistant capability until an Expert manifest explicitly declares it.
        if (profile?.kind !== "assistant") return [];
        const snapshot = await input.policy?.readConnectorMcpProjection?.() ?? {
          descriptors: [],
          accounts: [],
          complete: true,
        };
        if (!snapshot.complete) {
          throw new ApiError(
            409,
            "agent_runtime_mcp_projection_unavailable",
            "Connected MCP integrations could not be projected to Grok Build",
          );
        }
        return compileGrokMcpServers(snapshot.descriptors);
      },
      async compileSessionProfile(runtimeInput) {
        if (!runtimeInput.profile) return { meta: {} };
        if (runtimeInput.profile.kind === "assistant") {
          return {
            meta: runtimeInput.profile.systemPrompt
              ? { systemPromptOverride: runtimeInput.profile.systemPrompt }
              : {},
          };
        }
        const profile = runtimeInput.profile;
        const compiled = compileMinimalGrokExpertProfile({
          expertId: profile.expertId,
          description: profile.description,
          systemPrompt: profile.systemPrompt,
          declaredSkillNames: profile.declaredSkillNames,
          activatedSkillNames: profile.activatedSkillNames,
          allowedBuiltInToolIds: GROK_EXPERT_TOOL_IDS,
        });
        const pluginRoot = join(
          runtimeDataRoot,
          "runtime-state",
          "primary-runtime",
          "grok-expert-plugins",
        );
        const plugin = await createExpertSessionRuntimeDirectory({
          workspace: runtimeInput.workspace,
          agentName: profile.name,
          agentId: profile.expertId,
          packageName: profile.packageName ?? profile.expertId,
          sessionId: runtimeInput.productSessionId,
          runtimeKind: "grok-build",
          sessionKey: Date.now().toString(),
          runtimeRoot: pluginRoot,
          skillNames: compiled.materializedSkillNames,
        });
        try {
          if (plugin.missingSkills.length) {
            throw new ApiError(
              409,
              "grok_expert_skills_missing",
              "One or more declared Grok Expert skills are unavailable",
              { missingSkills: plugin.missingSkills },
            );
          }
          const grokSkillsRoot = join(plugin.directory, "skills");
          await mkdir(grokSkillsRoot, { recursive: true });
          for (const skillName of plugin.installedSkills) {
            await cp(
              join(plugin.directory, ".opencode", "skills", skillName),
              join(grokSkillsRoot, skillName),
              { recursive: true, force: true },
            );
          }
          await materializeGrokExpertPlugin({
            directory: plugin.directory,
            profile: compiled.agentProfile,
          });
          return {
            cwd: plugin.directory,
            cleanup: () => removeManagedGrokExpertDirectory(pluginRoot, plugin.directory),
            async bindRuntimeIdentity(runtimeSessionId: string) {
              const bound = await ensureExpertSessionRuntimeIsolation({
                workspace: runtimeInput.workspace,
                directory: plugin.directory,
                runtimeRoot: pluginRoot,
                agentId: profile.expertId,
                packageName: profile.packageName ?? profile.expertId,
                sessionId: runtimeInput.productSessionId,
                runtimeKind: "grok-build",
                runtimeSessionId,
                profileId: runtimeInput.profileId,
                skillNames: compiled.materializedSkillNames,
              });
              if (!bound || bound.isolationVersion !== 4) {
                throw new ApiError(
                  409,
                  "grok_expert_identity_binding_failed",
                  "Grok Expert runtime identity could not be persisted",
                );
              }
            },
            meta: {
              agentProfile: grokNativeAgentProfilePayload(compiled.agentProfile),
              pluginDirs: [plugin.directory],
            },
          };
        } catch (error) {
          await removeManagedGrokExpertDirectory(pluginRoot, plugin.directory);
          throw error;
        }
      },
      compileBoundSessionProfile(binding) {
        if (binding.profile?.kind === "assistant") {
          return binding.profile.systemPrompt
            ? { systemPromptOverride: binding.profile.systemPrompt }
            : {};
        }
        if (binding.profile?.kind !== "expert") return {};
        const compiled = compileMinimalGrokExpertProfile({
          expertId: binding.profile.expertId,
          description: binding.profile.description,
          systemPrompt: binding.profile.systemPrompt,
          declaredSkillNames: binding.profile.declaredSkillNames,
          activatedSkillNames: binding.profile.activatedSkillNames,
          allowedBuiltInToolIds: GROK_EXPERT_TOOL_IDS,
        });
        return {
          agentProfile: compiled.agentProfile,
          pluginDirs: [binding.cwd],
        };
      },
      resolvePolicy(runtimeInput) {
        const policy = resolveGrokProfilePolicy(grok, runtimeInput.profileId);
        if (!policy) {
          throw new ApiError(
            409,
            "agent_runtime_profile_unavailable",
            "Configured Grok profile is unavailable",
          );
        }
        return policy;
      },
      resolveBindingPolicy(binding) {
        const policy = resolveGrokProfilePolicy(grok, binding.profileId);
        if (!policy || binding.runtimeHome !== policy.runtimeHome) {
          throw new ApiError(
            409,
            "agent_runtime_profile_unavailable",
            "Bound Grok profile is unavailable",
          );
        }
        return policy;
      },
      bindPermissionSession: (sessionId, productSessionId, workspace) =>
        permissions.bindSession(sessionId, productSessionId, workspace),
      unbindPermissionSession: (sessionId) =>
        permissions.unbindSession(sessionId),
      async cleanupSession(binding) {
        const root = join(
          runtimeDataRoot,
          "runtime-state",
          "primary-runtime",
          "grok-expert-plugins",
        );
        if (binding.profile?.kind === "expert") {
          await removeManagedGrokExpertDirectory(root, binding.cwd);
        }
      },
      async assertPromptContract(binding, input) {
        if (binding.profile?.kind !== "expert") return;
        const root = join(
          runtimeDataRoot,
          "runtime-state",
          "primary-runtime",
          "grok-expert-plugins",
        );
        const directory = await authorizeManagedGrokExpertDirectory(root, binding.cwd);
        if (!directory) {
          throw new ApiError(
            409,
            "grok_expert_runtime_unauthorized",
            "Expert runtime directory is unavailable",
          );
        }
        const materialized = new Set(await readdir(join(directory, "skills")));
        const missing = binding.profile.declaredSkillNames.filter(
          (skillName) => !materialized.has(skillName),
        );
        if (missing.length) {
          throw new ApiError(
            409,
            "grok_expert_skills_missing",
            "One or more declared Grok Expert skills are unavailable",
            { missingSkills: missing },
          );
        }
        const compiled = compileMinimalGrokExpertProfile({
          expertId: binding.profile.expertId,
          description: binding.profile.description,
          systemPrompt: binding.profile.systemPrompt,
          declaredSkillNames: binding.profile.declaredSkillNames,
          activatedSkillNames: binding.profile.activatedSkillNames,
          allowedBuiltInToolIds: GROK_EXPERT_TOOL_IDS,
        });
        assertCompiledExpertPromptBudget({
          compiledSystemPrompt: compiled.agentProfile.promptBody,
          userPrompt: input.text,
        });
      },
    }));
  }
  return {
    selection,
    events,
    readConnectorMcpProjection: input.policy?.readConnectorMcpProjection,
    expertRuntimeRoots: [
      resolveExpertSessionRuntimeRoot(),
      join(runtimeDataRoot, "runtime-state", "primary-runtime", "grok-expert-plugins"),
    ],
    registry: new PrimaryRuntimeRegistry({
      workspaces: input.config.workspaces,
      selection,
      adapters,
      bindingStore: (workspace) => new RuntimeSessionBindingStore({
        dataRoot,
        workspace,
      }),
      opencodeProfileId: input.policy?.opencodeIdentity?.profileId,
      runtimeRollout: input.policy?.rollout,
      events,
    }),
  };
}

function resolveGrokProfilePolicy(
  policy: GrokRuntimeHostPolicy,
  profileId: string,
): GrokProcessPolicy | null {
  if (profileId === policy.profileId) return policy;
  return policy.profiles?.[profileId] ?? null;
}

export async function removeManagedGrokExpertDirectory(
  root: string,
  candidate: string,
): Promise<void> {
  await removeManagedExpertDirectory(root, candidate, "grok_expert_runtime_unauthorized");
}

async function removeManagedExpertDirectory(
  root: string,
  candidate: string,
  errorCode: string,
): Promise<void> {
  const authorized = await authorizeManagedGrokExpertDirectory(root, candidate, {
    missing: "ignore",
  }, errorCode);
  if (!authorized) return;
  await rm(authorized, { recursive: true, force: true });
}

async function authorizeManagedGrokExpertDirectory(
  root: string,
  candidate: string,
  options: { missing?: "ignore" | "reject" } = {},
  errorCode = "grok_expert_runtime_unauthorized",
): Promise<string | null> {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const lexicalRelative = relative(resolvedRoot, resolvedCandidate);
  if (
    !lexicalRelative
    || lexicalRelative === ".."
    || lexicalRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    || isAbsolute(lexicalRelative)
  ) {
    throw new ApiError(409, errorCode, "Expert runtime directory is outside the managed root");
  }
  let candidateStat;
  try {
    candidateStat = await lstat(resolvedCandidate);
  } catch (error) {
    if (isMissingPathError(error) && options.missing === "ignore") return null;
    throw error;
  }
  if (candidateStat.isSymbolicLink()) {
    throw new ApiError(409, errorCode, "Expert runtime directory cannot be a symbolic link");
  }
  const [realRoot, realCandidate] = await Promise.all([
    realpath(resolvedRoot),
    realpath(resolvedCandidate),
  ]);
  const realRelative = relative(realRoot, realCandidate);
  if (
    !realRelative
    || realRelative === ".."
    || realRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    || isAbsolute(realRelative)
  ) {
    throw new ApiError(409, errorCode, "Expert runtime directory is outside the managed root");
  }
  return realCandidate;
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
