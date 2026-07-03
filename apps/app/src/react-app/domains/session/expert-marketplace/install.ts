import {
  installExpertPackage,
} from "../../../../app/lib/desktop";
import { isElectronRuntime } from "../../../../app/utils";
import type { ExpertMarketplaceEntry } from "./types";

export async function installSummonedMarketplaceExpert(
  expert: ExpertMarketplaceEntry,
): Promise<void> {
  if (!isElectronRuntime() || expert.source !== "builtin") return;
  await installExpertPackage({
    source: "builtin",
    marketplace: "experts",
    packageName: expert.packageName,
  });
}
