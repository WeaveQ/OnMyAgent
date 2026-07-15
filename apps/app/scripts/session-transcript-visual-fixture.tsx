/** @jsxImportSource react */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChevronDown, FilePenLine, Search, Terminal } from "lucide-react";
import type { UIMessage } from "ai";

import "../src/app/index.css";
import {
  ImageGenerationToolCard,
  SpecializedToolDetails,
  specializedToolHeadline,
} from "../src/react-app/domains/session/surface/specialized-tool-details";
import { Button } from "../src/components/ui/button";
import { TranscriptResourceChip } from "../src/react-app/domains/session/surface/transcript-resource-chip";
import { SessionTranscript } from "../src/react-app/domains/session/surface/message-list";
import { createTranscriptMessageMetadata } from "../src/react-app/domains/session/sync/message-metadata";
import {
  buildTranscriptToolPresentation,
  type TranscriptSpecializedToolDetails,
} from "../src/react-app/domains/session/surface/transcript/tool-presentation";
import {
  createDefaultPlatform,
  PlatformProvider,
} from "../src/react-app/kernel/platform";

if (new URLSearchParams(window.location.search).get("theme") === "dark") {
  document.documentElement.classList.add("dark");
  document.documentElement.dataset.theme = "dark";
}

const generatedImage = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
    <defs>
      <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#1e293b" />
        <stop offset="1" stop-color="#2563eb" />
      </linearGradient>
    </defs>
    <rect width="960" height="540" rx="24" fill="url(#background)" />
    <circle cx="760" cy="130" r="72" fill="#93c5fd" opacity="0.75" />
    <path d="M120 430 L330 220 L470 360 L600 250 L840 430 Z" fill="#e2e8f0" opacity="0.86" />
    <text x="52" y="72" fill="white" font-family="sans-serif" font-size="32">WorkBuddy image result</text>
  </svg>
`)}`;

function detailsFor(input: Parameters<typeof buildTranscriptToolPresentation>[0]) {
  const details = buildTranscriptToolPresentation(input).details;
  if (!details) throw new Error(`Missing fixture details for ${input.toolName}`);
  return details;
}

const commandDetails = detailsFor({
  toolName: "execute_command",
  toolInput: { command: "pnpm task check app", description: "Check the app types" },
  toolOutput: { result: { stdout: "Checking app...\nTypecheck passed", exit_code: 0 } },
});

const writeDetails = detailsFor({
  toolName: "replace_in_file",
  toolInput: {
    filePath: "apps/app/src/message-list.tsx",
    old_str: "const width = 720;\nconst gap = 16;\nrender(width, gap);",
    new_str: "const width = 760;\nconst gap = 16;\nrender(width, gap);",
  },
  toolOutput: { result: { addLineCount: 1, removedLines: 1 } },
});

const multiEditDetails = detailsFor({
  toolName: "multi_edit",
  toolInput: {
    filePath: "apps/app/src/session.ts",
    edits: [
      { oldString: "compact: false", newString: "compact: true" },
      { oldString: "limit: 20", newString: "limit: 50" },
    ],
  },
  toolOutput: { result: {} },
});

const listDetails = detailsFor({
  toolName: "list_dir",
  toolInput: { directory: "apps/app/src" },
  toolOutput: {
    result: {
      path: "apps/app/src",
      files: [
        "apps/app/src/components/",
        "apps/app/src/react-app/",
        "apps/app/src/app.tsx",
      ],
    },
  },
});

const searchDetails = detailsFor({
  toolName: "search_content",
  toolInput: { query: "StepRow", directory: "apps/app/src" },
  toolOutput: {
    result: {
      matches: [
        { path: "apps/app/src/react-app/domains/session/surface/message-list.tsx", startLine: 1454, endLine: 1619 },
        { path: "apps/app/src/react-app/domains/session/surface/transcript/tool-presentation.ts", matches: 3, line: 0, endLine: 0 },
      ],
    },
  },
});

