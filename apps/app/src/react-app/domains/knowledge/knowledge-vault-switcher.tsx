/** @jsxImportSource react */
import { Check, ChevronsUpDown, Folder, FolderOpen, FolderPlus, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "../../../i18n";
import {
  openKnowledgeVaultFolder,
  pickDirectory,
  setKnowledgePersonalVaultPath,
} from "../../../app/lib/desktop";

export type KnowledgeVaultOption = {
  name: string;
  path: string;
  isDefault: boolean;
};

type KnowledgeVaultSwitcherProps = {
  currentPath: string;
  vaults: readonly KnowledgeVaultOption[];
  onChanged: () => void;
};

export function KnowledgeVaultSwitcher(props: KnowledgeVaultSwitcherProps) {
  const current = props.vaults.find((item) => item.path === props.currentPath) ?? props.vaults[0];
  const label = current?.name || t("knowledge.default_vault");
  const onDefault = current?.isDefault !== false;

  const activate = async (nextPath: string | null) => {
    const result = await setKnowledgePersonalVaultPath(nextPath);
    if (result?.ok) props.onChanged();
  };

  const pickAndActivate = async () => {
    const picked = await pickDirectory({
      title: t("knowledge.add_space"),
    });
    const next = Array.isArray(picked) ? picked[0] : picked;
    if (!next) return;
    await activate(next);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 max-w-40 cursor-pointer justify-start gap-1 px-1.5 text-sm font-medium"
            aria-label={t("knowledge.switch_vault")}
          >
            <ChevronsUpDown className="size-3.5 shrink-0 text-dls-secondary" />
            <span className="truncate">{label}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="start" side="top" className="w-56 min-w-56">
        {props.vaults.map((vault) => {
          const active = vault.path === props.currentPath;
          return (
            <DropdownMenuItem
              key={vault.path}
              className="gap-2"
              onClick={() => void activate(vault.isDefault ? null : vault.path)}
            >
              <Folder className="size-3.5 shrink-0 text-dls-secondary" />
              <span className="min-w-0 flex-1 truncate">{vault.name}</span>
              {active ? <Check className="size-3.5 shrink-0 text-dls-accent" /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2" onClick={() => void pickAndActivate()}>
          <FolderPlus className="size-3.5 shrink-0 text-dls-secondary" />
          <span>{t("knowledge.add_space")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onClick={() => void openKnowledgeVaultFolder()}>
          <FolderOpen className="size-3.5 shrink-0 text-dls-secondary" />
          <span>{t("knowledge.reveal")}</span>
        </DropdownMenuItem>
        {onDefault ? null : (
          <DropdownMenuItem className="gap-2" onClick={() => void activate(null)}>
            <RotateCcw className="size-3.5 shrink-0 text-dls-secondary" />
            <span>{t("knowledge.reset_folder")}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
