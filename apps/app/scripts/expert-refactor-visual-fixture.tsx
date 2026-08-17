/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { UIMessage } from "ai";
import {
  AlertCircle,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  FileWarning,
  FolderOpen,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import "../src/app/index.css";
import { setLocale } from "../src/i18n";
import { Button } from "../src/components/ui/button";
import {
  EmptyStateBox,
  NoticeBox,
} from "../src/components/ui/notice-box";
import {
  IconTile,
  RailButton,
  SessionRowButton,
} from "../src/components/ui/action-row";
import { StatusBadge, StepMarker } from "../src/components/ui/status-badge";
import { cn } from "../src/lib/utils";
import { ExpertDirectoryIncompleteNotice } from "../src/react-app/domains/session/pages/expert-directory-incomplete-notice";
import { SessionTranscript } from "../src/react-app/domains/session/surface/message-list";
import { LexicalPromptEditor } from "../src/react-app/domains/session/surface/composer/editor";
import { createDefaultPlatform, PlatformProvider } from "../src/react-app/kernel/platform";

type FixtureState =
  | "empty"
  | "real-session"
  | "directory-error"
  | "missing-skill"
  | "delete-partial";

const STATE_ORDER: FixtureState[] = [
  "empty",
  "real-session",
  "directory-error",
  "missing-skill",
  "delete-partial",
];

const STATE_META: Record<FixtureState, {
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof Bot;
}> = {
  empty: {
    label: "Empty Expert",
    shortLabel: "Empty",
    description: "No Expert session selected yet.",
    icon: Bot,
  },
  "real-session": {
    label: "Real session",
    shortLabel: "Session",
    description: "Transcript and composer for a live Expert session.",
    icon: CircleDot,
  },
  "directory-error": {
    label: "Directory error",
    shortLabel: "Error",
    description: "The authoritative Expert Directory could not be read.",
    icon: FileWarning,
  },
  "missing-skill": {
    label: "Missing skill",
    shortLabel: "Skill",
    description: "The runtime is missing a declared Expert skill.",
    icon: ShieldAlert,
  },
  "delete-partial": {
    label: "Delete partial",
    shortLabel: "Delete",
    description: "A destructive delete stopped after one step failed.",
    icon: Trash2,
  },
};

const realSessionMessages: UIMessage[] = [
  {
    id: "expert-fixture-user",
    role: "user",
    parts: [{ type: "text", text: "Review this fulfillment exception and propose the next safe action." }],
  },
  {
    id: "expert-fixture-assistant",
    role: "assistant",
    parts: [{
      type: "text",
      text: "I found one blocked shipment and one missing waybill. I will keep the recommendation scoped to the current workspace and list the evidence before proposing a change.",
    }],
  },
];

function stateFromQuery(): FixtureState {
  const value = new URLSearchParams(window.location.search).get("state");
  return STATE_ORDER.includes(value as FixtureState) ? value as FixtureState : "empty";
}

function applyThemeFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const locale = params.get("lang");
  if (locale === "en" || locale === "zh" || locale === "zh-TW") {
    setLocale(locale);
    document.documentElement.lang = locale;
  }
  if (params.get("theme") === "dark") {
    document.documentElement.classList.add("dark");
    document.documentElement.dataset.theme = "dark";
  } else {
    document.documentElement.classList.remove("dark");
    document.documentElement.dataset.theme = "light";
  }
}

function updateStateQuery(state: FixtureState) {
  const url = new URL(window.location.href);
  url.searchParams.set("state", state);
  window.history.replaceState({}, "", url);
}

function FixtureRail(props: {
  state: FixtureState;
  onStateChange: (state: FixtureState) => void;
}) {
  return (
    <aside
      aria-label="Expert fixture states"
      className="flex min-h-screen w-[76px] shrink-0 flex-col items-center border-r border-dls-border/50 bg-dls-rail px-2 py-3 text-dls-text"
      data-testid="expert-fixture-rail"
    >
      <div
        className="flex size-10 items-center justify-center rounded-2xl bg-dls-text text-sm font-semibold text-dls-background shadow-sm"
        title="OnMyAgent Expert fixture"
      >
        OA
      </div>
      <nav className="mt-5 flex w-full flex-1 flex-col items-center gap-2" aria-label="Fixture state navigation">
        {STATE_ORDER.map((state) => {
          const meta = STATE_META[state];
          const Icon = meta.icon;
          return (
            <RailButton
              key={state}
              type="button"
              size="top"
              active={props.state === state}
              className="w-full"
              data-state-choice={state}
              aria-label={`Show ${meta.label}`}
              aria-pressed={props.state === state}
              onClick={() => props.onStateChange(state)}
            >
              <Icon className="size-4" />
              <span className="max-w-full truncate text-2xs leading-none">{meta.shortLabel}</span>
            </RailButton>
          );
        })}
      </nav>
      <StatusBadge tone="accent" size="tiny" shape="soft">Fixture</StatusBadge>
    </aside>
  );
}

