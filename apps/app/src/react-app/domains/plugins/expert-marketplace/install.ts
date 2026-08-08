import {
  installExpertPackage,
} from "../../../../app/lib/desktop";
import { isElectronRuntime } from "../../../../app/utils";
import type { ExpertMarketplaceEntry } from "./types";
import { createExpertPackageInstallCoordinator } from "./install-coordinator";

const coordinator = createExpertPackageInstallCoordinator(installExpertPackage);

export async function ensureMarketplaceExpertInstalled(
  expert: ExpertMarketplaceEntry,
): Promise<void> {
  if (!isElectronRuntime() || expert.source !== "builtin") return;
  await coordinator.ensure({
    source: "builtin",
    marketplace: "experts",
    packageName: expert.packageName,
  });
}

export async function installSummonedMarketplaceExpert(
  expert: ExpertMarketplaceEntry,
): Promise<void> {
  await ensureMarketplaceExpertInstalled(expert);
}
