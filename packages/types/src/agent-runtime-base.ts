import { z } from "zod";

export const agentRuntimeIdSchema = z.string().trim().min(1);
export const agentRuntimeTimestampSchema = z.number().int().nonnegative();

export const agentRuntimeKindSchema = z.enum(["opencode", "grok-build"]);

export const agentRuntimeModelRefSchema = z
  .object({
    // OpenCode identifies models by provider + model. ACP runtimes such as
    // Grok Build expose a runtime-scoped model id without a provider id.
    providerId: agentRuntimeIdSchema.optional(),
    modelId: agentRuntimeIdSchema,
    variant: agentRuntimeIdSchema.optional(),
  })
  .strict();

export type AgentRuntimeKind = z.infer<typeof agentRuntimeKindSchema>;
export type AgentRuntimeModelRef = z.infer<typeof agentRuntimeModelRefSchema>;

export const agentRuntimeAssistantProfileSchema = z.object({
  kind: z.literal("assistant"),
  systemPrompt: z.string().trim().min(1).max(64 * 1024).optional(),
}).strict();

export const agentRuntimeExpertProfileSchema = z.object({
  kind: z.literal("expert"),
  expertId: agentRuntimeIdSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2_000),
  systemPrompt: z.string().trim().min(1).max(128 * 1024),
  packageName: agentRuntimeIdSchema.optional(),
  declaredSkillNames: z.array(agentRuntimeIdSchema).max(64).default([]),
  activatedSkillNames: z.array(agentRuntimeIdSchema).max(64).default([]),
  approvedAgentIds: z.array(agentRuntimeIdSchema).max(64).default([]),
}).strict();

export const agentRuntimeSessionProfileSchema = z.discriminatedUnion("kind", [
  agentRuntimeAssistantProfileSchema,
  agentRuntimeExpertProfileSchema,
]);

export type AgentRuntimeAssistantProfile = z.infer<typeof agentRuntimeAssistantProfileSchema>;
export type AgentRuntimeExpertProfile = z.infer<typeof agentRuntimeExpertProfileSchema>;
export type AgentRuntimeSessionProfile = z.infer<typeof agentRuntimeSessionProfileSchema>;