function DirectoryPanel(props: {
  state: FixtureState;
  onStateChange: (state: FixtureState) => void;
}) {
  const selectableState = props.state === "empty" ? null : props.state;
  return (
    <aside
      aria-label="Expert Directory"
      className="flex min-h-0 w-[min(286px,30vw)] shrink-0 flex-col border-r border-dls-border bg-dls-surface"
      data-testid="expert-directory-panel"
    >
      <div className="border-b border-dls-border px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-dls-secondary">Expert Directory</p>
            <h2 className="mt-1 text-base font-semibold text-dls-text">Workspace experts</h2>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Create Expert session"
            title="Create Expert session"
            data-testid="create-expert-session"
            onClick={() => props.onStateChange("empty")}
          >
            <Plus />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {selectableState ? (
          <SessionRowButton
            type="button"
            size="expert"
            active
            aria-label="Fulfillment Expert session"
            data-testid="expert-session-row"
            onClick={() => props.onStateChange("real-session")}
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-dls-decision-soft text-dls-accent">
              <Bot className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">Fulfillment Expert</div>
              <div className="mt-1 flex items-center gap-1.5 text-2xs text-dls-secondary">
                <span className="size-1.5 rounded-full bg-dls-status-success" aria-hidden />
                <span>session_fulfillment_01</span>
              </div>
            </div>
            <StatusBadge tone="success" size="tiny">Ready</StatusBadge>
          </SessionRowButton>
        ) : (
          <EmptyStateBox size="comfortable" tone="surface" data-testid="directory-empty">
            <FolderOpen className="mx-auto mb-2 size-5 text-dls-secondary" />
            <p className="text-xs font-medium text-dls-text">No active sessions</p>
            <p className="mt-1 text-2xs leading-5">Create an Expert session to begin.</p>
          </EmptyStateBox>
        )}
        <div className="rounded-xl border border-dls-border/70 bg-dls-surface-muted/30 px-3 py-3 text-xs text-dls-secondary">
          <div className="flex items-center gap-2 font-medium text-dls-text">
            <CircleDot className="size-3.5 text-dls-accent" />
            Directory source
          </div>
          <p className="mt-1 leading-5">Server projection · revision 42</p>
        </div>
      </div>
    </aside>
  );
}

function FixtureComposer() {
  const [draft, setDraft] = useState("");
  const [lastSent, setLastSent] = useState<string | null>(null);
  const submit = () => {
    const value = draft.trim();
    if (!value) return;
    setLastSent(value);
    setDraft("");
  };
  return (
    <div className="border-t border-dls-border bg-dls-surface px-5 py-4" data-testid="expert-composer">
      <div className="mx-auto max-w-[780px] rounded-2xl border border-dls-border bg-dls-background px-4 py-3 shadow-sm focus-within:border-dls-accent/50 focus-within:ring-3 focus-within:ring-dls-accent/15">
        <LexicalPromptEditor
          sessionId="fixture-session"
          value={draft}
          mentions={{}}
          disabled={false}
          placeholder="Ask this Expert about the current workspace…"
          onChange={setDraft}
          onSubmit={submit}
          compact
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-2xs text-dls-secondary">Enter to send · Shift+Enter for a new line</span>
          <Button
            type="button"
            size="sm"
            aria-label="Send Expert prompt"
            data-testid="send-expert-prompt"
            disabled={!draft.trim()}
            onClick={submit}
          >
            <Send data-icon="inline-start" />
            Send
          </Button>
        </div>
      </div>
      {lastSent ? (
        <p className="mx-auto mt-2 max-w-[780px] text-2xs text-dls-secondary" data-testid="sent-prompt">
          Sent fixture prompt: <span className="text-dls-text">{lastSent}</span>
        </p>
      ) : null}
    </div>
  );
}

function EmptyExpertSurface(props: { onCreate: () => void }) {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-14" data-state-surface="empty">
      <EmptyStateBox size="spacious" tone="surface" className="w-full max-w-xl">
        <IconTile size="2xl" shape="xl" tone="accent" border className="mx-auto">
          <Bot className="size-8" />
        </IconTile>
        <h2 className="mt-6 text-xl font-semibold text-dls-text">Start with an Expert</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-dls-secondary">
          Select a session from the directory or create a fresh Expert workspace to get started.
        </p>
        <Button type="button" className="mt-6" onClick={props.onCreate} data-testid="empty-create-expert">
          <Plus data-icon="inline-start" />
          Create Expert session
        </Button>
      </EmptyStateBox>
    </div>
  );
}

