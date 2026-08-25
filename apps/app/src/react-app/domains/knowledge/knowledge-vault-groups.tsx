/** @jsxImportSource react */
import * as React from "react";
import {
  ChevronRight,
  Folder,
  FolderPlus,
  Loader2,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { t } from "../../../i18n";
import { addKnowledgeVault, pickDirectory, removeKnowledgeVault } from "../../../app/lib/desktop";
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
  projectName?: string | null;
  expertName?: string | null;
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
  const [openGroups, setOpenGroups] = React.useState<
    Record<KnowledgeVaultScope, boolean>
  >({ user: true, project: true, expert: true });
  const [add, setAdd] = React.useState<AddState>(INITIAL_ADD_STATE);
  const [removing, setRemoving] = React.useState<KnowledgeVaultItem | null>(null);

  const toggle = (scope: KnowledgeVaultScope) =>
    setOpenGroups((prev) => ({ ...prev, [scope]: !prev[scope] }));

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
      setAdd((prev) => ({ ...prev, error: result?.reason ?? "add_failed" }));
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
      <GroupSection
        open={openGroups.user}
        onToggle={() => toggle("user")}
        label={t("knowledge.group_my_vaults")}
        action={
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 text-dls-secondary"
            aria-label={t("knowledge.add_vault")}
            onClick={() => setAdd({ ...INITIAL_ADD_STATE, open: true })}
          >
            <FolderPlus className="size-3.5" />
          </Button>
        }
      >
        {props.userVaults.map((vault) => {
          const active =
            props.active.scope === "user" &&
            (vault.isDefault
              ? !props.active.vaultPath
              : props.active.vaultPath === vault.path);
          return (
            <VaultRow
              key={vault.path}
              name={vault.name}
              active={active}
              onSelect={() =>
                props.onSelect({
                  scope: "user",
                  vaultPath: vault.isDefault ? null : vault.path,
                })
              }
              onRemove={
                vault.isDefault
                  ? undefined
                  : () => setRemoving(vault)
              }
            />
          );
        })}
      </GroupSection>

      <GroupSection
        open={openGroups.project}
        onToggle={() => toggle("project")}
        label={t("knowledge.group_project")}
      >
        <VaultRow
          name={props.projectName ?? t("knowledge.scope_project")}
          dimmed={props.projectUnavailable}
          trailingHint={
            props.projectUnavailable ? t("knowledge.scope_unavailable") : null
          }
          active={props.active.scope === "project" && !props.projectUnavailable}
          onSelect={
            props.projectUnavailable
              ? undefined
              : () => props.onSelect({ scope: "project" })
          }
        />
      </GroupSection>

      <GroupSection
        open={openGroups.expert}
        onToggle={() => toggle("expert")}
        label={t("knowledge.group_expert")}
      >
        <VaultRow
          name={props.expertName ?? t("knowledge.scope_expert")}
          dimmed={props.expertUnavailable}
          trailingHint={
            props.expertUnavailable ? t("knowledge.scope_unavailable") : null
          }
          active={props.active.scope === "expert" && !props.expertUnavailable}
          onSelect={
            props.expertUnavailable
              ? undefined
              : () => props.onSelect({ scope: "expert" })
          }
        />
      </GroupSection>

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
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-dls-secondary">
                {t("knowledge.add_vault_name_label")}
              </span>
              <Input
                value={add.name}
                placeholder={t("knowledge.add_vault_name_placeholder")}
                onChange={(event) =>
                  setAdd((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-dls-secondary">
                {t("knowledge.add_vault_folder_label")}
              </span>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={add.folderPath}
                  placeholder={t("knowledge.add_vault_choose")}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void chooseFolder()}
                >
                  {t("knowledge.add_vault_choose")}
                </Button>
              </div>
            </label>
            {add.error ? (
              <p className="text-xs text-dls-status-danger-fg">{add.error}</p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              {t("common.cancel")}
            </DialogClose>
            <Button
              type="button"
              size="sm"
              disabled={add.busy}
              onClick={() => void submitAdd()}
            >
              {add.busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
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

function GroupSection(props: {
  open: boolean;
  onToggle: () => void;
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Collapsible open={props.open} onOpenChange={props.onToggle}>
      <div className="flex items-center gap-1 pe-1">
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 flex-1 justify-start gap-1 px-1.5 text-xs font-semibold uppercase tracking-wide text-dls-secondary"
            >
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 transition-transform",
                  props.open && "rotate-90",
                )}
              />
              <span className="truncate">{props.label}</span>
            </Button>
          }
        />
        {props.action}
      </div>
      <CollapsibleContent className="space-y-0.5 py-0.5">
        {props.children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function VaultRow(props: {
  name: string;
  active: boolean;
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
        "group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm outline-none",
        "hover:bg-dls-list-hover focus-visible:ring-1 focus-visible:ring-dls-focus",
        props.active && "bg-dls-rail-pill-hover font-medium text-dls-accent",
        props.dimmed && "cursor-default opacity-60 hover:bg-transparent",
      )}
    >
      <Folder className="size-3.5 shrink-0 text-dls-secondary" />
      <span className="min-w-0 flex-1 truncate">{props.name}</span>
      {props.trailingHint ? (
        <span className="shrink-0 text-[10px] text-dls-secondary">
          {props.trailingHint}
        </span>
      ) : null}
      {props.onRemove ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 shrink-0 opacity-0 text-dls-secondary group-hover:opacity-100 hover:text-dls-status-danger-fg"
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
