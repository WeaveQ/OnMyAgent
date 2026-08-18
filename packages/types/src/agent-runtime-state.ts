import { z } from "zod";
import {
  agentRuntimeIdSchema as idSchema,
  agentRuntimeKindSchema,
  agentRuntimeModelRefSchema,
  agentRuntimeSessionProfileSchema,
  agentRuntimeTimestampSchema as timestampSchema,
} from "./agent-runtime-base.js";

export const runtimeSessionBindingSourceSchema = z.enum([
  "legacy-opencode-backfill",
  "global-default",
  "workspace-override",
  "explicit",
]);

export const runtimeSessionBindingSchema = z
  .object({
    productSessionId: idSchema,
    runtimeKind: agentRuntimeKindSchema,
    runtimeSessionId: idSchema,
    workspaceId: idSchema,
    cwd: z.string().min(1),
    profileId: idSchema,
    runtimeHome: z.string().min(1),
    parentProductSessionId: idSchema.optional(),
    parentRuntimeKind: agentRuntimeKindSchema.optional(),
    modelRef: agentRuntimeModelRefSchema.optional(),
    mode: idSchema.optional(),
    profile: agentRuntimeSessionProfileSchema.optional(),
    sandboxProfile: idSchema.optional(),
    createdAt: timestampSchema,
    source: runtimeSessionBindingSourceSchema.optional(),
  })
  .strict();

export const agentRuntimeHomeModeSchema = z.enum(["system", "managed"]);
export const agentRuntimeBinaryModeSchema = z.enum(["system", "bundled"]);

export const grokBuildRuntimeSelectionSchema = z
  .object({
    profileId: idSchema.optional(),
    homeMode: agentRuntimeHomeModeSchema.optional(),
    binaryMode: agentRuntimeBinaryModeSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.profileId
      && value.homeMode
      && (value.profileId === "system" || value.profileId === "managed")
      && value.profileId !== value.homeMode
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["profileId"],
        message: "Built-in Grok profileId must match homeMode",
      });
    }
  });

export const agentRuntimeSelectionConfigSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    defaultRuntimeKind: agentRuntimeKindSchema,
    workspaceOverrides: z.record(idSchema, agentRuntimeKindSchema),
    grokBuild: grokBuildRuntimeSelectionSchema.optional(),
  })
  .strict();

export const agentRuntimeSelectionReadStateSchema = z.enum([
  "ok",
  "missing",
  "corrupt",
  "unknown_version",
]);

export const agentRuntimeSelectionSnapshotSchema = z
  .object({
    state: agentRuntimeSelectionReadStateSchema,
    complete: z.boolean(),
    config: agentRuntimeSelectionConfigSchema.nullable(),
    sourceVersion: z.number().int().nonnegative().optional(),
  })
  .strict();

export type RuntimeSessionBindingSource = z.infer<typeof runtimeSessionBindingSourceSchema>;
export type RuntimeSessionBinding = z.infer<typeof runtimeSessionBindingSchema>;
export type AgentRuntimeHomeMode = z.infer<typeof agentRuntimeHomeModeSchema>;
export type AgentRuntimeBinaryMode = z.infer<typeof agentRuntimeBinaryModeSchema>;
export type GrokBuildRuntimeSelection = z.infer<typeof grokBuildRuntimeSelectionSchema>;
export type AgentRuntimeSelectionConfig = z.infer<typeof agentRuntimeSelectionConfigSchema>;
export type AgentRuntimeSelectionReadState = z.infer<typeof agentRuntimeSelectionReadStateSchema>;
export type AgentRuntimeSelectionSnapshot = z.infer<typeof agentRuntimeSelectionSnapshotSchema>;