function RealSessionSurface() {
  return (
    <div className="flex min-h-full flex-col" data-state-surface="real-session">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6">
        <div className="mx-auto mb-5 flex w-full max-w-[780px] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <IconTile size="md" shape="lg" tone="accent"><Bot className="size-5" /></IconTile>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-dls-text">Fulfillment Expert</h2>
              <p className="mt-1 text-xs text-dls-secondary">Real session · workspace-scoped runtime</p>
            </div>
          </div>
          <StatusBadge tone="success" size="sm"><span className="size-1.5 rounded-full bg-current" aria-hidden /> Connected</StatusBadge>
        </div>
        <div className="mx-auto w-full max-w-[780px] rounded-2xl border border-dls-border/70 bg-dls-surface p-4 shadow-sm">
          <SessionTranscript
            messages={realSessionMessages}
            isStreaming={false}
            developerMode={false}
            showThinking={false}
            virtualization="disabled"
            assistantAvatar={{ name: "Fulfillment Expert", avatarUrl: null }}
          />
        </div>
        <div className="mx-auto mt-4 flex w-full max-w-[780px] items-center gap-2 rounded-xl border border-dls-border/70 bg-dls-surface-muted/40 px-3 py-2 text-xs text-dls-secondary">
          <Check className="size-3.5 text-dls-status-success-fg" />
          Runtime contract verified · skills 3/3 · directory revision 42
        </div>
      </div>
      <FixtureComposer />
    </div>
  );
}

function DirectoryErrorSurface(props: { onRetry: () => void }) {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-14" data-state-surface="directory-error">
      <div className="w-full max-w-xl space-y-4">
        <NoticeBox tone="error" size="comfortable" className="shadow-sm" role="alert">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 shrink-0" />
            <div>
              <h2 className="font-semibold text-dls-status-danger-fg">Expert Directory unavailable</h2>
              <p className="mt-2 leading-6">The server could not read the authoritative workspace projection. Existing sessions stay hidden until the directory is healthy.</p>
              <p className="mt-2 font-mono text-xs opacity-80">inventory_unavailable · revision unknown</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={props.onRetry} data-testid="directory-retry">
              <RefreshCw data-icon="inline-start" /> Retry directory fetch
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => undefined}>View diagnostics</Button>
          </div>
        </NoticeBox>
        <ExpertDirectoryIncompleteNotice />
      </div>
    </div>
  );
}

function MissingSkillSurface(props: { onRepair: () => void }) {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-14" data-state-surface="missing-skill">
      <div className="w-full max-w-xl space-y-4">
        <NoticeBox tone="warning" size="comfortable" className="shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0" />
            <div className="min-w-0">
              <h2 className="font-semibold">Runtime needs a repair</h2>
              <p className="mt-2 leading-6">The Expert declaration is valid, but two skill folders were not materialized into the isolated runtime.</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <StatusBadge tone="warning" size="tiny" shape="soft">declared 4</StatusBadge>
                <StatusBadge tone="danger" size="tiny" shape="soft">missing 2</StatusBadge>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={props.onRepair} data-testid="repair-skills">
              <RefreshCw data-icon="inline-start" /> Repair skills
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => undefined}>Open directory details</Button>
          </div>
        </NoticeBox>
      </div>
    </div>
  );
}

