import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import { Building2, Check, LogOut, Loader2 } from "lucide-react";

import type { DenOrgSummary } from "../../../../app/lib/den";
import { ActionRowButton, IconTile } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import {
  SettingsNotice,
  SettingsActionRow,
  SettingsSectionHeaderDescription,
} from "../settings-section";
import { SettingsListEmptyState } from "../settings-list";
import { t } from "@/i18n";
import { useCloudSession } from "./cloud-session-provider";

export interface CloudAccountSectionProps {
  activeOrgId: string;
  authBusy: boolean;
  needsOrgSelection?: boolean;
  orgs: DenOrgSummary[];
  orgsBusy: boolean;
  orgsError: string | null;
  sessionBusy: boolean;
  onActiveOrgChange: (orgId: string) => void | Promise<void>;
  onRefreshOrgs: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
}

export function CloudAccountSection({
  activeOrgId,
  authBusy,
  needsOrgSelection,
  orgs,
  orgsBusy,
  orgsError,
  sessionBusy,
  onActiveOrgChange,
  onRefreshOrgs,
  onSignOut,
}: CloudAccountSectionProps) {
  const { user } = useCloudSession();
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? null;
  const controlsDisabled = authBusy || sessionBusy;

  return (
    <section className="flex flex-col gap-y-6">
      {/* User identity */}
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-dls-hover text-sm font-medium text-dls-text">
            {(user?.name ?? user?.email ?? "?").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-dls-text">
              {user?.name || user?.email}
            </div>
            {user?.name && user.email ? (
              <div className="truncate text-xs text-dls-secondary">{user.email}</div>
            ) : null}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => void onSignOut()}
          disabled={controlsDisabled}
        >
          <LogOut className="size-3.5" />
          {authBusy ? t("den.signing_out") : t("den.sign_out")}
        </Button>
      </div>

      {/* Org picker (stepper-style) or connected org display */}
      {needsOrgSelection ? (
        <OrgPicker
          orgs={orgs}
          orgsBusy={orgsBusy}
          disabled={controlsDisabled}
          onSelect={onActiveOrgChange}
          onRefresh={onRefreshOrgs}
        />
      ) : activeOrg ? (
        <ConnectedOrg org={activeOrg} />
      ) : orgsBusy ? (
        <div className="flex items-center gap-2 text-sm text-dls-secondary">
          <LoadingSpinner size="sm" />
          Loading organizations...
        </div>
      ) : null}

      {orgsError ? <SettingsNotice tone="error">{orgsError}</SettingsNotice> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Connected org: read-only display                                   */
/* ------------------------------------------------------------------ */

function ConnectedOrg({ org }: { org: DenOrgSummary }) {
  return (
    <SettingsActionRow className="justify-start px-4 py-3">
      <IconTile tone="softAccent" shape="lg">
        <Building2 size={16} />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-dls-text">{org.name}</div>
        <div className="text-xs text-dls-secondary">
          {org.role === "owner" ? "Owner" : "Member"} &middot; Connected
        </div>
      </div>
      <Check size={16} className="shrink-0 text-dls-accent" />
    </SettingsActionRow>
  );
}

/* ------------------------------------------------------------------ */
/*  Org picker: card-per-org selection                                 */
/* ------------------------------------------------------------------ */

function OrgPicker({
  orgs,
  orgsBusy,
  disabled,
  onSelect,
  onRefresh,
}: {
  orgs: DenOrgSummary[];
  orgsBusy: boolean;
  disabled: boolean;
  onSelect: (orgId: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  if (orgsBusy) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-sm text-dls-secondary">
        <LoadingSpinner size="default" />
        Loading your organizations...
      </div>
    );
  }

  if (orgs.length === 0) {
    return (
      <SettingsListEmptyState>
        No organizations found.{" "}
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto px-0 align-baseline font-medium text-dls-text underline-offset-2"
          onClick={() => void onRefresh()}
        >
          Refresh
        </Button>
      </SettingsListEmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium text-dls-text">
        Select an organization
      </div>
      <div className="text-xs text-dls-secondary">
        Choose the organization to use with this workspace. Sign out to switch later.
      </div>
      <div className="flex flex-col gap-2">
        {orgs.map((org) => (
          <ActionRowButton
            key={org.id}
            type="button"
            disabled={disabled}
            density="row"
            className="items-center gap-3 hover:border-dls-text/20"
            onClick={() => void onSelect(org.id)}
          >
            <IconTile tone="neutral" shape="lg">
              <Building2 size={16} />
            </IconTile>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-dls-text">{org.name}</div>
              <div className="text-xs text-dls-secondary">
                {org.role === "owner" ? "Owner" : "Member"}
              </div>
            </div>
          </ActionRowButton>
        ))}
      </div>
    </div>
  );
}
