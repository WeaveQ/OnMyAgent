/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { t } from "../../../../i18n";
import { FilterChip } from "@/components/ui/action-row";
import { EXPERT_MARKETPLACE_CATEGORIES } from "./categories";
import { BUILTIN_MARKETPLACE_EXPERTS } from "./data";
import type { ExpertMarketplaceEntry } from "./types";

export type ExpertMarketplaceView = "market" | "mine";

function agentFallbackInitial(name: string): string {
  return name.trim().slice(0, 1) || t("session.expert_initial");
}

function ExpertAvatar(props: {
  name: string;
  avatarUrl: string | null;
  size?: "sm" | "lg";
}) {
  const sizeClass = props.size === "lg" ? "size-14 rounded-full" : "size-9 rounded-full";
  if (props.avatarUrl) {
    return (
      <img
        src={props.avatarUrl}
        alt=""
        className={cn(sizeClass, "shrink-0 object-cover ring-1 ring-dls-border")}
      />
    );
  }
  return (
    <span
      className={cn(
        sizeClass,
        "inline-flex shrink-0 items-center justify-center bg-dls-accent/10 text-sm font-semibold text-dls-accent ring-1 ring-dls-accent/30",
      )}
    >
      {agentFallbackInitial(props.name)}
    </span>
  );
}

