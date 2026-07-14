/** @jsxImportSource react */
import type { Ref } from "react";
import { Globe } from "lucide-react";

import {
  iconTileClass,
  inputHintClass,
  inputLabelClass,
  surfaceCardClass,
} from "../../design-system/modal-styles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { APP_NAME } from "../../../i18n/locales/brand";
import { t } from "../../../i18n";

export type RemoteWorkspaceFieldsProps = {
  hostUrl: string;
  onHostUrlInput: (value: string) => void;
  token: string;
  tokenVisible: boolean;
  onTokenInput: (value: string) => void;
  onToggleTokenVisible: () => void;
  displayName: string;
  onDisplayNameInput: (value: string) => void;
  directory?: string;
  onDirectoryInput?: (value: string) => void;
  showDirectory?: boolean;
  submitting?: boolean;
  hostInputRef?: Ref<HTMLInputElement>;
  title: string;
  description: string;
};

export function RemoteWorkspaceFields({
  hostUrl,
  onHostUrlInput,
  token,
  tokenVisible,
  onTokenInput,
  onToggleTokenVisible,
  displayName,
  onDisplayNameInput,
  directory,
  onDirectoryInput,
  showDirectory,
  submitting,
  hostInputRef,
  title,
  description,
}: RemoteWorkspaceFieldsProps) {
  return (
    <div className={surfaceCardClass}>
      <div className="flex items-start gap-3">
        <div className={iconTileClass}>
          <Globe size={16} />
        </div>
        <div className="min-w-0">
          <div className="text-base font-medium text-dls-text">
            {title}
          </div>
          <div className="mt-1 text-sm leading-relaxed text-dls-secondary">
            {description}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4">
        <label className="grid gap-2">
          <span className={inputLabelClass}>Worker URL</span>
          <Input
            ref={hostInputRef}
            type="url"
            value={hostUrl}
            onChange={(event) => onHostUrlInput(event.currentTarget.value)}
            placeholder="https://worker.example.com"
            disabled={submitting}
            variant="dls"
            controlSize="xl"
            radius="xl"
            density="comfortable"
          />
          <span className={inputHintClass}>
            Paste the {APP_NAME} worker URL you want to connect to.
          </span>
        </label>

        <label className="grid gap-2">
          <span className={inputLabelClass}>Access token</span>
          <InputGroup controlSize="xl" radius="xl" tone="surface">
            <InputGroupInput
              type={tokenVisible ? "text" : "password"}
              value={token}
              onChange={(event) => onTokenInput(event.currentTarget.value)}
              placeholder={t("workspace.optional_placeholder")}
              disabled={submitting}
              className="h-11 text-sm text-dls-text placeholder:text-dls-secondary"
            />
            <InputGroupButton
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-full"
              onClick={onToggleTokenVisible}
              disabled={submitting}
            >
              {tokenVisible ? "Hide" : "Show"}
            </InputGroupButton>
          </InputGroup>
          <span className={inputHintClass}>
            Add a token only if the worker requires one.
          </span>
        </label>

        {showDirectory ? (
          <label className="grid gap-2">
            <span className={inputLabelClass}>Remote directory</span>
            <Input
              type="text"
              value={directory ?? ""}
              onChange={(event) =>
                onDirectoryInput?.(event.currentTarget.value)
              }
              placeholder={t("workspace.optional_placeholder")}
              disabled={submitting}
              variant="dls"
              controlSize="xl"
              radius="xl"
              density="comfortable"
            />
            <span className={inputHintClass}>
              Optionally target a directory within that remote worker.
            </span>
          </label>
        ) : null}

        <label className="grid gap-2">
          <span className={inputLabelClass}>
            Display name{" "}
            <span className="font-normal text-dls-secondary">(optional)</span>
          </span>
          <Input
            type="text"
            value={displayName}
            onChange={(event) => onDisplayNameInput(event.currentTarget.value)}
            placeholder={t("workspace.worker_name_placeholder")}
            disabled={submitting}
            variant="dls"
            controlSize="xl"
            radius="xl"
            density="comfortable"
          />
        </label>
      </div>
    </div>
  );
}
