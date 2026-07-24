/** @jsxImportSource react */
/**
 * Lightweight AI providers list skeleton — kept outside the full AI settings
 * view so the Settings → 模型 Suspense fallback can paint without waiting on the
 * lazy tab chunk.
 */
import { Skeleton } from "@/components/ui/skeleton";

import { t } from "@/i18n";
import {
  SettingsBlock,
  SettingsBlockRow,
} from "../settings-section";
import { LayoutStack } from "../settings-layout";

const PROVIDER_SKELETON_ROWS = 3;

export function AiSettingsProvidersSkeleton(props: { rows?: number }) {
  const rows = props.rows ?? PROVIDER_SKELETON_ROWS;
  return (
    <LayoutStack>
      <div
        className="flex w-full max-w-3xl flex-col gap-3"
        aria-busy="true"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex min-w-0 flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-44 rounded-md" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Skeleton className="h-8 w-36 rounded-lg" />
            <Skeleton className="h-8 w-28 rounded-lg" />
          </div>
        </div>
        <SettingsBlock>
          {Array.from({ length: rows }, (_, index) => (
            <SettingsBlockRow
              key={index}
              title={
                <span className="inline-flex min-w-0 items-center gap-2.5">
                  <Skeleton className="size-4 shrink-0 rounded-md" />
                  <Skeleton className="h-4 w-32 rounded-md" />
                  <Skeleton className="h-5 w-10 rounded-full" />
                </span>
              }
              description={
                <span className="inline-flex items-center gap-2">
                  <Skeleton className="h-3 w-20 rounded-md" />
                  <Skeleton className="h-3 w-16 rounded-md" />
                </span>
              }
              actions={
                <div className="inline-flex items-center gap-0.5">
                  <Skeleton className="size-8 rounded-lg" />
                  <Skeleton className="size-8 rounded-lg" />
                </div>
              }
            />
          ))}
        </SettingsBlock>
        <span className="sr-only">{t("settings.loading_providers_list")}</span>
      </div>
    </LayoutStack>
  );
}
