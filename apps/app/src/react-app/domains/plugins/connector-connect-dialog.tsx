/** @jsxImportSource react */
import type { ReactNode } from "react";
import { Link2, Loader2, MessageCircle, Unlink, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import { APP_NAME } from "@/i18n/locales/brand";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";

import { TryThisPromptsSection } from "./artifact-plugin-detail";

const DEFAULT_PRODUCT_ICON = "/on-my-agent-logo.png";

export type ConnectorConnectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Target service display name (e.g. Feishu). */
  name: string;
  description: string;
  /** Target service icon (local path or absolute URL). */
  iconSrc?: string | null;
  /** Simple Icons slug fallback when iconSrc is missing. */
  iconSlug?: string | null;
  /** Custom right-side logo (built-in brand tiles). Overrides iconSrc/slug. */
  serviceIconNode?: ReactNode;
  /** Left (product) logo. Defaults to OnMyAgent mark. */
  productIconSrc?: string | null;
  /**
   * Wider shell when embedding a full settings card (Computer Use).
   * Default connect chrome stays dual-logo Feishu style.
   */
  size?: "default" | "wide";
  /** Unconnected primary CTA. */
  connectLabel?: string;
  connectingLabel?: string;
  connecting?: boolean;
  onConnect?: () => void | Promise<void>;
  /** Connected = show try-it + unbind instead of connect. */
  connected?: boolean;
  tryItLabel?: string;
  onTryIt?: () => void;
  unbindLabel?: string;
  unbinding?: boolean;
  onUnbind?: () => void | Promise<void>;
  tryThisTitle?: string;
  tryThisPrompts?: string[];
  onSelectPrompt?: (prompt: string) => void;
  promptsDisabled?: boolean;
  /** Optional note under CTAs (preview / error). */
  footerNote?: string | null;
  /** Optional body below try-this (e.g. extension settings card). */
  children?: ReactNode;
};

function ConnectorLogo(props: {
  src?: string | null;
  slug?: string | null;
  name: string;
  className?: string;
  children?: ReactNode;
}) {
  if (props.children) {
    return (
      <div
        className={cn(
          "flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full",
          "border border-dls-border/80 bg-dls-surface shadow-sm",
          props.className,
        )}
      >
        {props.children}
      </div>
    );
  }

  const resolved = props.src
    ? resolvePublicAssetUrl(props.src)
    : props.slug
      ? `https://cdn.simpleicons.org/${props.slug}`
      : null;

  return (
    <div
      className={cn(
        "flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full",
        "border border-dls-border/80 bg-dls-surface shadow-sm",
        props.className,
      )}
    >
      {resolved ? (
        <img
          src={resolved}
          alt=""
          className="size-full object-cover"
          draggable={false}
        />
      ) : (
        <span className="text-base font-semibold text-dls-text">
          {props.name.trim().slice(0, 1).toUpperCase() || "?"}
        </span>
      )}
    </div>
  );
}

/**
 * WorkBuddy / Feishu-style connector dialog:
 * - Dual logos + “连接 {name}” + description
 * - Unconnected: [连接]
 * - Connected: [去试试] [解绑]
 * - 试试这样用 prompt list
 * - Optional children (settings card) below
 */
