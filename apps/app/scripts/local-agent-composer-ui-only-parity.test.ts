import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { setLocale } from "../src/i18n";
import { StatusToastsProvider } from "../src/react-app/domains/shell-feedback";
import { LocalAgentComposerApprovalSelect } from "../src/react-app/domains/local-agents/local-agent-composer-approval-select-view";
import { LocalAgentDraftComposer } from "../src/react-app/domains/local-agents/local-agent-draft-composer";
import { LocalAgentComposerSlashMenu } from "../src/react-app/domains/local-agents/local-agent-composer-menus-view";
import { PersonalLocalAgentModelSelector } from "../src/react-app/domains/local-agents/host/personal-local-agent-model-selector";
import type { PersonalLocalAgent } from "../src/app/lib/desktop";
import type { AcpModelInfo } from "../src/react-app/domains/local-agents/hooks/use-acp-model-info";

const repoRoot = join(import.meta.dir, "../../..");

function read(rel: string) {
  return readFileSync(join(repoRoot, rel), "utf8");
}

const composerSrc = read("apps/app/src/react-app/domains/local-agents/local-agent-draft-composer.tsx");
const pageSrc = read("apps/app/src/react-app/domains/local-agents/host/personal-local-agent-page-sections.tsx");
const selectorSrc = read("apps/app/src/react-app/domains/local-agents/host/personal-local-agent-model-selector.tsx");
const approvalSrc = read("apps/app/src/react-app/domains/local-agents/local-agent-composer-approval-select-view.tsx");

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

function composer(overrides: Record<string, unknown> = {}) {
  return createElement(LocalAgentDraftComposer, {
    draftKey: "parity",
    workspaceRoot: "/tmp/onmyagent-composer-parity",
    initialDraft: "hello",
    disabled: false,
    submitting: false,
    placeholder: "Ask the local agent",
    slashCommands: [],
    onDraftCommit: () => undefined,
    onSubmit: () => undefined,
    onStop: () => undefined,
    contextUsage: { used: 1200, total: 8000, label: "1.2k / 8k" },
    toolbarRight: createElement(StatusToastsProvider, null, createElement(PersonalLocalAgentModelSelector, {
      agent,
      selectedModel: "gpt-5",
      onModelChange: () => undefined,
      workspaceRoot: "/tmp",
      disabled: false,
      acpModelInfo,
    })),
    toolbarLeft: createElement(
      "div",
      { className: "contents" },
      createElement("div", { "data-testid": "local-agent-draft-workspace" }, "OnMyAgent"),
      createElement(LocalAgentComposerApprovalSelect, {
        value: "ask",
        onChange: () => undefined,
      }),
    ),
    ...overrides,
  });
}

function approvalOnly() {
  return createElement(LocalAgentComposerApprovalSelect, {
    value: "ask",
    onChange: () => undefined,
  });
}

