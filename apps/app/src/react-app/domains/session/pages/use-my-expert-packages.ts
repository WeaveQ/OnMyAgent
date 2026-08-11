/**
 * Load "my experts" packages while the store experts tab is visible.
 * Shared by ExpertPage and AssistantPage.
 */
import { useMemo } from "react";

import type { ExpertMarketplaceEntry } from "@/react-app/domains/plugins";
import {
  isVisibleExpertPackageEntry,
  packageEntryToMarketplaceExpert,
} from "./shared-page-utils";
import { useExpertPackageQuery } from "../../agents";

export function useMyExpertPackages(options: {
  enabled: boolean;
}): ExpertMarketplaceEntry[] {
  const { enabled } = options;
  const packageQuery = useExpertPackageQuery(enabled);
  return useMemo(
    () =>
      (packageQuery.data ?? [])
        .filter(isVisibleExpertPackageEntry)
        .map(packageEntryToMarketplaceExpert),
    [packageQuery.data],
  );
}
