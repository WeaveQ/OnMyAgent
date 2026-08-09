// Expert marketplace IPC types (split out to keep desktop-ipc.ts under file-size baseline).

export type ExpertMarketplaceName = "experts" | "my-experts";

export type ExpertPackageInstallInput = {
  source: "builtin";
  marketplace: ExpertMarketplaceName;
  packageName: string;
};

export type ExpertPackageInstallResult = {
  ok: true;
  path: string;
  packageName: string;
  marketplace: ExpertMarketplaceName;
};

export type ExpertPackageUninstallInput = {
  marketplace: ExpertMarketplaceName;
  packageName: string;
};

export type ExpertPackageUninstallResult = {
  ok: true;
  path: string;
  packageName: string;
  marketplace: ExpertMarketplaceName;
  /** Package-owned skills removed from the user skills root. */
  removedSkills: string[];
  /** False when the package directory was already absent. */
  removedPackage: boolean;
};