export function ConnectorConnectDialog(props: ConnectorConnectDialogProps) {
  const productSrc = props.productIconSrc?.trim() || DEFAULT_PRODUCT_ICON;
  const tryThisTitle =
    props.tryThisTitle?.trim() || t("plugins.artifact_starter_prompts");
  const connectLabel = props.connectLabel?.trim() || t("common.connect");
  const connectingLabel =
    props.connectingLabel?.trim() || t("common.connecting");
  const tryItLabel =
    props.tryItLabel?.trim() || t("plugins.connector_try_it");
  const unbindLabel =
    props.unbindLabel?.trim() || t("plugins.connector_unbind");
  const prompts = props.tryThisPrompts?.filter(Boolean) ?? [];
  const title = t("plugins.connector_connect_title", { name: props.name });
  const connected = Boolean(props.connected);
  const showConnect = !connected && Boolean(props.onConnect);
  const showConnectedActions =
    connected && (Boolean(props.onTryIt) || Boolean(props.onUnbind));
  const wide = props.size === "wide" || Boolean(props.children);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          // Wide when embedding Computer Use card so 5 step tabs don't clip.
          wide
            ? "h-[min(720px,92vh)] max-h-[min(720px,92vh)] w-[min(640px,calc(100vw-2rem))] sm:max-w-xl"
            : "h-[min(640px,90vh)] max-h-[min(640px,90vh)] w-[min(520px,calc(100vw-2rem))] sm:max-w-lg",
        )}
        showCloseButton={false}
      >
        <div className="absolute right-3 top-3 z-10">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-dls-secondary hover:text-dls-text"
            onClick={() => props.onOpenChange(false)}
            aria-label={t("common.close")}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-8 pb-5 pt-10">
            {/* Dual logos: product ⋯ service */}
            <div className="flex items-center justify-center gap-3">
              <ConnectorLogo src={productSrc} name={APP_NAME} />
              <span
                className="flex items-center gap-1 text-dls-secondary/70"
                aria-hidden
              >
                <span className="size-1 rounded-full bg-current" />
                <span className="size-1 rounded-full bg-current" />
                <span className="size-1 rounded-full bg-current" />
                <span className="size-1 rounded-full bg-current" />
              </span>
              <ConnectorLogo
                src={props.iconSrc}
                slug={props.iconSlug}
                name={props.name}
              >
                {props.serviceIconNode}
              </ConnectorLogo>
            </div>

            <DialogHeader className="space-y-2 text-center sm:text-center">
              <DialogTitle className="text-center text-base font-semibold text-dls-text">
                {title}
              </DialogTitle>
              <DialogDescription className="mx-auto max-w-[28rem] text-center text-sm leading-relaxed text-dls-secondary">
                {props.description}
              </DialogDescription>
            </DialogHeader>

            {showConnect ? (
              <div className="flex flex-col items-center gap-2">
                <Button
                  type="button"
                  size="default"
                  className="min-w-[7.5rem] gap-1.5 rounded-full px-6"
                  disabled={props.connecting}
                  onClick={() => void props.onConnect?.()}
                >
                  {props.connecting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Link2 className="size-4" aria-hidden />
                  )}
                  {props.connecting ? connectingLabel : connectLabel}
                </Button>
              </div>
            ) : null}

            {showConnectedActions ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {props.onTryIt ? (
                  <Button
                    type="button"
                    size="default"
                    className="min-w-[6.5rem] gap-1.5 rounded-full px-5"
                    onClick={() => props.onTryIt?.()}
                  >
                    <MessageCircle className="size-4" aria-hidden />
                    {tryItLabel}
                  </Button>
                ) : null}
                {props.onUnbind ? (
                  <Button
                    type="button"
                    size="default"
                    variant="outline"
                    className="min-w-[6.5rem] gap-1.5 rounded-full px-5"
                    disabled={props.unbinding}
                    onClick={() => void props.onUnbind?.()}
                  >
                    {props.unbinding ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Unlink className="size-4" aria-hidden />
                    )}
                    {unbindLabel}
                  </Button>
                ) : null}
              </div>
            ) : null}

            {props.footerNote ? (
              <p className="mx-auto max-w-[28rem] text-center text-xs leading-snug text-dls-secondary">
                {props.footerNote}
              </p>
            ) : null}

            {prompts.length > 0 ? (
              <TryThisPromptsSection title={tryThisTitle} className="pt-1 text-left">
                <div className="space-y-2">
                  {prompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={props.promptsDisabled || !props.onSelectPrompt}
                      onClick={() => props.onSelectPrompt?.(prompt)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-2xl px-4 py-3 text-left transition-colors",
                        "bg-dls-surface-muted/70 hover:bg-dls-surface-muted",
                        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-dls-surface-muted/70",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
                      )}
                    >
                      <span className="min-w-0 flex-1 text-sm leading-6 text-dls-secondary">
                        “{prompt}”
                      </span>
                      <MessageCircle
                        className="mt-0.5 size-4 shrink-0 text-dls-secondary/80"
                        aria-hidden
                      />
                    </button>
                  ))}
                </div>
              </TryThisPromptsSection>
            ) : null}

            {props.children ? (
              <div className="space-y-3 border-t border-dls-border/60 pt-4 text-left">
                {props.children}
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
