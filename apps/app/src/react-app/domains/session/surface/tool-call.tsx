/** @jsxImportSource react */
import { useMemo, useState } from "react";
import type { DynamicToolUIPart } from "ai";
import type { Part, ToolState } from "@opencode-ai/sdk/v2/client";

import { safeStringify, summarizeStep } from "../../../../app/utils";

import { Button } from "@/components/ui/button";
import { DisclosureRowButton } from "@/components/ui/action-row";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/status-badge";
import { t } from "../../../../i18n";
function normalizeToolText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/(?:\r?\n\s*)+$/, "");
}

function hasStructuredValue(value: unknown) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function formatStructuredValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolCallStatusTone(status: "completed" | "error" | "running"): StatusBadgeTone {
  if (status === "completed") return "success";
  if (status === "error") return "danger";
  return "accent";
}

function toToolStateValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toSummaryToolState(part: DynamicToolUIPart): ToolState {
  const input = toToolStateValue(part.input);
  const startedAt = Date.now();
  if (part.state === "output-available") {
    return {
      status: "completed",
      input,
      output: formatStructuredValue(part.output),
      title: part.title ?? part.toolName,
      metadata: {},
      time: { start: startedAt, end: startedAt },
    };
  }
  if (part.state === "output-error") {
    return {
      status: "error",
      input,
      error: part.errorText,
      time: { start: startedAt, end: startedAt },
    };
  }
  return {
    status: "running",
    input,
    title: part.title ?? part.toolName,
    metadata: {},
    time: { start: startedAt },
  };
}

function toSummaryToolPart(part: DynamicToolUIPart): Part {
  return {
    id: part.toolCallId,
    type: "tool",
    sessionID: "",
    messageID: "",
    callID: part.toolCallId,
    tool: part.toolName,
    state: toSummaryToolState(part),
  };
}

function diffLineClass(line: string) {
  if (line.startsWith("+")) return "text-dls-status-success-fg bg-dls-status-success-soft";
  if (line.startsWith("-")) return "text-dls-status-danger-fg bg-dls-status-danger-soft";
  if (line.startsWith("@@")) return "text-dls-accent bg-dls-decision-soft";
  return "text-dls-text";
}

function extractDiff(output: unknown) {
  if (typeof output !== "string") return null;
  if (output.includes("@@") || output.includes("+++ ") || output.includes("--- ")) {
    return output;
  }
  return null;
}

function toKeyedLines(value: string) {
  let offset = 0;
  return value.split("\n").map((line) => {
    const key = `${offset}:${line}`;
    offset += line.length + 1;
    return { key, line };
  });
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export function ToolCallView(props: { part: DynamicToolUIPart; developerMode: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(
    () => summarizeStep(toSummaryToolPart(props.part)),
    [props.part],
  );

  const title = summary.title?.trim() || props.part.toolName || "Tool";
  const subtitle = summary.detail?.trim() || "";
  const status =
    props.part.state === "output-available"
      ? "completed"
      : props.part.state === "output-error"
        ? "error"
        : "running";
  const input = props.part.input;
  const output = props.part.state === "output-available" ? props.part.output : undefined;
  const error = props.part.state === "output-error" ? props.part.errorText : "";
  const diff = extractDiff(output);
  const diffLines = diff ? toKeyedLines(normalizeToolText(diff)) : [];
  const expandable = hasStructuredValue(input) || hasStructuredValue(output) || Boolean(diff) || Boolean(error);

  return (
    <div className="grid gap-3 text-sm text-dls-secondary">
      <DisclosureRowButton
        type="button"
        density="flush"
        className="text-dls-secondary hover:bg-transparent hover:text-dls-text disabled:cursor-default"
        aria-expanded={expandable ? expanded : undefined}
        disabled={!expandable}
        onClick={() => {
          if (!expandable) return;
          setExpanded((value) => !value);
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs font-medium text-dls-text">{title}</div>
            <div className="text-xs text-dls-secondary">{props.part.toolName}</div>
            {subtitle ? <div className="text-xs text-dls-secondary">{subtitle}</div> : null}
          </div>
          <StatusBadge tone={toolCallStatusTone(status)}>
            {status}
          </StatusBadge>
        </div>
      </DisclosureRowButton>

      {expanded ? (
        <div className="space-y-3 pl-[22px]">
          {Boolean(diff) ? (
            <div className="rounded-lg border bg-dls-surface-muted/30 p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-dls-secondary">Diff</div>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="rounded-full text-dls-text hover:bg-dls-hover"
                  onClick={() => void copyText(diff ?? "")}
                >
                  Copy
                </Button>
              </div>
              <div className="mt-2 grid gap-1 overflow-hidden rounded-md">
                {diffLines.map(({ key, line }) => (
                  <div
                    key={`${props.part.toolCallId}-diff-${key}`}
                    className={`whitespace-pre-wrap break-words px-2 py-0.5 font-mono text-xs leading-relaxed ${diffLineClass(line)}`}
                  >
                    {line || " "}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {hasStructuredValue(input) ? (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-dls-secondary">Tool request</div>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="rounded-full text-dls-text hover:bg-dls-hover"
                  onClick={() => void copyText(formatStructuredValue(input))}
                >
                  Copy
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-xl border border-dls-border/70 bg-dls-surface px-4 py-3 text-xs leading-6 text-dls-secondary">
                {formatStructuredValue(input)}
              </pre>
            </div>
          ) : null}

          {hasStructuredValue(output) && normalizeToolText(output) !== normalizeToolText(diff) ? (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-dls-secondary">{t("session.tool_result")}</div>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="rounded-full text-dls-text hover:bg-dls-hover"
                  onClick={() => void copyText(formatStructuredValue(output))}
                >
                  Copy
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-xl border border-dls-border/70 bg-dls-surface px-4 py-3 text-xs leading-6 text-dls-secondary">
                {formatStructuredValue(output)}
              </pre>
            </div>
          ) : null}

          {error ? <NoticeBox tone="error">{error}</NoticeBox> : null}

          {props.developerMode && !expandable ? (
            <pre className="overflow-x-auto rounded-xl border border-dls-border/70 bg-dls-surface px-4 py-3 text-xs leading-6 text-dls-secondary">
              {safeStringify({ input, output, error, state: props.part.state })}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
