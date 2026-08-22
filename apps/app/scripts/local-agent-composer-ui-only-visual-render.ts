import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { setLocale } from "../src/i18n";
import type { PersonalLocalAgent } from "../src/app/lib/desktop";
import { StatusToastsProvider } from "../src/react-app/domains/shell-feedback";
import { LocalAgentComposerApprovalSelect } from "../src/react-app/domains/local-agents/local-agent-composer-approval-select-view";
import { LocalAgentDraftComposer } from "../src/react-app/domains/local-agents/local-agent-draft-composer";
import { LocalAgentComposerSlashMenu } from "../src/react-app/domains/local-agents/local-agent-composer-menus-view";
import { PersonalLocalAgentModelSelector } from "../src/react-app/domains/local-agents/host/personal-local-agent-model-selector";
import { localAgentComposerClass } from "../src/react-app/domains/local-agents/local-agent-composer-layout";
import type { AcpModelInfo } from "../src/react-app/domains/local-agents/hooks/use-acp-model-info";
import { WorkspaceFootnote } from "../src/react-app/domains/local-agents/workspace-picker/workspace-footnote";

const agent = {
  id: "codex",
  name: "Codex",
  provider: "codex",
  executablePath: "codex",
  model: "gpt-5",
  customArgs: [],
  modelOptions: [],
  defaultModel: "gpt-5",
  status: "online",
  version: "1",
  error: null,
  lastCheckedAt: 1,
} as PersonalLocalAgent;

const acpModelInfo: AcpModelInfo = {
  options: [
    { id: "gpt-5", label: "GPT-5 super-long-model-name-that-must-truncate-in-the-chip" },
    { id: "gpt-4.1", label: "GPT-4.1" },
  ],
  currentModelId: "gpt-5",
  modelOptionId: "model",
  supportsModelOverride: true,
};

function modelChip(options: {
  disabled?: boolean;
  selectedModel?: string;
  acpModelInfo?: AcpModelInfo;
} = {}) {
  return createElement(StatusToastsProvider, null, createElement(PersonalLocalAgentModelSelector, {
    agent,
    selectedModel: options.selectedModel ?? "gpt-5",
    onModelChange: () => undefined,
    workspaceRoot: "/tmp/onmyagent-composer-visual",
    disabled: options.disabled ?? false,
    acpModelInfo: options.acpModelInfo ?? acpModelInfo,
  }));
}

function approvalChip(disabled = false) {
  return createElement(LocalAgentComposerApprovalSelect, {
    value: "ask",
    onChange: () => undefined,
    disabled,
  });
}

function draftToolbar() {
  return createElement(
    Fragment,
    null,
    createElement(
      "div",
      { className: "min-w-0 shrink", "data-testid": "local-agent-draft-workspace" },
      createElement(WorkspaceFootnote, {
        density: "compact",
        workspaceRoot: "/Users/huangchunan/OnMyAgent",
        recentWorkspaces: ["/Users/huangchunan/OnMyAgent"],
        onSelect: () => undefined,
        onClear: () => undefined,
        onBrowse: () => undefined,
      }),
    ),
    approvalChip(),
  );
}

function composer(overrides: Record<string, unknown> = {}) {
  return createElement(LocalAgentDraftComposer, {
    draftKey: "visual",
    workspaceRoot: "/tmp/onmyagent-composer-visual",
    initialDraft: "",
    disabled: false,
    submitting: false,
    placeholder: "Ask the local agent",
    slashCommands: [
      { name: "/review", description: "Review the diff", source: "acp", selectionBehavior: "insert" },
    ],
    onDraftCommit: () => undefined,
    onSubmit: () => undefined,
    onStop: () => undefined,
    contextUsage: { used: 3200, total: 8000, label: "3.2k / 8k" },
    toolbarRight: modelChip(),
    toolbarLeft: draftToolbar(),
    ...overrides,
  });
}

function section(id: string, child: ReactNode) {
  return createElement(
    "section",
    { id, "data-testid": id, className: "mb-6 min-w-0" },
    child,
  );
}

setLocale("zh");
process.stdout.write(renderToStaticMarkup(
  createElement(
    "div",
    { "data-testid": "local-agent-composer-ui-only-visual-fixture" },
    section("draft", composer({ initialDraft: "检查工作区" })),
    section("formal", composer({ initialDraft: "继续检查", toolbarLeft: approvalChip() })),
    section("running", composer({ submitting: true, initialDraft: "检查工作区", toolbarLeft: approvalChip() })),
    section("disabled", composer({
      disabled: true,
      initialDraft: "当前不可用",
      toolbarLeft: approvalChip(true),
      toolbarRight: modelChip({ disabled: true }),
    })),
    section("loading-model", composer({
      initialDraft: "等待模型",
      toolbarLeft: approvalChip(),
      toolbarRight: modelChip({
        selectedModel: "__loading",
        acpModelInfo: { ...acpModelInfo, options: [] },
      }),
    })),
    section("slash", createElement("div", { className: "relative min-h-40" }, createElement(LocalAgentComposerSlashMenu, {
      commands: [{ name: "/review", description: "Review the diff", source: "acp", selectionBehavior: "insert" }],
      onSelect: () => undefined,
    }))),
    section("attachment", createElement(
      "div",
      { className: localAgentComposerClass.attachmentRail },
      createElement(
        "div",
        { className: localAgentComposerClass.attachmentChip, "data-testid": "local-agent-attachment" },
        createElement("div", { className: "min-w-0 max-w-[14rem]" },
          createElement("div", { className: "truncate text-xs font-medium text-dls-text" }, "very-long-attachment-name-package.json"),
          createElement("div", { className: "truncate text-2xs text-dls-secondary" }, "apps/app/package.json"),
        ),
      ),
    )),
  ),
));