const referenceDetails = detailsFor({
  toolName: "codebase_search",
  toolInput: { query: "transcript renderer" },
  toolOutput: {
    result: {
      "0": {
        metadata: {
          file_name: "message-list.tsx",
          source: "apps/app/src/react-app/domains/session/surface/message-list.tsx",
          source_type: "code",
          start_pos: 1454,
          end_pos: 1619,
        },
        chunk: "function StepRow(props) {\n  return <div>{props.part.type}</div>;\n}",
      },
      "1": {
        metadata: {
          file_name: "WorkBuddy renderer docs",
          source: "https://example.com/workbuddy-renderer",
        },
        chunk: "External reference",
      },
    },
  },
});

const cancelledReasoningMessages: UIMessage[] = [
  {
    id: "reasoning-user-cancelled",
    role: "user",
    parts: [{ type: "text", text: "Compare the transcript behavior with WorkBuddy." }],
  },
  {
    id: "reasoning-assistant-cancelled",
    role: "assistant",
    metadata: createTranscriptMessageMetadata({
      time: { created: 1_000, completed: 8_000 },
      error: { name: "MessageAbortedError" },
    }),
    parts: [
      {
        type: "reasoning",
        text: "### Inspection\n\n- Read the renderer registry\n- Compare the cancellation state\n\n`reasoning` remains Markdown.",
      },
      { type: "text", text: "The inspection stopped before the final comparison." },
    ],
  },
];

const streamingReasoningText = `### Live inspection

The active reasoning block follows new Markdown content while expanded.

1. Live detail 1
2. Live detail 2
3. Live detail 3
4. Live detail 4
5. Live detail 5
6. Live detail 6
7. Live detail 7
8. Live detail 8
9. Live detail 9
10. Live detail 10
11. Live detail 11
12. Live detail 12
13. Live detail 13
14. Live detail 14
15. Live detail 15
16. Live detail 16
17. Live detail 17
18. Live detail 18
19. Live detail 19
20. Live detail 20
21. Live detail 21
22. Live detail 22
23. Live detail 23
24. Live detail 24`;

function reasoningMessages(growthCount: number): UIMessage[] {
  const growth = Array.from(
    { length: growthCount },
    (_, index) => `${25 + index}. Streaming growth ${index + 1}`,
  ).join("\n");
  return [
    {
      id: "reasoning-user-streaming",
      role: "user",
      parts: [{ type: "text", text: "Continue inspecting the streaming state." }],
    },
    {
      id: "reasoning-assistant-streaming",
      role: "assistant",
      parts: [{
        type: "reasoning",
        text: growth ? `${streamingReasoningText}\n${growth}` : streamingReasoningText,
      }],
    },
  ];
}

const compactToolMessages: UIMessage[] = [
  {
    id: "compact-tools-user",
    role: "user",
    parts: [{ type: "text", text: "Use memory, MCP, and a skill to finish the report." }],
  },
  {
    id: "compact-tools-assistant",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName: "update_memory",
        toolCallId: "memory-1",
        state: "output-available",
        input: {
          action: "update",
          title: "Report preference",
          knowledge_to_store: "Keep the executive summary concise.",
        },
        output: { result: { success: true } },
      },
      {
        type: "dynamic-tool",
        toolName: "mcp_call_tool",
        toolCallId: "mcp-1",
        state: "output-available",
        input: {
          serverName: "Drive",
          toolName: "search_files",
          arguments: '{"query":"quarterly report"}',
          mcpProgress: { progress: 2, total: 2, message: "Complete" },
        },
        output: {
          result: {
            data: [
              { type: "text", text: "Found quarterly-report.md" },
              { type: "resource", resource: { uri: "drive://quarterly-report", text: "Quarterly report resource" } },
            ],
          },
        },
      },
      {
        type: "dynamic-tool",
        toolName: "use_skill",
        toolCallId: "skill-1",
        state: "output-available",
        input: { command: "executive-writing" },
        output: { result: { success: true } },
      },
      { type: "text", text: "The report sources and writing guidance are ready." },
    ],
  },
];

