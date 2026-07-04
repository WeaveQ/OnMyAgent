/** @jsxImportSource react */
import { useId } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
} from "lucide-react";

import {
  errorBannerClass,
  iconTileClass,
  softCardClass,
  surfaceCardClass,
  warningBannerClass,
} from "./modal-styles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { t } from "../../../i18n";
import type { ShareField } from "./workspace-modal-types";

const isInviteField = (label: string) => /invite link/i.test(label);
const isCollaboratorField = (label: string) =>
  /collaborator token/i.test(label);
const isPasswordField = (label: string) =>
  /owner token|connected token|access token|password/i.test(label);
const isWorkerUrlField = (label: string) => /worker url/i.test(label);

const displayFieldLabel = (field: ShareField) => {
  if (isPasswordField(field.label)) return t("workspace.share_password");
  if (isWorkerUrlField(field.label)) return t("workspace.share_worker_url");
  return field.label;
};

type CredentialFieldProps = {
  field: ShareField;
  fieldKey: string;
  copiedKey: string | null;
  revealedByKey: Record<string, boolean>;
  onCopy: (value: string, key: string) => void;
  onToggleReveal: (key: string) => void;
};

function CredentialField(props: CredentialFieldProps) {
  const isSecret = Boolean(props.field.secret);
  const revealed = Boolean(props.revealedByKey[props.fieldKey]);

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-dls-text">
        {displayFieldLabel(props.field)}
      </label>
      <div className="relative flex items-center gap-2">
        <Input
          type={isSecret && !revealed ? "password" : "text"}
          readOnly
          value={props.field.value || props.field.placeholder || ""}
          variant="dlsMono"
          controlSize="xl"
        />
        {isSecret ? (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => props.onToggleReveal(props.fieldKey)}
            disabled={!props.field.value}
            title={revealed ? t("workspace.share_hide_password") : t("workspace.share_reveal_password")}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => props.onCopy(props.field.value, props.fieldKey)}
          disabled={!props.field.value}
          title={t("common.copy")}
        >
          {props.copiedKey === props.fieldKey ? (
            <Check size={14} className="text-dls-accent" />
          ) : (
            <Copy size={14} />
          )}
        </Button>
      </div>
      {props.field.hint?.trim() ? (
        <p className="mt-1.5 text-xs text-dls-secondary">{props.field.hint}</p>
      ) : null}
    </div>
  );
}

export type ShareWorkspaceAccessPanelProps = {
  fields: ShareField[];
  copiedKey: string | null;
  onCopy: (value: string, key: string) => void;
  revealedByKey: Record<string, boolean>;
  onToggleReveal: (key: string) => void;
  collaboratorExpanded: boolean;
  onToggleCollaboratorExpanded: () => void;
  remoteAccess?: {
    enabled: boolean;
    busy: boolean;
    error?: string | null;
    status?: string | null;
    onSave: (enabled: boolean) => void | Promise<void>;
  };
  remoteAccessEnabled: boolean;
  onRemoteAccessEnabledChange: (value: boolean) => void;
  note?: string | null;
};

export function ShareWorkspaceAccessPanel(
  props: ShareWorkspaceAccessPanelProps,
) {
  const remoteAccessToggleId = useId();
  const accessFields = props.fields.filter(
    (field) => !isInviteField(field.label),
  );
  const collaboratorField =
    accessFields.find((field) => isCollaboratorField(field.label)) ?? null;
  const primaryAccessFields = accessFields.filter(
    (field) => !isCollaboratorField(field.label),
  );
  const remoteAccessNeedsEnable = Boolean(
    props.remoteAccess && !props.remoteAccess.enabled && !props.remoteAccessEnabled,
  );
  const remoteSaveDisabled = props.remoteAccess
    ? props.remoteAccess.busy ||
      (props.remoteAccess.enabled &&
        props.remoteAccessEnabled === props.remoteAccess.enabled)
    : true;
  const remoteSaveLabel = props.remoteAccess?.busy
    ? t("common.saving")
    : remoteAccessNeedsEnable
      ? t("workspace.share_enable_remote_access")
      : props.remoteAccess?.enabled === false && props.remoteAccessEnabled
        ? t("workspace.share_save_restart_worker")
        : t("common.save");

  return (
    <div className="space-y-5 pt-2 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className={warningBannerClass}>
        <span className="leading-relaxed">
          {props.remoteAccess
            ? t("workspace.share_remote_access_warning")
            : t("workspace.share_trusted_only_warning")}
        </span>
      </div>

      {props.remoteAccess ? (
        <div className={surfaceCardClass}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-medium text-dls-text">
                {t("workspace.share_remote_access_title")}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-dls-secondary">
                {t("workspace.share_remote_access_desc")}
              </p>
            </div>
            <Switch
              id={remoteAccessToggleId}
              aria-label={t("workspace.share_remote_access_title")}
              checked={props.remoteAccessEnabled}
              onCheckedChange={(checked) => props.onRemoteAccessEnabledChange(checked === true)}
              disabled={props.remoteAccess.busy}
            />
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-sm text-dls-secondary">
              {props.remoteAccess.status?.trim() ||
                (props.remoteAccess.enabled
                  ? t("workspace.remote_access_enabled")
                  : t("workspace.remote_access_disabled"))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (remoteAccessNeedsEnable) {
                  props.onRemoteAccessEnabledChange(true);
                  return;
                }
                void props.remoteAccess?.onSave(props.remoteAccessEnabled);
              }}
              disabled={remoteSaveDisabled}
            >
              {remoteSaveLabel}
            </Button>
          </div>

          {props.remoteAccess.error?.trim() ? (
            <div className={`mt-4 ${errorBannerClass}`}>
              {props.remoteAccess.error}
            </div>
          ) : null}
        </div>
      ) : null}

      {primaryAccessFields.length > 0 ? (
        <div className={surfaceCardClass}>
          <div className="mb-4 text-sm font-medium text-dls-text">
            {t("workspace.share_connection_details")}
          </div>
          <div className="space-y-4">
            {primaryAccessFields.map((field) => (
              <div key={field.label}>
                <CredentialField
                  field={field}
                  fieldKey={`primary:${field.label}`}
                  copiedKey={props.copiedKey}
                  revealedByKey={props.revealedByKey}
                  onCopy={props.onCopy}
                  onToggleReveal={props.onToggleReveal}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          className={`${softCardClass} text-sm leading-relaxed text-dls-secondary`}
        >
          {t("workspace.share_enable_remote_access_hint")}
        </div>
      )}

      {collaboratorField ? (
        <div className="pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-dls-secondary hover:text-dls-text"
            onClick={props.onToggleCollaboratorExpanded}
            aria-expanded={props.collaboratorExpanded}
          >
            <span>{t("workspace.share_optional_collaborator_access")}</span>
            <ChevronDown
              size={12}
              className={`shrink-0 transition-transform ${
                props.collaboratorExpanded ? "rotate-180" : ""
              }`}
            />
          </Button>
          {props.collaboratorExpanded ? (
            <div className={`${softCardClass} mt-3`}>
              <div className="mb-3 text-xs text-dls-secondary">
                {t("workspace.share_collaborator_access_hint")}
              </div>
              <CredentialField
                field={collaboratorField}
                fieldKey={`collaborator:${collaboratorField.label}`}
                copiedKey={props.copiedKey}
                revealedByKey={props.revealedByKey}
                onCopy={props.onCopy}
                onToggleReveal={props.onToggleReveal}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {props.note?.trim() ? (
        <div className="px-1 text-xs text-dls-secondary">{props.note}</div>
      ) : null}
    </div>
  );
}