describe("Local Agent composer UI-only parity", () => {
  test("keeps ACP model mutation, cancelRun, and submit owners", () => {
    expect(selectorSrc).toContain("personalLocalAgentSetAcpConfigOption");
    expect(selectorSrc).toContain("SelectMenu");
    expect(selectorSrc).not.toContain("ModelSelectContainer");
    expect(pageSrc).toContain("onModelChange={setSelectedModel}");
    expect(pageSrc).toContain("onStop={() => { void cancelRun(); }}");
    expect(pageSrc).toContain("void submitComposerPayload(payload)");
    expect(pageSrc).toContain("toolbarRight=");
    expect(pageSrc).toContain("toolbarLeft=");
    expect(pageSrc).toContain("PersonalLocalAgentModelSelector");
    expect(pageSrc).not.toContain("CircleStop");
    expect(composerSrc).toContain("onClick={submit}");
    expect(composerSrc).toContain("onClick={props.onStop}");
    expect(composerSrc).toContain("data-testid=\"local-agent-composer-stop\"");
    expect(composerSrc).not.toContain("loading={props.submitting}");
    expect(pageSrc).toContain("local-agent-conversation-control");
    expect(pageSrc).toContain("local-agent-scheduled-tasks-button");
    expect(pageSrc).toContain("local-agent-new-conversation");
    expect(approvalSrc).toContain("DropdownMenuRadioGroup");
    expect(approvalSrc).toContain("DropdownMenuRadioItem");
    expect(approvalSrc).toContain("DropdownMenuTrigger");
    expect(approvalSrc).not.toContain('role="menu"');
    expect(approvalSrc).not.toContain("window.addEventListener");
    expect(pageSrc).not.toContain("focus-visible:!ring-0");
  });

  test("moves the model selector out of the header into the composer trailing cluster", () => {
    const headerJsx = pageSrc.slice(pageSrc.indexOf("return ("), pageSrc.indexOf("<LocalAgentDraftComposer"));
    const composerBlock = pageSrc.slice(pageSrc.indexOf("<LocalAgentDraftComposer"));
    expect(headerJsx).not.toContain("<PersonalLocalAgentModelSelector");
    expect(composerBlock).toContain("<PersonalLocalAgentModelSelector");
    expect(composerBlock).toContain("supportsModelOverride");
    expect(composerSrc).toContain("trailingCluster");
    expect(composerSrc).toContain("props.toolbarRight");
    expect(composerSrc).toContain("localAgentComposerClass.attachmentChip");
  });

  test("draft render keeps workspace, approval, SendButton, and the ACP model chip on one surface", () => {
    setLocale("en");
    const html = renderToStaticMarkup(composer());
    expect(html).toContain('data-testid="local-agent-model-selector"');
    expect(html).toContain("GPT-5 super-long-model-name-that-must-truncate-in-the-chip");
    expect(html).toContain('data-local-agent-composer="true"');
    expect(html).toContain('data-testid="local-agent-draft-workspace"');
    expect(html).toContain('data-testid="local-agent-composer-approval"');
    expect(html).not.toContain("data-local-agent-composer-footer");
    expect(html).not.toContain('data-testid="local-agent-composer-stop"');
    expect(html).toContain("Ask the local agent");
  });

  test("formal conversation render removes workspace while keeping approval in the action row", () => {
    setLocale("en");
    const html = renderToStaticMarkup(composer({ toolbarLeft: approvalOnly() }));
    expect(html).not.toContain('data-testid="local-agent-draft-workspace"');
    expect(html).toContain('data-testid="local-agent-composer-approval"');
    expect(html).not.toContain("data-local-agent-composer-footer");
    expect(pageSrc).toContain("{!isChannelView && chipEditable ? (");
    expect(pageSrc).toContain("<WorkspaceFootnote");
    expect(pageSrc).toContain("<LocalAgentComposerApprovalSelect");
    expect(pageSrc).toContain("onChange={setApprovalMode}");
    expect(pageSrc).not.toContain("bottomAccessory=");
    expect(pageSrc).not.toContain("readOnly={!chipEditable}");
  });

  test("running render replaces send with a single stop control", () => {
    setLocale("en");
    const html = renderToStaticMarkup(composer({ submitting: true }));
    expect(html).toContain('data-testid="local-agent-composer-stop"');
    expect(html).not.toContain('data-testid="local-agent-send"');
    expect(html.match(/data-testid="local-agent-composer-stop"/g)?.length).toBe(1);
  });

  test("slash menu keeps ACP/builtin badges and selection hooks", () => {
    setLocale("en");
    const html = renderToStaticMarkup(createElement(LocalAgentComposerSlashMenu, {
      commands: [
        { name: "/review", description: "Review the diff", source: "acp", selectionBehavior: "insert" },
        { name: "/init", description: "Builtin init", source: "builtin", selectionBehavior: "execute" },
      ],
      onSelect: () => undefined,
    }));
    expect(html).toContain('data-testid="local-agent-slash-menu"');
    expect(html).toContain("ACP");
    expect(html).toContain("/review");
    expect(html).toContain("/init");
    expect(composerSrc).toContain("LocalAgentComposerSlashMenu");
    expect(composerSrc).toContain("selectSlashCommand");
  });

  test("does not add reference-only mode/reasoning/skills/mcp controls", () => {
    expect(composerSrc).not.toContain("ModelBehaviorSelect");
    expect(composerSrc).not.toContain("AccessPermissionSelect");
    expect(composerSrc).not.toContain("LexicalPromptEditor");
    expect(pageSrc).not.toContain("ModelSelectContainer");
    expect(pageSrc).not.toContain("modelVariant");
  });

  test("approval chooser copies the reference menu anatomy without changing local approval values", () => {
    expect(approvalSrc).toContain("DropdownMenuRadioItem");
    expect(approvalSrc).toContain("APPROVAL_MODE_OPTIONS.map");
    expect(approvalSrc).toContain('option.id === "auto"');
    expect(approvalSrc).toContain('option.id === "read-only-auto"');
    expect(approvalSrc).toContain("props.onChange(option.id)");
  });
});