function ToolFixture(props: {
  details: TranscriptSpecializedToolDetails;
  icon: typeof Terminal;
}) {
  const [expanded, setExpanded] = useState(true);
  const Icon = props.icon;
  return (
    <div className="text-sm text-dls-text">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto w-full justify-start gap-3 px-0 py-1 font-normal text-dls-secondary hover:bg-transparent hover:text-dls-text"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">
          {specializedToolHeadline(props.details, false)}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
          aria-hidden="true"
        />
      </Button>
      {expanded ? (
        <div className="ml-7 mt-2">
          <SpecializedToolDetails
            details={props.details}
            onOpenCodePath={(path) => document.body.dataset.lastOpenedPath = path}
          />
        </div>
      ) : null}
    </div>
  );
}

function Fixture() {
  const [completedExpanded, setCompletedExpanded] = useState(true);
  const [generatingExpanded, setGeneratingExpanded] = useState(true);
  const [errorExpanded, setErrorExpanded] = useState(true);
  const [streamingGrowthCount, setStreamingGrowthCount] = useState(0);

  return (
    <main className="h-screen overflow-y-auto bg-dls-background px-10 py-8 text-dls-text">
      <div className="mx-auto max-w-[760px] space-y-8">
        <section className="space-y-3">
          <div className="flex justify-end">
            <div className="max-w-[70%] rounded-xl bg-dls-chat-user-bg px-4 py-3">
              <div className="mb-2 flex flex-wrap justify-end gap-2">
                <TranscriptResourceChip
                  filename="reference.pdf"
                  url="data:application/pdf;base64,"
                  mediaType="application/pdf"
                />
                <TranscriptResourceChip
                  filename="moodboard.png"
                  url={generatedImage}
                  mediaType="image/png"
                />
              </div>
              <p className="text-sm leading-6">Create an image from these references.</p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <ImageGenerationToolCard
            details={{
              kind: "image-gen",
              prompt: "A quiet workspace at night with layered blue mountains",
              status: "completed",
              images: [{ url: generatedImage, base64: null, localPath: null }],
              errorMessage: null,
            }}
            running={false}
            expanded={completedExpanded}
            onToggle={() => setCompletedExpanded((value) => !value)}
          />
          <ImageGenerationToolCard
            details={{
              kind: "image-gen",
              prompt: "A product illustration still being rendered",
              status: "generating",
              images: [],
              errorMessage: null,
            }}
            running
            expanded={generatingExpanded}
            onToggle={() => setGeneratingExpanded((value) => !value)}
          />
          <ImageGenerationToolCard
            details={{
              kind: "image-gen",
              prompt: "A failed provider request",
              status: "error",
              images: [],
              errorMessage: "Provider unavailable",
            }}
            running={false}
            expanded={errorExpanded}
            onToggle={() => setErrorExpanded((value) => !value)}
          />
        </section>

        <section className="space-y-5">
          <ToolFixture details={commandDetails} icon={Terminal} />
          <ToolFixture details={writeDetails} icon={FilePenLine} />
          <ToolFixture details={multiEditDetails} icon={FilePenLine} />
          <ToolFixture details={listDetails} icon={Search} />
          <ToolFixture details={searchDetails} icon={Search} />
          <ToolFixture details={referenceDetails} icon={Search} />
        </section>

        <section className="space-y-8 border-t border-dls-border pt-8">
          <SessionTranscript
            messages={compactToolMessages}
            isStreaming={false}
            developerMode={false}
            showThinking={true}
            assistantAvatar={{ name: "WorkBuddy", avatarUrl: null }}
          />
          <SessionTranscript
            messages={cancelledReasoningMessages}
            isStreaming={false}
            developerMode={false}
            showThinking={true}
            assistantAvatar={{ name: "WorkBuddy", avatarUrl: null }}
          />
          <SessionTranscript
            messages={reasoningMessages(streamingGrowthCount)}
            isStreaming={true}
            developerMode={false}
            showThinking={true}
            assistantAvatar={{ name: "WorkBuddy", avatarUrl: null }}
          />
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setStreamingGrowthCount((count) => count + 1)}
          >
            Append streaming reasoning
          </Button>
        </section>
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");

createRoot(root).render(
  <PlatformProvider value={createDefaultPlatform()}>
    <Fixture />
  </PlatformProvider>,
);
