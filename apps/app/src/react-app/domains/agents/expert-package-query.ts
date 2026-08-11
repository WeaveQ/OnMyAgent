/** Reactive owner for locally installed Expert package metadata. */
import { useQuery } from "@tanstack/react-query";

import { listExpertPackages } from "../../../app/lib/desktop";
import type { ExpertPackageListEntry } from "../../../app/lib/desktop";
import { isElectronRuntime } from "../../../app/utils";
import { getReactQueryClient } from "../../infra/query-client";

export const EXPERT_PACKAGE_QUERY_KEY = ["expert-packages", "local"] as const;

async function fetchExpertPackageEntries(): Promise<ExpertPackageListEntry[]> {
  const [installedEntries, mineEntries] = await Promise.all([
    listExpertPackages("experts"),
    listExpertPackages("my-experts"),
  ]);
  const entriesByPackageName = new Map(
    [...installedEntries, ...mineEntries].map((entry) => [
      entry.packageName,
      entry,
    ]),
  );
  return [...entriesByPackageName.values()];
}

/** Read the shared package catalog; no window event or Directory revision needed. */
export function useExpertPackageQuery(enabled = true) {
  return useQuery<ExpertPackageListEntry[], Error>({
    queryKey: EXPERT_PACKAGE_QUERY_KEY,
    queryFn: fetchExpertPackageEntries,
    enabled: enabled && isElectronRuntime(),
    staleTime: 30_000,
  });
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
