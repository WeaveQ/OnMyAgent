/** @jsxImportSource react */
import * as React from "react";
import { FolderPlus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { NoticeBox } from "@/components/ui/notice-box";
import { cn } from "@/lib/utils";

import { t } from "../../../i18n";
import { pickDirectory } from "../../../app/lib/desktop";
import { addKnowledgeVault, removeKnowledgeVault } from "../../../app/lib/desktop-knowledge";
import { ConfirmModal } from "../../design-system/modals/confirm-modal";
import type { KnowledgeVaultScope } from "./knowledge-vault-model";

export type KnowledgeVaultItem = {
  name: string;
  path: string;
  isDefault: boolean;
};

export type KnowledgeVaultSelection = {
  scope: KnowledgeVaultScope;
  vaultPath?: string | null;
};

export type KnowledgeVaultGroupsProps = {
  active: KnowledgeVaultSelection;
  userVaults: readonly KnowledgeVaultItem[];
  projectUnavailable?: boolean;
  expertUnavailable?: boolean;
  onSelect: (selection: KnowledgeVaultSelection) => void;
  onChanged: () => void;
};

type AddState = {
  open: boolean;
  name: string;
  folderPath: string;
  busy: boolean;
  error: string | null;
};

const INITIAL_ADD_STATE: AddState = {
  open: false,
  name: "",
  folderPath: "",
  busy: false,
  error: null,
};

export function KnowledgeVaultGroups(props: KnowledgeVaultGroupsProps) {
  const [add, setAdd] = React.useState<AddState>(INITIAL_ADD_STATE);
  const [removing, setRemoving] = React.useState<KnowledgeVaultItem | null>(null);
  const extraUserVaults = props.userVaults.filter((vault) => !vault.isDefault);

  const chooseFolder = async () => {
    const picked = await pickDirectory({ title: t("knowledge.add_vault_title") });
    const next = Array.isArray(picked) ? picked[0] : picked;
    if (!next) return;
    setAdd((prev) => ({
      ...prev,
      folderPath: next,
      name: prev.name.trim() ? prev.name : next.split(/[\\/]/).filter(Boolean).pop() ?? "",
      error: null,
    }));
  };

  const submitAdd = async () => {
    const folderPath = add.folderPath.trim();
    if (!folderPath) {
      setAdd((prev) => ({ ...prev, error: t("knowledge.add_vault_folder_required") }));
      return;
    }
    setAdd((prev) => ({ ...prev, busy: true, error: null }));
    const result = await addKnowledgeVault({
      name: add.name.trim(),
      path: folderPath,
    });
    setAdd((prev) => ({ ...prev, busy: false }));
    if (result?.ok) {
      setAdd(INITIAL_ADD_STATE);
      props.onChanged();
    } else {
      setAdd((prev) => ({
        ...prev,
        error: t("knowledge.add_vault_failed"),
      }));
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    const target = removing.path;
    setRemoving(null);
    const result = await removeKnowledgeVault({ path: target });
    if (result?.ok) {
      if (props.active.scope === "user" && props.active.vaultPath === target) {
        props.onSelect({ scope: "user", vaultPath: null });
      }
      props.onChanged();
    }
  };

  return (
    <div className="space-y-0.5">
      <ScopeRow
        label={t("knowledge.group_my_vaults")}
        active={props.active.scope === "user" && !props.active.vaultPath}
        onSelect={() => props.onSelect({ scope: "user", vaultPath: null })}
        action={
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
            aria-label={t("knowledge.add_vault")}
            onClick={(event) => {
              event.stopPropagation();
              setAdd({ ...INITIAL_ADD_STATE, open: true });
            }}
          >
            <FolderPlus className="size-3.5" />
          </Button>
        }
      />
      {extraUserVaults.map((vault) => (
        <VaultRow
          key={vault.path}
          name={vault.name}
          nested
          active={props.active.scope === "user" && props.active.vaultPath === vault.path}
          onSelect={() => props.onSelect({ scope: "user", vaultPath: vault.path })}
          onRemove={() => setRemoving(vault)}
        />
      ))}
      <ScopeRow
        label={t("knowledge.group_project")}
        active={props.active.scope === "project" && !props.projectUnavailable}
        dimmed={props.projectUnavailable}
        trailingHint={
          props.projectUnavailable ? t("knowledge.scope_unavailable") : null
        }
        onSelect={
          props.projectUnavailable ? undefined : () => props.onSelect({ scope: "project" })
        }
      />
      <ScopeRow
        label={t("knowledge.group_expert")}
        active={props.active.scope === "expert" && !props.expertUnavailable}
        dimmed={props.expertUnavailable}
        trailingHint={
          props.expertUnavailable ? t("knowledge.scope_unavailable") : null
        }
        onSelect={
          props.expertUnavailable ? undefined : () => props.onSelect({ scope: "expert" })
        }
      />

      <Dialog
        open={add.open}
        onOpenChange={(open: boolean) => {
          if (!add.busy) setAdd((prev) => ({ ...prev, open }));
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("knowledge.add_vault_title")}</DialogTitle>
            <DialogDescription>
              {t("knowledge.authorized_hint")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field>
              <FieldLabel htmlFor="add-vault-name">
                {t("knowledge.add_vault_name_label")}
              </FieldLabel>
              <Input
                id="add-vault-name"
                value={add.name}
                placeholder={t("knowledge.add_vault_name_placeholder")}
                onChange={(event) =>
                  setAdd((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-vault-folder">
                {t("knowledge.add_vault_folder_label")}
              </FieldLabel>
              <InputGroup controlSize="lg" radius="lg" className="w-full">
                <InputGroupInput
                  id="add-vault-folder"
                  readOnly
                  value={add.folderPath}
                  placeholder={t("knowledge.add_vault_folder_placeholder")}
                  onClick={() => void chooseFolder()}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void chooseFolder()}
                  >
                    {t("knowledge.add_vault_choose")}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
            {add.error ? <NoticeBox tone="error">{add.error}</NoticeBox> : null}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="lg" />}>
              {t("common.cancel")}
            </DialogClose>
            <Button
              type="button"
              size="lg"
              disabled={add.busy}
              onClick={() => void submitAdd()}
            >
              {add.busy ? <LoadingSpinner size="sm" /> : null}
              {t("knowledge.add_vault_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={removing !== null}
        variant="danger"
        title={t("knowledge.remove_vault_title")}
        message={t("knowledge.remove_vault_body", {
          name: removing?.name ?? "",
        })}
        confirmLabel={t("knowledge.remove_vault_confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function ScopeRow(props: {
  label: string;
  active: boolean;
  dimmed?: boolean;
  trailingHint?: string | null;
  action?: React.ReactNode;
  onSelect?: () => void;
}) {
  return (
    <div
      role={props.onSelect ? "button" : undefined}
      tabIndex={props.onSelect ? 0 : undefined}
      onClick={props.onSelect}
      onKeyDown={(event) => {
        if (!props.onSelect) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect();
        }
      }}
      className={cn(
        "group flex h-[34px] min-h-[34px] max-h-[34px] items-center gap-1.5 rounded-md px-2 text-sm outline-none",
        props.onSelect && "cursor-pointer hover:bg-dls-list-hover focus-visible:ring-1 focus-visible:ring-dls-focus",
        props.active && "bg-dls-list-selected font-medium text-dls-text",
        props.dimmed && "cursor-default opacity-60 hover:bg-transparent",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.trailingHint ? (
        <span className="shrink-0 text-xs font-normal text-dls-secondary">
          {props.trailingHint}
        </span>
      ) : null}
      {props.action}
    </div>
  );
}

function VaultRow(props: {
  name: string;
  active: boolean;
  nested?: boolean;
  onSelect?: () => void;
  onRemove?: () => void;
  dimmed?: boolean;
  trailingHint?: string | null;
}) {
  return (
    <div
      role={props.onSelect ? "button" : undefined}
      tabIndex={props.onSelect ? 0 : undefined}
      onClick={props.onSelect}
      onKeyDown={(event) => {
        if (!props.onSelect) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect();
        }
      }}
      className={cn(
        "group flex h-[34px] min-h-[34px] max-h-[34px] cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm outline-none",
        "hover:bg-dls-list-hover focus-visible:ring-1 focus-visible:ring-dls-focus",
        props.nested && "ps-6",
        props.active && "bg-dls-list-selected font-medium text-dls-text",
        props.dimmed && "cursor-default opacity-60 hover:bg-transparent",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{props.name}</span>
      {props.trailingHint ? (
        <span className="shrink-0 text-xs text-dls-secondary">
          {props.trailingHint}
        </span>
      ) : null}
      {props.onRemove ? (
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 opacity-0 text-dls-secondary group-hover:opacity-100 hover:text-dls-status-danger-fg"
          aria-label={t("knowledge.remove_vault")}
          onClick={(event) => {
            event.stopPropagation();
            props.onRemove?.();
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
