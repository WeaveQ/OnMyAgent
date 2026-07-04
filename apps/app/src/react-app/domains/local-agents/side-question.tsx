import { useState } from "react";
import { Loader2, MessageSquarePlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { MarkdownBlock } from "../session/surface/markdown";

export function agentSupportsSideQuestion(agent: { behavior_policy?: { supports_side_question?: boolean } | null; capability?: { supportsAcp?: boolean } | null; agent_type?: string | null; status?: string | null } | null | undefined) {
  if (!agent) return false;
  if (agent.behavior_policy?.supports_side_question === true) return true;
  return Boolean(agent.capability?.supportsAcp || agent.agent_type === "acp");
}

export type BtwOverlayResult = {
  question: string;
  answer: string;
  loading: boolean;
  error?: string | null;
};
export type BtwOverlaySubmitResult = { answer?: string | null; error?: string | null } | void;

export function BtwOverlay(props: { disabled?: boolean; submitting?: boolean; result?: BtwOverlayResult | null; onDismissResult?: () => void; onSubmit: (prompt: string) => BtwOverlaySubmitResult | Promise<BtwOverlaySubmitResult>; }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [localResult, setLocalResult] = useState<BtwOverlayResult | null>(null);
  const submit = async () => {
    const domValue = typeof document === "undefined" ? "" : (document.querySelector<HTMLTextAreaElement>('[data-testid="local-agent-btw-input"]')?.value ?? "");
    const value = (domValue || prompt).trim();
    if (!value) return;
    setPrompt("");
    setOpen(false);
    setLocalResult({ question: value, answer: "", loading: true, error: null });
    try {
      const next = await props.onSubmit(value);
      const nextResult = next && typeof next === "object" ? next : null;
      setLocalResult({ question: value, answer: nextResult?.answer ?? "", loading: false, error: nextResult?.error ?? null });
    } catch (error) {
      setLocalResult({ question: value, answer: "", loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const result = props.result ?? localResult;
  const dismissResult = props.onDismissResult ?? (() => setLocalResult(null));
  const resultOverlay = result ? (
    <div className="fixed inset-0 z-50" data-testid="local-agent-btw-result-overlay">
      <button type="button" className="absolute inset-0 cursor-default bg-dls-background/35" aria-label={t("common.close")} onClick={dismissResult} />
      <div className="absolute left-1/2 top-20 flex max-h-[calc(100vh-10rem)] w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-dls-border bg-dls-surface shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-dls-border px-4 py-3">
          <div className="min-w-0"><div className="text-xs font-medium uppercase tracking-[0.08em] text-dls-secondary">{t("local_agent.btw")}</div><div className="mt-0.5 truncate text-sm font-medium text-dls-text">{result.question}</div></div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={dismissResult} aria-label={t("common.close")} data-testid="local-agent-btw-result-dismiss"><X className="size-4" /></Button>
        </div>
        <div className="min-h-0 overflow-y-auto px-4 py-4">
          <div className="flex justify-end"><div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-dls-accent/10 px-3 py-2 text-sm leading-6 text-dls-text" data-testid="local-agent-btw-result-question">{result.question}</div></div>
          <div className="mt-3 flex justify-start"><div className="max-w-[85%] rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2 text-sm leading-6 text-dls-text" data-testid="local-agent-btw-result-answer">{result.loading ? <div className="flex items-center gap-2 text-dls-secondary"><Loader2 className="size-4 animate-spin text-dls-accent" />{t("local_agent.btw_loading")}</div> : result.error ? <div className="text-dls-status-danger-fg">{result.error}</div> : <MarkdownBlock text={result.answer || t("local_agent.btw_no_answer")} />}</div></div>
        </div>
        <div className="border-t border-dls-border px-4 py-2 text-xs text-dls-secondary">{t("local_agent.btw_dismiss_hint")}</div>
      </div>
    </div>
  ) : null;
  if (!open) {
    return (
      <>
        <Button type="button" variant="outline" size="sm" disabled={props.disabled} onClick={() => setOpen(true)} data-testid="local-agent-btw-open">
          <MessageSquarePlus className="mr-1.5 size-3.5" />{t("local_agent.btw")}
        </Button>
        {resultOverlay}
      </>
    );
  }
  return (
    <><form className="rounded-lg border border-dls-border bg-dls-surface-muted p-3" data-testid="local-agent-btw-overlay" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-dls-text">{t("local_agent.btw")}</div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => setOpen(false)} aria-label={t("common.close")}><X className="size-3.5" /></Button>
      </div>
      <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t("local_agent.btw_placeholder")} rows={2} className="min-h-16 resize-none text-sm" data-testid="local-agent-btw-input" />
      <div className="mt-2 flex justify-end">
        <button type="button" disabled={props.submitting} data-testid="local-agent-btw-send" onMouseDown={(event) => { event.preventDefault(); submit(); }} onClick={submit} className="inline-flex h-8 items-center justify-center rounded-md bg-dls-accent px-3 text-sm font-medium text-dls-accent-foreground hover:bg-dls-accent/90 disabled:opacity-50">
          {t("local_agent.btw_send")}
        </button>
      </div>
    </form>{resultOverlay}</>
  );
}
