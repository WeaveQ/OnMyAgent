import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import { useMemo } from "react";
import { Boxes, Cloud, Loader2, RefreshCcw, Search } from "lucide-react";

import type { DenOrgSummary, DenWorkerSummary } from "../../../app/lib/den";
import {
  errorBannerClass,
  iconTileClass,
  modalBodyClass,
  sectionBodyClass,
  sectionTitleClass,
  surfaceCardClass,
} from "../shared/modal-styles";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/action-row";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/status-badge";
import { StatusDot } from "@/components/ui/status-dot";
import { SelectMenu } from "../../design-system/select-menu";
import { APP_NAME } from "../../../i18n/locales/brand";
import { t } from "../../../i18n";

type WorkerStatusMeta = {
  label: string;
  tone: "ready" | "warning" | "neutral" | "error";
  canOpen: boolean;
};

const workerStatusBadgeTone = (tone: WorkerStatusMeta["tone"]): StatusBadgeTone => {
  switch (tone) {
    case "ready":
      return "success";
    case "warning":
      return "warning";
    case "error":
      return "danger";
    default:
      return "neutral";
  }
};

export type CreateWorkspaceSharedPanelProps = {
  signedIn: boolean;
  orgs: DenOrgSummary[];
  activeOrgId: string;
  onActiveOrgChange: (orgId: string) => void;
  orgsBusy: boolean;
  orgsError: string | null;
  workers: DenWorkerSummary[];
  workersBusy: boolean;
  workersError: string | null;
  workerSearch: string;
  onWorkerSearchInput: (value: string) => void;
  filteredWorkers: DenWorkerSummary[];
  openingWorkerId: string | null;
  workerStatusMeta: (status: string) => WorkerStatusMeta;
  workerSecondaryLine: (worker: DenWorkerSummary) => string;
  onOnMyAgenter: (worker: DenWorkerSummary) => void;
  onOpenCloudSignIn: () => void;
  onRefreshWorkers: () => void;
  onOpenCloudDashboard: () => void;
};

export function CreateWorkspaceSharedPanel(
  props: CreateWorkspaceSharedPanelProps,
) {
  const activeOrg = useMemo(
    () => props.orgs.find((org) => org.id === props.activeOrgId) ?? null,
    [props.activeOrgId, props.orgs],
  );

  if (!props.signedIn) {
    return (
      <div className={modalBodyClass}>
        <div className="flex min-h-[320px] items-center justify-center">
          <div
            className={`${surfaceCardClass} w-full max-w-[420px] p-8 text-center`}
          >
            <IconTile className="mx-auto size-14 text-dls-text" size="lg" shape="xl" border>
              <Cloud size={24} />
            </IconTile>
            <div className="mt-5 text-lg font-medium text-dls-text">
              Sign in to {APP_NAME} Cloud
            </div>
            <div className="mt-2 text-sm leading-6 text-dls-secondary">
              Access remote workers shared with your organization.
            </div>
            <div className="mt-6 flex justify-center">
              <Button
                type="button"
                size="sm"
                onClick={props.onOpenCloudSignIn}
              >
                Continue with Cloud
              </Button>
            </div>
            <div className="mt-3 text-xs text-dls-secondary">
              You’ll pick a team and connect to an existing workspace next.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={modalBodyClass}>
      <div className="space-y-4">
        <div className={surfaceCardClass}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className={sectionTitleClass}>Shared workspaces</div>
              <div className={sectionBodyClass}>
                Choose your organization, then connect to a cloud worker in one
                step.
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <SelectMenu
                ariaLabel="Organization"
                size="compact"
                options={props.orgs.map((org) => ({ value: org.id, label: org.name }))}
                value={props.activeOrgId}
                onChange={props.onActiveOrgChange}
                disabled={props.orgsBusy || props.orgs.length === 0}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={props.onRefreshWorkers}
                disabled={props.workersBusy || !props.activeOrgId.trim()}
                title={activeOrg?.name ?? undefined}
              >
                <RefreshCcw
                  size={12}
                  className={props.workersBusy ? "animate-spin" : ""}
                />
                Refresh
              </Button>
            </div>
          </div>

          <div className="mt-4">
            <InputGroup controlSize="xl" radius="xl" tone="surface">
              <InputGroupAddon align="inline-start" inset="comfortable">
                <Search size={14} />
              </InputGroupAddon>
              <InputGroupInput
                type="text"
                value={props.workerSearch}
                onChange={(event) =>
                  props.onWorkerSearchInput(event.currentTarget.value)
                }
                placeholder={t("workspace.shared_search_placeholder")}
                className="text-sm text-dls-text placeholder:text-dls-secondary"
              />
            </InputGroup>
          </div>
        </div>

        {props.orgsError ? (
          <div className={errorBannerClass}>{props.orgsError}</div>
        ) : null}
        {props.workersError ? (
          <div className={errorBannerClass}>{props.workersError}</div>
        ) : null}

        {props.workersBusy && props.workers.length === 0 ? (
          <div className={`${surfaceCardClass} text-sm text-dls-secondary`}>
            Loading shared workspaces…
          </div>
        ) : null}

        {!props.workersBusy && props.filteredWorkers.length === 0 ? (
          <div className={`${surfaceCardClass} text-sm text-dls-secondary`}>
            {props.workerSearch.trim()
              ? "No shared workspaces match that search."
              : "No shared workspaces available yet."}
          </div>
        ) : null}

        <div className="space-y-3">
          {props.filteredWorkers.map((worker) => {
            const status = props.workerStatusMeta(worker.status);
            const isConnecting = props.openingWorkerId === worker.workerId;
            return (
              <div
                key={worker.workerId}
                className={`${surfaceCardClass} transition-all duration-150 hover:border-dls-border`}
              >
                <div className="flex items-center gap-4">
                  <div className={iconTileClass}>
                    <Boxes size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-sm font-medium text-dls-text">
                        {worker.workerName}
                      </div>
                      <StatusBadge className="gap-1" size="tiny" tone={workerStatusBadgeTone(status.tone)}>
                        <StatusDot tone="current" className="opacity-80" />
                        {status.label}
                      </StatusBadge>
                    </div>
                    <div className="mt-1 truncate text-xs text-dls-secondary">
                      {props.workerSecondaryLine(worker)}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={props.openingWorkerId !== null || !status.canOpen}
                    title={
                      !status.canOpen
                        ? "This workspace is not ready to connect yet."
                        : undefined
                    }
                    onClick={() => props.onOnMyAgenter(worker)}
                  >
                    {isConnecting ? (
                      <span className="inline-flex items-center gap-2">
                        <LoadingSpinner size="sm" />
                        Connecting
                      </span>
                    ) : (
                      "Connect"
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {props.workersBusy && props.workers.length > 0 ? (
          <div className="text-xs text-dls-secondary">
            Refreshing workspaces…
          </div>
        ) : null}

        <div className="pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-dls-secondary hover:text-dls-text"
            onClick={props.onOpenCloudDashboard}
          >
            Open cloud dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