function DeletePartialSurface(props: { onRetry: () => void }) {
  const steps = [
    { label: "OpenCode session", state: "completed", detail: "removed" },
    { label: "Runtime directory", state: "failed", detail: "runtime_delete_failed" },
    { label: "Origin tombstone", state: "pending", detail: "waiting for retry" },
  ] as const;
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-14" data-state-surface="delete-partial">
      <div className="w-full max-w-xl space-y-4">
        <NoticeBox tone="error" size="comfortable" className="shadow-sm" role="alert">
          <div className="flex items-start gap-3">
            <Trash2 className="mt-0.5 size-5 shrink-0" />
            <div>
              <h2 className="font-semibold">Expert deletion needs attention</h2>
              <p className="mt-2 leading-6">Fulfillment Expert was only partially deleted. The origin remains visible until the runtime directory can be removed safely.</p>
              <p className="mt-2 font-mono text-xs opacity-80">operation delete_fixture_01 · state partial</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="destructive" size="sm" onClick={props.onRetry} data-testid="retry-delete">
              <RefreshCw data-icon="inline-start" /> Retry deletion
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => undefined}>Keep session</Button>
          </div>
        </NoticeBox>
        <div className="rounded-2xl border border-dls-border bg-dls-surface p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Delete progress</h3>
            <StatusBadge tone="danger" size="sm">Partial</StatusBadge>
          </div>
          <ol className="space-y-3" aria-label="Delete progress steps">
            {steps.map((step, index) => (
              <li key={step.label} className="flex items-start gap-3">
                <StepMarker size="sm" className={cn(
                  step.state === "completed" && "bg-dls-status-success-soft text-dls-status-success-fg",
                  step.state === "failed" && "bg-dls-status-danger-soft text-dls-status-danger-fg",
                )}>
                  {step.state === "completed" ? <Check className="size-3" /> : index + 1}
                </StepMarker>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{step.label}</span>
                    <StatusBadge tone={step.state === "completed" ? "success" : step.state === "failed" ? "danger" : "neutral"} size="tiny" shape="soft">
                      {step.state}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 font-mono text-2xs text-dls-secondary">{step.detail}</p>
                </div>
                {index < steps.length - 1 ? <ChevronRight className="mt-1 size-3.5 rotate-90 text-dls-secondary" aria-hidden /> : null}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function StateSurface(props: {
  state: FixtureState;
  onStateChange: (state: FixtureState) => void;
}) {
  switch (props.state) {
    case "empty":
      return <EmptyExpertSurface onCreate={() => props.onStateChange("real-session")} />;
    case "real-session":
      return <RealSessionSurface />;
    case "directory-error":
      return <DirectoryErrorSurface onRetry={() => props.onStateChange("real-session")} />;
    case "missing-skill":
      return <MissingSkillSurface onRepair={() => props.onStateChange("real-session")} />;
    case "delete-partial":
      return <DeletePartialSurface onRetry={() => props.onStateChange("real-session")} />;
  }
}

function FixtureApp() {
  const [state, setState] = useState<FixtureState>(() => stateFromQuery());
  const meta = STATE_META[state];
  const theme = document.documentElement.dataset.theme === "dark" ? "Dark" : "Light";
  const onStateChange = (next: FixtureState) => {
    updateStateQuery(next);
    setState(next);
  };
  const sourceNote = useMemo(
    () => "Mock shell only: production ExpertPage requires session-route providers. Production SessionTranscript, Directory notices, DLS buttons, rows, badges, and editor render unchanged below.",
    [],
  );

  return (
    <main
      className="min-h-screen bg-dls-background text-dls-text"
      data-expert-fixture="true"
      data-fixture-state={state}
      data-fixture-theme={theme.toLowerCase()}
    >
      <div className="flex min-h-screen">
        <FixtureRail state={state} onStateChange={onStateChange} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-[74px] items-center justify-between gap-4 border-b border-dls-border bg-dls-surface/80 px-6 py-4 backdrop-blur-sm">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-dls-secondary">Expert surface fixture</p>
                <StatusBadge tone="accent" size="tiny" shape="soft">{theme}</StatusBadge>
              </div>
              <h1 className="mt-1 truncate text-xl font-semibold tracking-tight">{meta.label}</h1>
              <p className="mt-1 truncate text-xs text-dls-secondary">{meta.description}</p>
            </div>
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              <StatusBadge tone="surface" size="sm">workspace: fixture</StatusBadge>
              <StatusBadge tone={state === "directory-error" || state === "delete-partial" ? "danger" : state === "missing-skill" ? "warning" : "success"} size="sm">
                {state === "directory-error" ? "Incomplete" : state === "delete-partial" ? "Partial" : state === "missing-skill" ? "Needs repair" : "Ready"}
              </StatusBadge>
            </div>
          </header>
          <p className="border-b border-dls-border/60 bg-dls-surface-muted/20 px-6 py-2 text-2xs text-dls-secondary" data-testid="fixture-source-note">
            {sourceNote}
          </p>
          <div className="flex min-h-0 flex-1">
            <DirectoryPanel state={state} onStateChange={onStateChange} />
            <section className="min-w-0 flex-1 overflow-y-auto bg-dls-background" aria-label={`${meta.label} surface`}>
              <StateSurface state={state} onStateChange={onStateChange} />
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

applyThemeFromQuery();
const root = document.getElementById("root");
if (!root) throw new Error("Missing Expert refactor fixture root");

createRoot(root).render(
  <PlatformProvider value={createDefaultPlatform()}>
    <FixtureApp />
  </PlatformProvider>,
);
