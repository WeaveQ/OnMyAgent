import {
  installExpertPackage,
} from "../../../../app/lib/desktop";
import { isElectronRuntime } from "../../../../app/utils";
import type { ExpertMarketplaceEntry } from "./types";
import { createExpertPackageInstallCoordinator } from "./install-coordinator";

const coordinator = createExpertPackageInstallCoordinator(installExpertPackage);

type MarketplaceExpertInstallTarget = Pick<
  ExpertMarketplaceEntry,
  "source" | "packageName"
>;

export async function ensureMarketplaceExpertInstalled(
  expert: MarketplaceExpertInstallTarget,
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
