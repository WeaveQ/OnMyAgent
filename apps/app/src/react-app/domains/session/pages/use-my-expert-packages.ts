/**
 * Load "my experts" packages while the store experts tab is visible.
 * Shared by ExpertPage and AssistantPage.
 */
import { useEffect, useState } from "react";

import { listExpertPackages } from "../../../../app/lib/desktop";
import { isElectronRuntime } from "../../../../app/utils";
import type { ExpertMarketplaceEntry } from "../expert-marketplace/types";
import {
  isVisibleExpertPackageEntry,
  packageEntryToMarketplaceExpert,
} from "./shared-page-utils";

export function useMyExpertPackages(options: {
  enabled: boolean;
}): ExpertMarketplaceEntry[] {
  const { enabled } = options;
  const [myExpertPackages, setMyExpertPackages] = useState<
    ExpertMarketplaceEntry[]
  >([]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    if (!isElectronRuntime()) {
      setMyExpertPackages([]);
      return undefined;
    }

    let cancelled = false;
    listExpertPackages("my-experts")
      .then((entries) => {
        if (cancelled) return;
        setMyExpertPackages(
          entries
            .filter(isVisibleExpertPackageEntry)
            .map(packageEntryToMarketplaceExpert),
        );
      })
      .catch((error) => {
        console.warn("Failed to load local expert packages", error);
        if (!cancelled) setMyExpertPackages([]);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return myExpertPackages;
}
