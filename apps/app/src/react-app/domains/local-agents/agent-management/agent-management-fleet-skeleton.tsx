/** @jsxImportSource react */
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const AGENT_CARD_GRID =
  "grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";

/** Matches collapsed AgentManagementAgentCard chrome while core snapshot loads. */
export function AgentManagementCardSkeleton() {
  return (
    <div
      className="flex min-h-[4.75rem] items-center gap-3 rounded-xl border border-dls-border bg-dls-surface px-4 py-3"
      aria-hidden
    >
      <Skeleton className="size-8 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-28 max-w-[55%]" />
          <Skeleton className="ml-auto h-4 w-12 shrink-0 rounded-full" />
        </div>
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="size-4 shrink-0 rounded-md" />
    </div>
  );
}

export function AgentManagementFleetSkeleton(props: {
  count?: number;
  className?: string;
  /** Accessible status label (section is aria-busy). */
  label: string;
  testId?: string;
}) {
  const count = props.count ?? 4;
  return (
    <div
      className={cn(AGENT_CARD_GRID, props.className)}
      role="status"
      aria-busy="true"
      aria-label={props.label}
      data-testid={props.testId ?? "agent-management-fleet-skeleton"}
    >
      <span className="sr-only">{props.label}</span>
      {Array.from({ length: count }, (_, index) => (
        <AgentManagementCardSkeleton key={index} />
      ))}
    </div>
  );
}

/** Single wide row skeleton for the extensions strip under the fleet. */
export function AgentManagementExtensionSkeleton(props: { label: string }) {
  return (
    <section className="space-y-3" aria-busy="true" aria-label={props.label}>
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="ml-auto h-8 w-16 rounded-lg" />
      </div>
      <div className="rounded-lg border border-dls-border bg-dls-surface p-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-14 rounded-full" />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="h-3 w-full max-w-md" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-5 w-14 shrink-0 rounded-full" />
        </div>
      </div>
      <span className="sr-only">{props.label}</span>
    </section>
  );
}

export { AGENT_CARD_GRID };
