/** Reactive owner for locally installed Expert package metadata. */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { listExpertPackages } from "../../../app/lib/desktop";
import type { ExpertPackageListEntry } from "../../../app/lib/desktop";
import { isElectronRuntime } from "../../../app/utils";
import { getReactQueryClient } from "../../infra/query-client";
import { reconcilePersistedMineExpertAvatars } from "./expert-import-registry";

export const EXPERT_PACKAGE_QUERY_KEY = ["expert-packages", "local"] as const;

export type ExpertPackageMarketplace = "experts" | "my-experts";

/**
 * Chat enter stays self-created only.
 * Store "已召唤专家" and expert-page metadata include marketplace installs.
 */
export function expertPackageMarketplacesForEnter(
  surface: "chat" | "store" | "expert-page",
): readonly ExpertPackageMarketplace[] {
  if (surface === "store" || surface === "expert-page") {
    return ["experts", "my-experts"];
  }
  return ["my-experts"];
}

export async function fetchExpertPackageEntries(
  marketplaces: readonly ExpertPackageMarketplace[] = ["experts", "my-experts"],
  listPackages: (
    marketplace: ExpertPackageMarketplace,
  ) => Promise<ExpertPackageListEntry[]> = listExpertPackages,
): Promise<ExpertPackageListEntry[]> {
  if (marketplaces.length === 0) return [];
  const lists = await Promise.all(
    marketplaces.map((marketplace) => listPackages(marketplace)),
  );
  const entriesByPackageName = new Map(
    lists.flat().map((entry) => [entry.packageName, entry]),
  );
  return [...entriesByPackageName.values()];
}

/** Read the shared package catalog; no window event or Directory revision needed. */
export function useExpertPackageQuery(
  enabled = true,
  marketplaces: readonly ExpertPackageMarketplace[] = ["experts", "my-experts"],
) {
  const query = useQuery<ExpertPackageListEntry[], Error>({
    queryKey: [...EXPERT_PACKAGE_QUERY_KEY, ...marketplaces],
    queryFn: () => fetchExpertPackageEntries(marketplaces),
    enabled: enabled && isElectronRuntime(),
    staleTime: 30_000,
  });
  useEffect(() => {
    if (!query.data) return;
    void reconcilePersistedMineExpertAvatars(query.data).catch((error) => {
      console.warn("[expert-package] avatar reconciliation failed", error);
    });
  }, [query.data]);
  return query;
}

/** Mark package metadata stale after an install, rewrite, or delete. */
export async function invalidateExpertPackageQuery(): Promise<void> {
  await getReactQueryClient().invalidateQueries({
    queryKey: EXPERT_PACKAGE_QUERY_KEY,
  });
}

/** Explicitly refresh active package consumers after a package mutation. */
export async function refreshExpertPackageQuery(): Promise<void> {
  await invalidateExpertPackageQuery();
}