function ExpertCard(props: {
  expert: ExpertMarketplaceEntry;
  active?: boolean;
  onOpen: (expert: ExpertMarketplaceEntry) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "min-h-28 cursor-pointer rounded-xl border border-dls-border bg-dls-surface px-3.5 py-3 text-left transition-colors hover:border-dls-accent/30 hover:bg-dls-hover focus-visible:border-dls-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30 mac:titlebar-no-drag",
        props.active && "border-dls-accent/30 bg-dls-accent/10",
      )}
      onClick={() => props.onOpen(props.expert)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen(props.expert);
        }
      }}
    >
      <div className="flex min-w-0 items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <ExpertAvatar name={props.expert.displayName} avatarUrl={props.expert.avatarUrl} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-dls-text">
              {props.expert.displayName}
            </div>
            <div className="truncate text-xs leading-5 text-dls-secondary">
              {props.expert.profession}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-dls-secondary">
        {props.expert.description}
      </p>
      {props.expert.tags.length ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {props.expert.tags.slice(0, 3).map((tag) => (
            <StatusBadge key={tag} tone="surface" shape="soft" size="tiny">
              {tag}
            </StatusBadge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ExpertMarketplacePage(props: {
  view?: ExpertMarketplaceView;
  query?: string;
  myExperts: ExpertMarketplaceEntry[];
  onSummonMarketplaceExpert: (expert: ExpertMarketplaceEntry) => void;
  onCreateExpert: () => void;
  className?: string;
}) {
  const view = props.view ?? "market";
  const [categoryId, setCategoryId] = useState("all");
  const [selectedExpert, setSelectedExpert] =
    useState<ExpertMarketplaceEntry | null>(null);

  const filteredExperts = useMemo(() => {
    const normalizedQuery = (props.query ?? "").trim().toLowerCase();
    return BUILTIN_MARKETPLACE_EXPERTS.filter((expert) => {
      if (categoryId !== "all" && !expert.categoryIds.includes(categoryId)) return false;
      if (!normalizedQuery) return true;
      const text = [
        expert.displayName,
        expert.profession,
        expert.description,
        expert.categoryLabel,
        ...expert.categoryLabels,
        ...expert.tags,
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(normalizedQuery);
    });
  }, [categoryId, props.query]);

  return (
    <>
      <div
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden bg-dls-background",
          props.className,
        )}
      >
        {view === "market" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto px-6 py-2.5">
              {EXPERT_MARKETPLACE_CATEGORIES.map((category) => {
                const active = categoryId === category.id;
                return (
                  <FilterChip
                    key={category.id}
                    label={t(category.labelKey)}
                    selected={active}
                    onClick={() => setCategoryId(category.id)}
                    className="mac:titlebar-no-drag"
                  />
                );
              })}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {filteredExperts.map((expert) => (
                  <ExpertCard
                    key={expert.id}
                    expert={expert}
                    active={selectedExpert?.id === expert.id}
                    onOpen={setSelectedExpert}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              <button
                type="button"
                className="min-h-28 rounded-xl border border-dashed border-dls-border-strong bg-dls-surface px-3.5 py-3 text-left transition-colors hover:border-dls-accent/30 hover:bg-dls-hover mac:titlebar-no-drag"
                onClick={props.onCreateExpert}
              >
                <span className="inline-flex size-9 items-center justify-center rounded-full bg-dls-accent/10 text-dls-accent ring-1 ring-dls-accent/30">
                  <Plus className="size-4" />
                </span>
                <div className="mt-3 text-sm font-semibold text-dls-text">
                  {t("session.create_expert")}
                </div>
                <div className="mt-1 text-xs leading-5 text-dls-secondary">
                  {t("session.create_expert_desc")}
                </div>
              </button>
              {props.myExperts.map((expert) => (
                <ExpertCard
                  key={expert.id}
                  expert={expert}
                  active={selectedExpert?.id === expert.id}
                  onOpen={setSelectedExpert}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={Boolean(selectedExpert)}
        onOpenChange={(open) => {
          if (!open) setSelectedExpert(null);
        }}
      >
        <DialogContent className="!max-w-[520px] rounded-xl bg-dls-surface p-5">
          {selectedExpert ? (
            <div>
              <div className="flex items-start gap-4 pr-8">
                <ExpertAvatar
                  name={selectedExpert.displayName}
                  avatarUrl={selectedExpert.avatarUrl}
                  size="lg"
                />
                <div className="min-w-0">
                  <div className="text-lg font-medium leading-7 text-dls-text">
                    {selectedExpert.displayName}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <StatusBadge tone="surface" shape="soft" size="tiny">
                      {selectedExpert.profession}
                    </StatusBadge>
                    <StatusBadge tone="surface" shape="soft" size="tiny">
                      {selectedExpert.categoryLabel}
                    </StatusBadge>
                  </div>
                </div>
              </div>
              <div className="mt-6 text-sm font-medium text-dls-secondary">
                {t("session.expert_capability")}
              </div>
              <p className="mt-2 text-sm leading-7 text-dls-text">
                {selectedExpert.description}
              </p>
              {selectedExpert.tags.length ? (
                <>
                  <div className="mt-5 text-sm font-medium text-dls-secondary">
                    {t("session.expert_strengths")}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedExpert.tags.map((tag) => (
                      <StatusBadge key={tag} tone="surface" shape="soft" size="sm">
                        {tag}
                      </StatusBadge>
                    ))}
                  </div>
                </>
              ) : null}
              {selectedExpert.quickPrompts.length ? (
                <>
                  <div className="mt-5 text-sm font-medium text-dls-secondary">
                    {t("session.try_ask_expert")}
                  </div>
                  <div className="mt-2 space-y-2">
                    {selectedExpert.quickPrompts.slice(0, 3).map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-xl border border-dls-border bg-dls-surface-muted px-4 py-3 text-left text-sm leading-6 text-dls-secondary transition-colors hover:border-dls-accent/30 hover:bg-dls-hover mac:titlebar-no-drag"
                      >
                        <span>{prompt}</span>
                        <ChevronRight className="size-4 shrink-0" />
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <Button
                type="button"
                size="lg"
                className="mt-8 w-full"
                onClick={() => {
                  props.onSummonMarketplaceExpert(selectedExpert);
                  setSelectedExpert(null);
                }}
              >
                {t("session.summon_expert", {
                  name: selectedExpert.displayName,
                })}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ExpertMarketplaceDialog(props: {
  open: boolean;
  myExperts: ExpertMarketplaceEntry[];
  onOpenChange: (open: boolean) => void;
  onSummonMarketplaceExpert: (expert: ExpertMarketplaceEntry) => void;
  onCreateExpert: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className="flex h-[min(820px,calc(100vh-72px))] !w-[min(1180px,calc(100vw-96px))] !max-w-[min(1180px,calc(100vw-96px))] flex-col gap-0 overflow-hidden rounded-xl bg-dls-background p-0 sm:!max-w-[min(1180px,calc(100vw-96px))]"
        showCloseButton={false}
      >
        <ExpertMarketplacePage
          myExperts={props.myExperts}
          onSummonMarketplaceExpert={props.onSummonMarketplaceExpert}
          onCreateExpert={props.onCreateExpert}
        />
      </DialogContent>
    </Dialog>
  );
}
