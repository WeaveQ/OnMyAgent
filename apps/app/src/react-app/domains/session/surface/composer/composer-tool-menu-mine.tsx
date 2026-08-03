/**
 * Second-column flyout for + → Mine: multi-level folders + search + multi-select attach.
 */
import { ChevronLeft, ChevronRight, Folder, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MenuRowButton } from "@/components/ui/action-row";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { t } from "../../../../../i18n";
import { ArtifactIcon } from "../../../../capabilities/artifacts/artifact-icon";
import type { MentionItem } from "./composer-helpers";

export type ComposerToolMenuMineProps = {
  title: string;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  items: MentionItem[];
  loading: boolean;
  adding: boolean;
  error: string | null;
  selectedFilePaths: ReadonlySet<string>;
  canGoBack: boolean;
  onBack: () => void;
  onOpenFolder: (path: string) => void;
  onToggleFile: (path: string) => void;
  onAddSelected: () => void;
};

export function ComposerToolMenuMine(props: ComposerToolMenuMineProps) {
  const selectedCount = props.selectedFilePaths.size;

  return (
    <>
      <div className="space-y-1.5 px-3 pt-2 pb-1">
        <div className="flex min-h-7 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            {props.canGoBack ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="shrink-0"
                aria-label={t("composer.folder_files_back")}
                onClick={props.onBack}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
            ) : null}
            <div className="min-w-0 truncate text-sm font-medium text-dls-text">
              {props.title}
              <span className="tabular-nums font-medium text-dls-secondary">
                {" "}
                ({props.items.length})
              </span>
            </div>
          </div>
          {selectedCount > 0 ? (
            <Button
              type="button"
              size="xs"
              className="shrink-0"
              disabled={props.adding}
              onClick={() => void props.onAddSelected()}
            >
              {props.adding
                ? t("composer.folder_files_adding")
                : t("composer.folder_files_add", { count: selectedCount })}
            </Button>
          ) : null}
        </div>
        <InputGroup
          controlSize="sm"
          radius="lg"
          tone="surfaceMuted"
          className="border-dls-border/50"
        >
          <InputGroupAddon align="inline-start" inset="compact">
            <Search aria-hidden="true" className="size-3.5 text-dls-secondary" />
          </InputGroupAddon>
          <InputGroupInput
            value={props.searchQuery}
            onChange={(event) =>
              props.setSearchQuery(event.currentTarget.value)
            }
            placeholder={t("composer.search_mine_files")}
            aria-label={t("composer.search_mine_files")}
            className="text-sm text-dls-text placeholder:text-dls-secondary/70"
          />
        </InputGroup>
      </div>
      {props.error ? (
        <div
          role="alert"
          className="mx-1.5 mb-1 rounded-lg border border-dls-status-danger-border bg-dls-status-danger-soft px-2.5 py-1.5 text-xs text-dls-status-danger-fg"
        >
          {props.error}
        </div>
      ) : null}
      <div className="max-h-56 overflow-x-hidden overflow-y-auto px-1.5 pb-1.5 pt-0">
        {props.loading ? (
          <div className="flex min-h-20 items-center justify-center gap-2">
            <LoadingSpinner />
            <span className="sr-only">{t("composer.folder_files_loading")}</span>
          </div>
        ) : props.items.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-dls-secondary">
            {props.searchQuery.trim()
              ? t("composer.no_matching_mine_files")
              : t("composer.folder_files_empty")}
          </div>
        ) : (
          <div className="grid min-w-0 gap-0.5">
            {props.items.map((item) =>
              item.kind === "directory" ? (
                <MenuRowButton
                  key={item.id}
                  type="button"
                  density="compact"
                  align="center"
                  className="justify-between gap-2"
                  onClick={() => props.onOpenFolder(item.value)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Folder className="size-3.5 shrink-0 text-dls-secondary" />
                    <span className="min-w-0 truncate text-sm font-medium text-dls-text">
                      {item.label}
                    </span>
                  </span>
                  <ChevronRight className="size-3.5 shrink-0 text-dls-text/50" />
                </MenuRowButton>
              ) : (
                <label
                  key={item.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-dls-text transition-colors hover:bg-dls-surface-muted/70"
                >
                  <Checkbox
                    checked={props.selectedFilePaths.has(item.value)}
                    onCheckedChange={() => props.onToggleFile(item.value)}
                  />
                  <ArtifactIcon
                    name={item.value || item.label}
                    className="size-3.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </label>
              ),
            )}
          </div>
        )}
      </div>
    </>
  );
}
