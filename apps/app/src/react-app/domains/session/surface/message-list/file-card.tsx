/** @jsxImportSource react */
import { useState } from "react";
import {
  openDesktopPath,
  revealDesktopItemInDir,
} from "../../../../../app/lib/desktop";
import { Button } from "@/components/ui/button";
import { MenuRowButton } from "@/components/ui/action-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { isDesktopRuntime } from "../../../../../app/utils";
import { humanMediaType, isImageAttachment } from "./parts";
import { ArtifactIcon } from "../../artifacts/artifact-icon";

export async function openFileWithOS(path: string) {
  try {
    await openDesktopPath(path);
  } catch {
    // silently fail on web
  }
}

export async function revealFileInFinder(path: string) {
  try {
    await revealDesktopItemInDir(path);
  } catch (error) {
    console.error("Failed to reveal item in folder:", error);
  }
}

export function FileCard(props: {
  part: { filename?: string; url: string; mediaType: string };
  tone: "assistant" | "user";
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isDataUrl = props.part.url?.startsWith("data:");
  const title =
    props.part.filename ||
    (isDataUrl ? t("session.attached_file") : props.part.url) ||
    t("session.file");
  const ext = props.part.filename?.split(".").pop()?.toLowerCase();
  const badge = humanMediaType(props.part.mediaType) ?? (ext ? ext.toUpperCase() : null);
  const isImage = isImageAttachment(props.part.mediaType ?? "");
  const isDesktop = isDesktopRuntime();
  const hasPath = !isDataUrl && props.part.url && !props.part.url.startsWith("http");

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors",
        props.tone === "user"
          ? "border-dls-mist bg-dls-surface-muted hover:bg-dls-surface-muted"
          : "border-dls-mist bg-dls-surface hover:bg-dls-surface-muted",
      )}
    >
      {isImage && props.part.url ? (
        <div className="size-11 shrink-0 overflow-hidden rounded-xl border border-dls-mist bg-dls-surface">
          <img src={props.part.url} alt={title} loading="lazy" decoding="async" className="size-full object-cover" />
        </div>
      ) : (
        <div
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl",
            props.tone === "user" ? "bg-dls-surface-muted text-dls-text" : "bg-dls-surface-muted text-dls-secondary",
          )}
        >
          <ArtifactIcon name={title} className="size-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-snug text-dls-text">{title}</div>
        {badge ? (
          <StatusBadge className="mt-1" shape="soft" size="tiny">
            {badge}
          </StatusBadge>
        ) : null}
      </div>

      {isDesktop && hasPath ? (
        <div className="relative">
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            className="text-dls-secondary opacity-0 hover:bg-dls-surface-muted hover:text-dls-text group-hover:opacity-100"
            onClick={() => setMenuOpen((value) => !value)}
            title={t("message.file_actions")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </Button>
          {menuOpen ? (
            <>
              <button type="button" className="fixed inset-0 z-30 cursor-default border-0 bg-transparent p-0" aria-label={t("message.close_file_actions")} onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-1 w-48 rounded-xl border border-dls-border bg-dls-surface p-1.5">
                <MenuRowButton align="center"
                  type="button"
                  className="gap-2.5 py-2 text-dls-text hover:bg-dls-surface-muted"
                  onClick={() => {
                    void openFileWithOS(props.part.url);
                    setMenuOpen(false);
                  }}
                >
                  {t("message.open_with_default_app")}
                </MenuRowButton>
                <MenuRowButton align="center"
                  type="button"
                  className="gap-2.5 py-2 text-dls-text hover:bg-dls-surface-muted"
                  onClick={() => {
                    void revealFileInFinder(props.part.url);
                    setMenuOpen(false);
                  }}
                >
                  {t("message.reveal_in_finder")}
                </MenuRowButton>
                <MenuRowButton align="center"
                  type="button"
                  className="gap-2.5 py-2 text-dls-text hover:bg-dls-surface-muted"
                  onClick={() => {
                    void navigator.clipboard.writeText(props.part.url);
                    setMenuOpen(false);
                  }}
                >
                  {t("message.copy_path")}
                </MenuRowButton>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
