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

/** Platform asset keys for all managed remote CLIs (OfficeCLI + lark-cli + …). */
export const officeCliAssetKeySchema = z.enum([
  "officecli-mac-arm64",
  "officecli-mac-x64",
  "officecli-win-arm64",
  "officecli-win-x64",
  "lark-cli-mac-arm64",
  "lark-cli-mac-x64",
  "lark-cli-win-arm64",
  "lark-cli-win-x64",
]);

export const managedCliPluginIdSchema = z.enum(["officecli", "lark-cli"]);

export const officeCliVersionSchema = z
  .string()
  .regex(officeCliVersionPattern, "version must use x.y.z format");

const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), "url must use HTTPS");

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

/** Binary asset: sha256 required; size optional; absolute CDN url preferred. */
const officeCliFileSchema = z
  .object({
    /** Relative path inside a legacy hierarchical release dir (optional when url is set). */
    path: officeCliRelativePathSchema.optional(),
    sha256: sha256Schema,
    /** Optional byte length of the verified payload (extracted binary for zip assets). */
    size: z.number().int().nonnegative().optional(),
    url: httpsUrlSchema.optional(),
    /** When url points to a zip, extract this entry (binary name). */
    archive: z.enum(["raw", "zip"]).optional(),
    entry: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.path || value.url), {
    message: "file descriptor must provide path or url",
  })
  .refine(
    (value) => value.archive !== "zip" || Boolean(value.entry || value.path),
    { message: "zip assets require entry (or path) for extract" },
  );

/**
 * Skill file: only absolute url is required (hash/size optional).
 * Binaries still use officeCliFileSchema with mandatory integrity.
 */
const officeCliSkillDescriptorSchema = z
  .object({
    url: httpsUrlSchema,
    path: officeCliRelativePathSchema.optional(),
    sha256: sha256Schema.optional(),
    size: z.number().int().nonnegative().optional(),
  })
  .strict();

/**
 * Optional multi-skill zip (advanced officecli-* / morph-ppt packages).
 * sha256/size apply to the zip bytes when provided.
 */
const officeCliSkillsPackSchema = z
  .object({
    url: httpsUrlSchema,
    archive: z.literal("zip").optional(),
    sha256: sha256Schema.optional(),
    size: z.number().int().nonnegative().optional(),
  })
  .strict();

const officeCliFileReferenceSchema = z.union([
  officeCliRelativePathSchema,
  officeCliFileSchema,
]);

/**
 * Self-contained root catalog (hot-update entry).
 * Clients only ship a permanent `manifestUrl`; this document holds version +
 * absolute skill/asset URLs + binary integrity.
 */
export const officeCliRootCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    pluginId: managedCliPluginIdSchema.optional(),
    channel: z.literal("stable"),
    latestVersion: officeCliVersionSchema,
    skill: officeCliSkillDescriptorSchema,
    /** Advanced skill packages zip; installed flat under profile skills root. */
    skillsPack: officeCliSkillsPackSchema.optional(),
    assets: z.partialRecord(officeCliAssetKeySchema, officeCliFileSchema),
  })
  .strict()
  .refine(
    (value) =>
      Object.keys(value.assets).length > 0 &&
      Object.values(value.assets).every((asset) => Boolean(asset?.url)),
    { message: "root catalog assets must provide https url", path: ["assets"] },
  );

/** Legacy two-file release manifest (relative paths under a release folder). */
export const officeCliReleaseManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    pluginId: managedCliPluginIdSchema.optional(),
    version: officeCliVersionSchema,
    officecliVersion: officeCliVersionSchema.optional(),
    skill: z.union([officeCliFileSchema, officeCliSkillDescriptorSchema]).optional(),
    skillPath: officeCliRelativePathSchema.optional(),
    skillsPack: officeCliSkillsPackSchema.optional(),
    assets: z.partialRecord(officeCliAssetKeySchema, officeCliFileSchema),
  })
  .refine((value) => value.skill !== undefined || value.skillPath !== undefined, {
    message: "release manifest must provide skill or skillPath",
    path: ["skill"],
  })
  .strict();
/** Legacy root pointer (latestVersion + releaseManifest). Still accepted. */
export const officeCliLatestManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    pluginId: managedCliPluginIdSchema.optional(),
    channel: z.literal("stable"),
    latestVersion: officeCliVersionSchema,
    releaseManifest: officeCliFileReferenceSchema,
  })
  .strict();

export const officeCliReleaseStateSchema = z
  .object({
    binarySha256: z.string().regex(/^[a-f0-9]{64}$/i),
    skillSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    skillsPackSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  })
  .strict();

export const officeCliStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    pluginId: managedCliPluginIdSchema,
    activeVersion: officeCliVersionSchema,
    previousVersion: officeCliVersionSchema.nullable(),
    platform: officeCliAssetKeySchema,
    installedSkillPath: z.string().min(1),
    /** Skill directory names managed with the entry skill (flat under skills root). */
    managedSkillIds: z.array(z.string().min(1)).optional(),
    installedAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    releases: z.record(officeCliVersionSchema, officeCliReleaseStateSchema),
  })
  .strict();
export type OfficeCliAssetKey = z.infer<typeof officeCliAssetKeySchema>;
export type ManagedCliPluginId = z.infer<typeof managedCliPluginIdSchema>;
export type OfficeCliRootCatalog = z.infer<typeof officeCliRootCatalogSchema>;
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
  pluginId: ManagedCliPluginId;
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
    | "downloading_skills_pack"
    | "verifying"
    | "installing"
    | "refreshing_skills"
    | "complete";
  receivedBytes?: number;
  totalBytes?: number;
};

/** @deprecated Alias — status shape is shared across managed CLIs. */
export type ManagedCliStatus = OfficeCliStatus;
export type ManagedCliProgress = OfficeCliProgress;