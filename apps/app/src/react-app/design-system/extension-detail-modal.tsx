/** @jsxImportSource react */
import { CheckCircle2, ExternalLink, Loader2, Plug2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/action-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { t } from "../../i18n";
import type { ExtensionKind } from "@/app/constants";
import { MarkdownBlock } from "../domains/session/surface/markdown";
import { modalBodyClass } from "../domains/shared/modal-styles";
import { resolveExtensionIconSrc } from "./extension-icon-src";
import { ExtensionMeshAvatar } from "./extension-mesh-avatar";
import { APP_NAME, APP_NAME_LOWER } from "../../i18n/locales/brand";

const extensionDetailTextClass = {
  sectionLabel: "mb-1 text-xs font-medium text-muted-foreground",
};

const extensionDetailLayoutClass = {
  contentBase: "flex max-h-[90vh] min-h-0 w-full flex-col overflow-hidden",
  contentWide: "max-w-3xl sm:max-w-3xl",
  contentDefault: "max-w-xl sm:max-w-xl",
  headerRow: "flex min-w-0 items-start gap-4",
  iconWrap: "relative shrink-0",
  iconConnected: "border-dls-status-success-border bg-dls-status-success-soft",
  meshAvatar: "size-9 rounded-lg text-xs font-medium",
  connectedDot: "absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full border-2 border-dls-surface bg-dls-status-success-fg",
  skillPreview: "flex flex-col gap-2",
  skillPreviewTitle: "text-sm font-medium text-card-foreground",
  skillPreviewBody: "max-h-[300px] overflow-y-auto rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-card-foreground",
  footer: "shrink-0",
  footerRow: "flex justify-between",
  leftActions: "flex gap-2",
  rightActions: "flex gap-3",
  uiControlStack: "space-y-4",
  uiControlCopy: "flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground",
  codeBlock: "max-h-[180px] overflow-x-auto rounded-xl border border-border p-3 text-xs leading-relaxed text-card-foreground",
  tableFrame: "relative overflow-hidden rounded-xl bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-xl before:border before:border-border",
};

const uiControlCompatibleClientsTitle = ["Claude Desktop", "Codex", "Cursor"].join(", ");
const opencodeClientTitle = "OpenCode";

export type ExtensionDetailModalProps = {
  open: boolean;
  onClose: () => void;
  name: string;
  description: string;
  iconSlug?: string;
  iconSrc?: string;
  fallbackIcon?: LucideIcon;
  kind?: ExtensionKind;
  connected?: boolean;
  connectedLabel?: string;
  disconnectedLabel?: string;
  connecting?: boolean;
  /** Whether this item is hidden from the normal extensions catalog. */
  hidden?: boolean;
  /** Whether this extension is still in preview. */
  preview?: boolean;
  /** Reason this item is visible but unavailable. */
  disabledReason?: string | null;
  /** Remote URL if applicable. */
  url?: string;
  /** Declarative setup instructions from an extension manifest. */
  setupInstructions?: string;
  /** Declarative install resource labels from an extension manifest. */
  resourceLabels?: string[];
  /** Declarative UI/runtime contribution labels from an extension manifest. */
  contributionLabels?: string[];
  /** Whether OAuth is required. */
  oauth?: boolean;
  /** Exact local command this extension will launch, when known. */
  launchCommand?: string[];
  /** Environment passed to the local MCP process, when known. */
  environment?: Record<string, string>;
  /** Filesystem path (for skills). Not shown directly, used for reveal. */
  path?: string;
  /** Skill trigger phrase (e.g. "when user asks to create an agent"). */
  trigger?: string;
  /** Reveal the file in Finder/Explorer. */
  onReveal?: () => void;
  /** Skill content preview (first ~500 chars of the SKILL.md). */
  contentPreview?: string;
  /** Connect handler. */
  onConnect?: () => void;
  connectLabel?: string;
  connectingLabel?: string;
  /** Uninstall/disconnect handler. Shown when connected. */
  onUninstall?: () => void;
  uninstallLabel?: string;
  /** Hide from the normal catalog view. */
  onHide?: () => void;
  /** Show again in the normal catalog view. */
  onShow?: () => void;
  /** Extension-specific configuration UI rendered inside the modal body. */
  configSlot?: React.ReactNode;
  showEnablementCard?: boolean;
  size?: "default" | "wide";
};

const kindLabel: Record<ExtensionKind, string> = {
  mcp: "MCP Server",
  plugin: "Plugin",
  skill: "Skill",
  "ui-control": "UI Control",
  extension: `${APP_NAME} Extension`,
};

const kindDescKey: Record<ExtensionKind, string> = {
  mcp: "extensions.kind_desc_mcp",
  plugin: "extensions.kind_desc_plugin",
  skill: "extensions.kind_desc_skill",
  "ui-control": "extensions.kind_desc_ui_control",
  extension: "extensions.kind_desc_extension",
};

const uiControlClientConfig = `{
  "mcpServers": {
    "onmyagent-ui": {
      "command": "npx",
      "args": ["-y", "onmyagent-ui-mcp"]
    }
  }
}`;

function uiControlOpencodeConfig(
  command: string[],
  environment?: Record<string, string>,
) {
  return JSON.stringify(
    {
      mcp: {
        "onmyagent-ui": {
          type: "local",
          command,
          ...(environment ? { environment } : {}),
          enabled: true,
        },
      },
    },
    null,
    2,
  );
}

const fallbackUiControlCommand = ["npx", "-y", "onmyagent-ui-mcp"];

const fallbackUiControlOpencodeConfig = `{
  "mcp": {
    "onmyagent-ui": {
      "type": "local",
      "command": ["npx", "-y", "onmyagent-ui-mcp"],
      "enabled": true
    }
  }
}`;

/**
 * Strip YAML-like frontmatter from the beginning of a skill content string.
 * Handles both `---` delimited blocks and bare `key: value` lines at the top.
 */
function stripSkillFrontmatter(content: string): string {
  let text = content;

  // Handle --- delimited frontmatter block
  const fencedMatch = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (fencedMatch) {
    text = text.slice(fencedMatch[0].length);
  } else {
    // Handle bare key: value lines at the top
    const lines = text.split("\n");
    let startIndex = 0;

    // Skip leading blank lines
    while (startIndex < lines.length && !lines[startIndex].trim()) {
      startIndex++;
    }

    // Skip any key: value lines (common frontmatter keys)
    while (startIndex < lines.length) {
      const line = lines[startIndex].trim();
      if (/^[a-zA-Z_-]+\s*:/.test(line) && !line.startsWith("#")) {
        startIndex++;
      } else {
        break;
      }
    }

    if (startIndex > 0) {
      text = lines.slice(startIndex).join("\n");
    }
  }

  // Trim leading blank lines
  return text.replace(/^\s*\n/, "");
}

export function ExtensionDetailModal(props: ExtensionDetailModalProps) {
  const {
    open,
    onClose,
    name,
    description,
    iconSlug,
    iconSrc,
    fallbackIcon: FallbackIcon = Plug2,
    kind = "mcp",
    connected = false,
    connectedLabel,
    disconnectedLabel,
    connecting = false,
    hidden = false,
    preview = false,
    disabledReason = null,
    url,
    setupInstructions,
    resourceLabels = [],
    contributionLabels = [],
    oauth,
    launchCommand,
    environment,
    path,
    trigger,
    contentPreview,
    onReveal,
    onConnect,
    connectLabel = t("common.connect"),
    connectingLabel = t("common.connecting"),
    onUninstall,
    uninstallLabel,
    onHide,
    onShow,
    configSlot,
    showEnablementCard = true,
    size = "default",
  } = props;
  const resolvedIconSrc = iconSrc
    ? resolveExtensionIconSrc(iconSrc)
    : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        className={`${extensionDetailLayoutClass.contentBase} ${size === "wide" ? extensionDetailLayoutClass.contentWide : extensionDetailLayoutClass.contentDefault}`}
      >
        <DialogHeader>
          <div className={extensionDetailLayoutClass.headerRow}>
            {/* Icon */}
            <div className={extensionDetailLayoutClass.iconWrap}>
              <IconTile
                size="lg"
                shape="xl"
                border
                className={connected ? extensionDetailLayoutClass.iconConnected : undefined}
              >
                {resolvedIconSrc ? (
                  <IconTile tone="surface" shape="md">
                    <img
                      src={resolvedIconSrc}
                      alt=""
                      width={20}
                      height={20}
                      loading="lazy"
                      style={{ display: "block" }}
                    />
                  </IconTile>
                ) : iconSlug ? (
                  <IconTile tone="surface" shape="md">
                    <img
                      src={`https://cdn.simpleicons.org/${iconSlug}`}
                      alt=""
                      width={20}
                      height={20}
                      loading="lazy"
                      style={{ display: "block" }}
                    />
                  </IconTile>
                ) : kind === "plugin" || kind === "skill" ? (
                  <ExtensionMeshAvatar
                    name={name}
                    className={extensionDetailLayoutClass.meshAvatar}
                  />
                ) : (
                  <FallbackIcon size={24} className="text-muted-foreground" />
                )}
              </IconTile>
              {connected ? (
                <div className={extensionDetailLayoutClass.connectedDot}>
                  <CheckCircle2
                    size={12}
                    className="text-white"
                    strokeWidth={3}
                  />
                </div>
              ) : null}
            </div>

            <div className="min-w-0 flex flex-col gap-1 justify-center self-stretch">
              <DialogTitle>{name}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <span>{kindLabel[kind]}</span>
                {preview ? (
                  <StatusBadge shape="soft" size="tiny" tone="accent">
                    Preview
                  </StatusBadge>
                ) : null}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className={modalBodyClass}>
          <div className="space-y-5 px-px">
            {/* Description */}
            <div className="text-sm leading-relaxed text-card-foreground">
              {description}
            </div>

            {setupInstructions ? (
              <Card variant="outline" size="sm">
                <CardHeader>
                  <CardTitle>{t("extensions.setup")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-sm leading-relaxed text-muted-foreground">
                    {setupInstructions}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {resourceLabels.length > 0 || contributionLabels.length > 0 ? (
              <Card variant="outline" size="sm">
                <CardHeader>
                  <CardTitle>{t("extensions.manifest")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 text-sm">
                    {resourceLabels.length > 0 ? (
                      <div>
                        <div className={extensionDetailTextClass.sectionLabel}>
                          Resources
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {resourceLabels.map((label) => (
                            <StatusBadge key={label} tone="surface">
                              {label}
                            </StatusBadge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {contributionLabels.length > 0 ? (
                      <div>
                        <div className={extensionDetailTextClass.sectionLabel}>
                          Contributions
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {contributionLabels.map((label) => (
                            <StatusBadge key={label} tone="surface">
                              {label}
                            </StatusBadge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {/* Details */}
            <Card variant="outline" size="sm">
              <CardHeader>
                <CardTitle>{t("extensions.details")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("common.type")}</span>
                    <span className="font-medium text-card-foreground">
                      {kindLabel[kind]}
                    </span>
                  </div>

                  {url ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{t("extensions.endpoint")}</span>
                      <span className="flex items-center gap-1.5 truncate font-mono text-xs text-card-foreground">
                        {url.replace(/^https?:\/\//, "").slice(0, 40)}
                        <ExternalLink
                          size={12}
                          className="shrink-0 text-muted-foreground"
                        />
                      </span>
                    </div>
                  ) : null}

                  {kind === "ui-control" ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{t("extensions.launch")}</span>
                      <span className="max-w-[300px] truncate font-mono text-xs text-card-foreground">
                        {(launchCommand ?? fallbackUiControlCommand).join(" ")}
                      </span>
                    </div>
                  ) : null}

                  {path && onReveal ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{t("extensions.location")}</span>
                      <Button variant="link" size="xs" onClick={onReveal}>
                        {t("message.reveal_in_finder")}
                        <ExternalLink data-icon="inline-end" />
                      </Button>
                    </div>
                  ) : null}

                  {oauth ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        Authentication
                      </span>
                      <span className="font-medium text-card-foreground">
                        {t("extensions.oauth_required")}
                      </span>
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("common.status")}</span>
                    <span
                      className={`font-medium ${connected ? "text-dls-status-success-fg" : "text-muted-foreground"}`}
                    >
                      {connected
                        ? (connectedLabel ??
                          (kind === "skill" || kind === "plugin"
                            ? t("extensions.installed")
                            : t("extensions.connected")))
                        : connecting
                          ? connectingLabel
                          : (disconnectedLabel ??
                            (kind === "skill" || kind === "plugin"
                              ? t("extensions.not_installed")
                              : t("extensions.not_connected")))}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("extensions.visibility")}</span>
                    <span className="font-medium text-card-foreground">
                      {hidden ? t("extensions.hidden") : t("extensions.shown")}
                    </span>
                  </div>

                  {preview ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {t("extensions.release_stage")}
                      </span>
                      <span className="font-medium text-dls-accent">{t("extensions.preview")}</span>
                    </div>
                  ) : null}

                  {disabledReason ? (
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-muted-foreground">
                        Availability
                      </span>
                      <span className="text-right font-medium text-dls-status-warning">
                        {disabledReason}
                      </span>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            {/* Skill-specific: trigger + content preview */}
            {kind === "ui-control" ? (
              <UiControlConnectionDetails
                launchCommand={launchCommand}
                environment={environment}
              />
            ) : null}

            {kind === "skill" && trigger ? (
              <Card variant="outline" size="sm">
                <CardHeader>
                  <CardTitle>{t("extensions.trigger")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-sm leading-relaxed text-card-foreground">
                    {trigger}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {kind === "skill" && contentPreview
              ? (() => {
                  const body = stripSkillFrontmatter(contentPreview);
                  if (!body.trim()) return null;
                  return (
                    <div className={extensionDetailLayoutClass.skillPreview}>
                      <div className={extensionDetailLayoutClass.skillPreviewTitle}>
                        {t("extensions.skill_content")}
                      </div>
                      <div className={extensionDetailLayoutClass.skillPreviewBody}>
                        <MarkdownBlock text={body} />
                      </div>
                    </div>
                  );
                })()
              : null}

            {/* What this enables (generic, for non-skills or skills without preview) */}
            {showEnablementCard &&
            ((kind !== "skill" && kind !== "ui-control") ||
              (!trigger && !contentPreview && kind !== "ui-control")) ? (
              <Card variant="outline" size="sm">
                <CardHeader>
                  <CardTitle>{t("extensions.what_this_enables")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-sm leading-relaxed text-muted-foreground">
                    {t(kindDescKey[kind])}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {configSlot}
          </div>
        </div>

        <DialogFooter className={extensionDetailLayoutClass.footer}>
          <div className={extensionDetailLayoutClass.footerRow}>
            <div className={extensionDetailLayoutClass.leftActions}>
              {hidden && onShow ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onShow();
                    onClose();
                  }}
                >
                  {t("common.show")}
                </Button>
              ) : !hidden && onHide ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onHide();
                    onClose();
                  }}
                >
                  {t("common.hide")}
                </Button>
              ) : null}
              {connected && onUninstall ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    onUninstall();
                    onClose();
                  }}
                >
                  {uninstallLabel ??
                    (kind === "skill" ? t("common.uninstall") : t("common.disconnect"))}
                </Button>
              ) : null}
            </div>
            <div className={extensionDetailLayoutClass.rightActions}>
              <DialogClose render={<Button variant="outline" />}>
                {t("common.close")}
              </DialogClose>
              {!connected && onConnect ? (
                <Button onClick={onConnect} disabled={connecting}>
                  {connecting ? (
                    <>
                      <Loader2
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                      {connectingLabel}
                    </>
                  ) : (
                    connectLabel
                  )}
                </Button>
              ) : null}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UiControlConnectionDetails(props: {
  launchCommand?: string[];
  environment?: Record<string, string>;
}) {
  const opencodeConfig = props.launchCommand
    ? uiControlOpencodeConfig(props.launchCommand, props.environment)
    : fallbackUiControlOpencodeConfig;

  return (
    <div className={extensionDetailLayoutClass.uiControlStack}>
      <Card variant="outline" size="sm">
        <CardHeader>
          <CardTitle>{t("extensions.ui_control_connect_title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={extensionDetailLayoutClass.uiControlCopy}>
            <div>
              {t("extensions.ui_control_bridge_copy")}
            </div>
            <div>
              {t("extensions.ui_control_client_starts_prefix")}{" "}
              <span className="font-mono text-card-foreground">
                ${APP_NAME_LOWER}-ui-mcp
              </span>{" "}
              {t("extensions.ui_control_client_starts_suffix")}
            </div>
            <div>
              {t("extensions.ui_control_do_not_point_directly")}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card variant="outline" size="sm">
        <CardHeader>
          <CardTitle>{uiControlCompatibleClientsTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className={extensionDetailLayoutClass.codeBlock}>
            <code>{uiControlClientConfig}</code>
          </pre>
        </CardContent>
      </Card>

      <Card variant="outline" size="sm">
        <CardHeader>
          <CardTitle>{opencodeClientTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className={extensionDetailLayoutClass.codeBlock}>
            <code>{opencodeConfig}</code>
          </pre>
        </CardContent>
      </Card>

      <Card variant="outline" size="sm">
        <CardHeader>
          <CardTitle>{t("extensions.discovery")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={extensionDetailLayoutClass.tableFrame}>
            <Table className="text-xs">
              <TableBody>
                <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                  <TableCell className="bg-muted/50 w-40 py-2 text-xs font-medium">
                    {t("extensions.production_discovery_file")}
                  </TableCell>
                  <TableCell className="py-2 whitespace-normal">
                    <span className="font-mono text-xs break-all">
                      ~/Library/Application Support/com.differentai.
                      {APP_NAME_LOWER}/{APP_NAME_LOWER}-ui-control.json
                    </span>
                  </TableCell>
                </TableRow>
                <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                  <TableCell className="bg-muted/50 py-2 text-xs font-medium">
                    {t("extensions.dev_discovery_file")}
                  </TableCell>
                  <TableCell className="py-2 whitespace-normal">
                    <span className="font-mono text-xs break-all">
                      ~/Library/Application Support/com.differentai.
                      {APP_NAME_LOWER}.dev/{APP_NAME_LOWER}-ui-control.json
                    </span>
                  </TableCell>
                </TableRow>
                <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                  <TableCell className="bg-muted/50 py-2 text-xs font-medium">
                    {t("extensions.override")}
                  </TableCell>
                  <TableCell className="py-2 whitespace-normal">
                    <span className="font-mono text-xs break-all">
                      ONMYAGENT_UI_CONTROL_DISCOVERY=/path/to/onmyagent-ui-control.json
                    </span>
                  </TableCell>
                </TableRow>
                {props.environment?.ONMYAGENT_UI_CONTROL_DISCOVERY ? (
                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 text-xs font-medium">
                      {t("extensions.current_override")}
                    </TableCell>
                    <TableCell className="py-2 whitespace-normal">
                      <span className="font-mono text-xs break-all">
                        {props.environment.ONMYAGENT_UI_CONTROL_DISCOVERY}
                      </span>
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
