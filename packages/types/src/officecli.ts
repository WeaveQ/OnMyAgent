import { z } from "zod";

const officeCliVersionPattern = /^\d+\.\d+\.\d+$/;

const officeCliRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[A-Za-z]:[\\/]/.test(value) &&
      !value.split(/[\\/]/).includes(".."),
    "path must stay inside the OfficeCLI release root",
  );

export const officeCliAssetKeySchema = z.enum([
  "darwin-arm64",
  "darwin-x64",
  "win32-arm64",
  "win32-x64",
  "linux-arm64",
  "linux-x64",
]);

export const officeCliVersionSchema = z
  .string()
  .regex(officeCliVersionPattern, "version must use x.y.z format");

const officeCliFileSchema = z
  .object({
    path: officeCliRelativePathSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    size: z.number().int().nonnegative(),
  })
  .strict();

export const officeCliReleaseManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    pluginId: z.literal("officecli"),
    version: officeCliVersionSchema,
    skill: officeCliFileSchema,
    assets: z.partialRecord(officeCliAssetKeySchema, officeCliFileSchema),
  })
  .strict();

export const officeCliLatestManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    pluginId: z.literal("officecli"),
    channel: z.literal("stable"),
    latestVersion: officeCliVersionSchema,
    releaseManifest: officeCliFileSchema,
  })
  .strict();

export const officeCliReleaseStateSchema = z
  .object({
    binarySha256: z.string().regex(/^[a-f0-9]{64}$/i),
    skillSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict();

export const officeCliStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    pluginId: z.literal("officecli"),
    activeVersion: officeCliVersionSchema,
    previousVersion: officeCliVersionSchema.nullable(),
    platform: officeCliAssetKeySchema,
    installedSkillPath: z.string().min(1),
    installedAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    releases: z.record(officeCliVersionSchema, officeCliReleaseStateSchema),
  })
  .strict();

export type OfficeCliAssetKey = z.infer<typeof officeCliAssetKeySchema>;
export type OfficeCliLatestManifest = z.infer<
  typeof officeCliLatestManifestSchema
>;
export type OfficeCliReleaseManifest = z.infer<
  typeof officeCliReleaseManifestSchema
>;
export type OfficeCliState = z.infer<typeof officeCliStateSchema>;

export type OfficeCliLifecycleState =
  | "not_installed"
  | "checking"
  | "installing"
  | "installed"
  | "update_available"
  | "updating"
  | "uninstalling"
  | "unsupported"
  | "error";

export type OfficeCliStatus = {
  pluginId: "officecli";
  state: OfficeCliLifecycleState;
  supported: boolean;
  platform: OfficeCliAssetKey | string;
  installedVersion: string | null;
  latestVersion: string | null;
  previousVersion: string | null;
  usable: boolean;
  lastCheckedAt: number | null;
  errorCode?: string;
  errorMessage?: string;
};

export type OfficeCliProgress = {
  operation: "install" | "update" | "uninstall";
  phase:
    | "checking"
    | "downloading_manifest"
    | "downloading_binary"
    | "downloading_skill"
    | "verifying"
    | "installing"
    | "refreshing_skills"
    | "complete";
  receivedBytes?: number;
  totalBytes?: number;
};
