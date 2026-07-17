import { z } from "zod";

const pluginIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const relativePluginPathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[A-Za-z]:[\\/]/.test(value) &&
      !value.split(/[\\/]/).includes(".."),
    "path must stay inside the plugin root",
  );

export const artifactPluginActivationSourceSchema = z.enum([
  "default-prompt",
  "composer",
  "slash-command",
  "natural-language",
  "attachment",
  "connected-app",
]);

export const artifactPluginConnectionStateSchema = z.object({
  status: z.enum(["connected", "disconnected", "unavailable", "error"]),
  reason: z.string().optional(),
  providerId: z.string().optional(),
}).strict();

export const artifactPluginContextSchema = z.object({
  pluginId: pluginIdSchema,
  skillId: pluginIdSchema,
  activationSource: artifactPluginActivationSourceSchema,
  attachmentIds: z.array(z.string()).optional(),
  connection: artifactPluginConnectionStateSchema.optional(),
}).strict();

export const artifactPluginEnablementSchema = z.object({
  plugins: z
    .record(
      pluginIdSchema,
      z
        .object({
          enabled: z.boolean(),
          skills: z.record(pluginIdSchema, z.boolean()).default({}),
        })
        .strict(),
    )
    .default({}),
}).strict();

export const artifactPluginManifestSchema = z.object({
  name: pluginIdSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  description: z.string().min(1),
  author: z
    .object({
      name: z.string().min(1),
      email: z.string().email().optional(),
      url: z.string().url().optional(),
    })
    .strict(),
  homepage: z.string().url().optional(),
  repository: z.string().url().optional(),
  license: z.string().min(1).optional(),
  keywords: z.array(z.string().min(1)).default([]),
  skills: relativePluginPathSchema.optional(),
  apps: relativePluginPathSchema.optional(),
  interface: z
    .object({
      displayName: z.string().min(1),
      shortDescription: z.string().min(1),
      longDescription: z.string().min(1),
      developerName: z.string().min(1),
      category: z.string().min(1),
      capabilities: z.array(z.string().min(1)),
      websiteURL: z.string().url().optional(),
      privacyPolicyURL: z.string().url().optional(),
      termsOfServiceURL: z.string().url().optional(),
      composerIcon: relativePluginPathSchema.optional(),
      logo: relativePluginPathSchema.optional(),
      logoDark: relativePluginPathSchema.optional(),
      defaultPrompt: z.array(z.string().min(1).max(128)).max(3),
      brandColor: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
      screenshots: z.array(relativePluginPathSchema).max(3).default([]),
    })
    .strict(),
}).strict();

export const artifactPluginRuntimeConfigSchema = z.object({
  skills: z
    .array(
      z
        .object({
          id: pluginIdSchema,
          defaultEnabled: z.boolean(),
        })
        .strict(),
    )
    .min(1),
  routing: z
    .object({
      extensions: z.array(z.string().regex(/^\.[A-Za-z0-9]+$/)),
      mimeTypes: z.array(z.string().min(1)),
    })
    .strict(),
  runtime: z
    .object({
      entry: relativePluginPathSchema,
      requiredTools: z.array(z.string().min(1)),
    })
    .strict()
    .optional(),
}).strict();

export type ArtifactPluginManifest = z.infer<
  typeof artifactPluginManifestSchema
>;
export type ArtifactPluginContext = z.infer<typeof artifactPluginContextSchema>;
export type ArtifactPluginEnablement = z.infer<
  typeof artifactPluginEnablementSchema
>;
export type ArtifactPluginConnectionState = z.infer<
  typeof artifactPluginConnectionStateSchema
>;
export type ArtifactPluginRuntimeConfig = z.infer<
  typeof artifactPluginRuntimeConfigSchema
>;
