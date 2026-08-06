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
  "officecli-mac-arm64",
  "officecli-mac-x64",
  "officecli-win-arm64",
  "officecli-win-x64",
]);

export const officeCliVersionSchema = z
  .string()
  .regex(officeCliVersionPattern, "version must use x.y.z format");

const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), "url must use HTTPS");

/** Integrity + optional absolute download URL (CDN-friendly). */
const officeCliFileSchema = z
  .object({
    /** Relative path inside a legacy hierarchical release dir (optional when url is set). */
    path: officeCliRelativePathSchema.optional(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    size: z.number().int().nonnegative(),
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

const officeCliFileReferenceSchema = z.union([
  officeCliRelativePathSchema,
  officeCliFileSchema,
]);

/**
 * Self-contained root catalog (hot-update entry).
 * Clients only ship a permanent `manifestUrl`; this document holds version +
 * absolute skill/asset URLs + integrity. Replace the object on CDN (or point
 * the same stable URL at a new object via CDN config) to publish updates.
 */
export const officeCliRootCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    pluginId: z.literal("officecli").optional(),
    channel: z.literal("stable"),
    latestVersion: officeCliVersionSchema,
    skill: officeCliFileSchema,
    assets: z.partialRecord(officeCliAssetKeySchema, officeCliFileSchema),
  })
  .strict()
  .refine((value) => Boolean(value.skill.url), {
    message: "root catalog skill must provide https url",
    path: ["skill", "url"],
  })
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
    pluginId: z.literal("officecli").optional(),
    version: officeCliVersionSchema,
    officecliVersion: officeCliVersionSchema.optional(),
    skill: officeCliFileSchema.optional(),
    skillPath: officeCliRelativePathSchema.optional(),
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
    pluginId: z.literal("officecli").optional(),
    channel: z.literal("stable"),
    latestVersion: officeCliVersionSchema,
    releaseManifest: officeCliFileReferenceSchema,
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
