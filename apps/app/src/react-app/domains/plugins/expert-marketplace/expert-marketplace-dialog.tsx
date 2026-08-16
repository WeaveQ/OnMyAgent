/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { MARKETPLACE_CARD_GRID } from "@/components/ui/skill-marketplace-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { desktopBridge } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "../../../../i18n";
import { FilterChip } from "@/components/ui/action-row";
import { EXPERT_MARKETPLACE_CATEGORIES } from "./categories";
import { BUILTIN_MARKETPLACE_EXPERTS, filterLocalShelfExperts } from "./data";
import type { ExpertMarketplaceEntry, ExpertMarketplaceSummonHandler } from "./types";

export type ExpertMarketplaceView = "market" | "mine" | "company";

// DESIGN.md motion.duration.normal: let the dialog finish its exit animation
// before the marketplace page becomes keepalive-hidden.
const MARKETPLACE_DIALOG_EXIT_DURATION_MS = 200;

function agentFallbackInitial(name: string): string {
  return name.trim().slice(0, 1) || t("session.expert_initial");
}

function ExpertAvatar(props: { name: string; avatarUrl: string | null; size?: "sm" | "lg" }) {
  // Match skills marketplace icons: rounded-md (not circle).
  const sizeClass = props.size === "lg" ? "size-14 rounded-md" : "size-9 rounded-md";
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

/** Market shelf — up to 5 cols on wide screens. */
const EXPERT_MARKET_CARD_GRID = cn(MARKETPLACE_CARD_GRID, "auto-rows-fr");

/**
 * "Experts I created" shelf — cap at 3 cols so 1–2 cards don't look stranded
 * on a 5-column market track with a huge empty right side.
 */
const EXPERT_MINE_CARD_GRID =
  "grid grid-cols-1 auto-rows-fr items-stretch gap-2.5 sm:grid-cols-2 xl:grid-cols-3";

/** Match builtin market cards to local installed/mine packages by packageName. */
export function isAlreadySummonedExpert(
  expert: Pick<ExpertMarketplaceEntry, "id" | "packageName">,
  shelfExperts: readonly Pick<ExpertMarketplaceEntry, "id" | "packageName">[],
): boolean {
  const pkg = expert.packageName?.trim();
  if (!pkg) {
    return shelfExperts.some((item) => item.id === expert.id);
  }
  return shelfExperts.some((item) => item.packageName?.trim() === pkg || item.id === expert.id);
}

function ExpertCard(props: {
  expert: ExpertMarketplaceEntry;
  active?: boolean;
  /**
   * Mine / already summoned → “去聊天”; market not summoned → “召唤”.
   * Both CTAs only reveal on card hover / focus (keeps the grid clean).
   */
  shelf?: "market" | "mine";
  /** Market only: package already on the local shelf — show open-chat, not re-summon. */
  alreadySummoned?: boolean;
  onOpen: (expert: ExpertMarketplaceEntry) => void;
  onSummon: (expert: ExpertMarketplaceEntry) => void;
}) {
  const isMine = props.shelf === "mine";
  const openChatCta = isMine || Boolean(props.alreadySummoned);
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group flex h-full min-h-[8.5rem] cursor-pointer select-none flex-col rounded-2xl border border-transparent bg-dls-surface px-4 py-3.5 text-left transition-colors hover:border-dls-border hover:bg-dls-hover focus-visible:border-dls-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30 mac:titlebar-no-drag",
        props.active && "border-dls-border bg-dls-accent/10",
      )}
      onClick={() => props.onOpen(props.expert)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen(props.expert);
        }
      }}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <ExpertAvatar name={props.expert.displayName} avatarUrl={props.expert.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-5 text-dls-text">
                {props.expert.displayName}
              </div>
              {props.expert.profession.trim() ? (
                <div className="mt-0.5 truncate text-xs leading-5 text-dls-secondary">
                  {props.expert.profession}
                </div>
              ) : null}
            </div>
            <Button
              type="button"
              variant={openChatCta ? "outline" : "default"}
              size="xs"
              tabIndex={-1}
              className={cn(
                "pointer-events-none shrink-0 opacity-0 shadow-none transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
                openChatCta
                  ? "border-dls-border bg-dls-surface text-dls-text hover:bg-dls-hover hover:text-dls-text"
                  : "border-transparent bg-dls-decision text-white hover:bg-dls-decision-hover hover:text-white",
              )}
              onClick={(event) => {
                event.stopPropagation();
                props.onSummon(props.expert);
              }}
            >
              {openChatCta ? t("session.open_chat") : t("session.summon")}
            </Button>
          </div>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 flex-1 text-xs leading-5 text-dls-secondary">
        {props.expert.description}
      </p>
      {props.expert.tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
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
  /**
   * Agent ids from the expert sidebar (session groups). Used to filter
   * installed packages down to ones the user has actually opened/summoned.
   */
  activeExpertAgentIds?: readonly string[];
  onSummonMarketplaceExpert: ExpertMarketplaceSummonHandler;
  onCreateExpert: () => void;
  className?: string;
}) {
  const view = props.view ?? "market";
  const [categoryId, setCategoryId] = useState("all");
  const [selectedExpert, setSelectedExpert] = useState<ExpertMarketplaceEntry | null>(null);
  const [companyExperts, setCompanyExperts] = useState<Array<{ id: string; name: string }>>([]);
  const [companyHint, setCompanyHint] = useState<string | null>(null);
  const [companyConnected, setCompanyConnected] = useState(false);

  useEffect(() => {
    if (view !== "company") return undefined;
    if (!isDesktopRuntime()) {
      setCompanyConnected(false);
      setCompanyExperts([]);
      setCompanyHint(t("store.company_experts_desktop_only"));
      return undefined;
    }
    let cancelled = false;
    void desktopBridge
      .companyCatalog()
      .then((raw) => {
        if (cancelled) return;
        const catalog = raw as {
          connected?: boolean;
          email?: string;
          experts?: Array<{ id: string; name: string }>;
        };
        setCompanyConnected(Boolean(catalog?.connected));
        setCompanyExperts(Array.isArray(catalog?.experts) ? catalog.experts : []);
        setCompanyHint(
          catalog?.connected
            ? catalog.email
              ? t("store.company_connected_member", { email: catalog.email })
              : t("store.company_connected_short")
            : t("store.company_not_connected_settings_hint"),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setCompanyConnected(false);
          setCompanyExperts([]);
          setCompanyHint(t("store.company_catalog_read_failed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [view]);

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

  // Local shelf ("已召唤专家"): self-created + installed packages that match
  // sidebar session agents — not every pre-seeded package under experts/installed.
  const shelfExperts = useMemo(
    () => filterLocalShelfExperts(props.myExperts, props.activeExpertAgentIds),
    [props.activeExpertAgentIds, props.myExperts],
  );

  if (view === "company") {
    const q = (props.query ?? "").trim().toLowerCase();
    const rows = !q
      ? companyExperts
      : companyExperts.filter((e) => `${e.name} ${e.id}`.toLowerCase().includes(q));
    return (
      <div
        className={cn(
          "flex h-full min-h-0 select-none flex-col bg-dls-background",
          props.className,
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
          {companyHint ? <p className="mb-3 text-xs text-dls-secondary">{companyHint}</p> : null}
          {rows.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((expert) => (
                <div
                  key={expert.id}
                  className="rounded-2xl border border-dls-border bg-dls-surface px-4 py-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-dls-text">
                        {expert.name}
                      </div>
                      <p className="mt-1 text-xs text-dls-secondary">
                        {t("store.company_org_readonly")}
                      </p>
                    </div>
                    <StatusBadge tone="surface" shape="soft" size="tiny">
                      {t("store.company_org_badge")}
                    </StatusBadge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-dls-secondary">
              <p className="text-base font-medium text-dls-text">
                {t("store.company_experts_title")}
              </p>
              <p>
                {companyConnected
                  ? t("store.company_no_experts_omc")
                  : (companyHint ?? t("store.company_not_connected_short"))}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "flex h-full min-h-0 select-none flex-col overflow-hidden bg-dls-background",
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
              <div className={EXPERT_MARKET_CARD_GRID}>
                {filteredExperts.map((expert) => (
                  <ExpertCard
                    key={expert.id}
                    expert={expert}
                    shelf="market"
                    alreadySummoned={isAlreadySummonedExpert(expert, shelfExperts)}
                    active={selectedExpert?.id === expert.id}
                    onOpen={setSelectedExpert}
                    onSummon={props.onSummonMarketplaceExpert}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Same rhythm as skills installed: tight top, no second page title. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
              {shelfExperts.length === 0 ? (
                <div className="flex min-h-[min(22rem,60vh)] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-dls-border/80 bg-dls-surface/60 px-6 py-10 text-center">
                  <p className="text-sm font-medium text-dls-text">
                    {t("session.my_experts_empty_title")}
                  </p>
                  <p className="max-w-sm text-xs leading-5 text-dls-secondary">
                    {t("session.my_experts_empty_desc")}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1 gap-1.5 text-dls-text"
                    onClick={props.onCreateExpert}
                  >
                    {t("session.create_expert")}
                  </Button>
                </div>
              ) : (
                <div className={EXPERT_MINE_CARD_GRID}>
                  {shelfExperts.map((expert) => (
                    <ExpertCard
                      key={expert.id}
                      expert={expert}
                      shelf="mine"
                      active={selectedExpert?.id === expert.id}
                      onOpen={setSelectedExpert}
                      onSummon={props.onSummonMarketplaceExpert}
                    />
                  ))}
                </div>
              )}
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
        <DialogContent className="max-h-[calc(100vh-48px)] !max-w-[520px] overflow-y-auto rounded-xl bg-dls-surface p-5">
          {selectedExpert
            ? (() => {
                // Mine shelf or market card already installed → open chat, not re-summon.
                const selectedIsMine =
                  view === "mine" || isAlreadySummonedExpert(selectedExpert, shelfExperts);
                return (
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
                          {selectedExpert.quickPrompts.slice(0, 2).map((prompt) => (
                            <button
                              key={prompt}
                              type="button"
                              className="flex w-full items-center justify-between gap-3 rounded-xl border border-dls-border bg-dls-surface-muted px-4 py-3 text-left text-sm leading-6 text-dls-secondary transition-colors hover:border-dls-accent/30 hover:bg-dls-hover mac:titlebar-no-drag"
                              onClick={() => {
                                setSelectedExpert(null);
                                window.setTimeout(() => {
                                  props.onSummonMarketplaceExpert(selectedExpert, prompt);
                                }, MARKETPLACE_DIALOG_EXIT_DURATION_MS);
                              }}
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
                        setSelectedExpert(null);
                        window.setTimeout(() => {
                          props.onSummonMarketplaceExpert(selectedExpert);
                        }, MARKETPLACE_DIALOG_EXIT_DURATION_MS);
                      }}
                    >
                      {selectedIsMine
                        ? t("session.open_chat_with", {
                            name: selectedExpert.displayName,
                          })
                        : t("session.summon_expert", {
                            name: selectedExpert.displayName,
                          })}
                    </Button>
                  </div>
                );
              })()
            : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ExpertMarketplaceDialog(props: {
  open: boolean;
  myExperts: ExpertMarketplaceEntry[];
  onOpenChange: (open: boolean) => void;
  onSummonMarketplaceExpert: ExpertMarketplaceSummonHandler;
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
