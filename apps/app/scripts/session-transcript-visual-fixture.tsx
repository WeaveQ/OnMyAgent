/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChevronDown, FilePenLine, Search, Terminal } from "lucide-react";
import type { UIMessage } from "ai";

import "../src/app/index.css";
import {
  ImageGenerationToolCard,
  SpecializedToolDetails,
  specializedToolHeadline,
} from "../src/react-app/domains/session/surface/specialized-tool-details";
import { Button } from "../src/components/ui/button";
import { setLocale } from "../src/i18n";
import { TranscriptResourceChip } from "../src/react-app/domains/session/surface/transcript-resource-chip";
import { SessionTranscript } from "../src/react-app/domains/session/surface/message-list";
import { useSessionScrollController } from "../src/react-app/domains/session/surface/scroll-controller";
import {
  AssistantWaitingCard,
  OutputLimitContinueCard,
} from "../src/react-app/domains/session/surface/chrome/assistant-status";
import { TranscriptScrollToLatest } from "../src/react-app/domains/session/surface/chrome/transcript-scroll-to-latest";
import { createTranscriptMessageMetadata } from "../src/react-app/domains/session/sync/message-metadata";
import {
  buildTranscriptToolPresentation,
  type TranscriptSpecializedToolDetails,
} from "../src/react-app/domains/session/surface/transcript/tool-presentation";
import {
  createDefaultPlatform,
  PlatformProvider,
} from "../src/react-app/kernel/platform";

declare global {
  interface Window {
    __sessionTranscriptFixtureRoot?: Root;
  }
}

if (new URLSearchParams(window.location.search).get("theme") === "dark") {
  document.documentElement.classList.add("dark");
  document.documentElement.dataset.theme = "dark";
}

const entryParam = new URLSearchParams(window.location.search).get("entry");
const sceneParam = new URLSearchParams(window.location.search).get("scene");
const languageParam = new URLSearchParams(window.location.search).get("lang");
const showActivityFooter = new URLSearchParams(window.location.search).get("activity") === "true";
if (languageParam === "zh" || languageParam === "zh-TW" || languageParam === "en") {
  setLocale(languageParam);
}
const fixtureEntry = entryParam === "code" || entryParam === "expert" ? entryParam : "office";
const fixtureAssistant = fixtureEntry === "code"
  ? { name: "Code Assistant", avatarUrl: null }
  : fixtureEntry === "expert"
    ? { name: "Expert", avatarUrl: null }
    : { name: "Office Assistant", avatarUrl: null };

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
const mcpImageBase64 = window.btoa(`
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <rect width="640" height="360" rx="16" fill="#1e293b" />
    <path d="M60 300 210 140 330 250 430 170 580 300Z" fill="#60a5fa" />
    <text x="40" y="60" fill="white" font-family="sans-serif" font-size="28">MCP image result</text>
  </svg>
`);

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

const markdownTableMessages: UIMessage[] = [
  {
    id: "markdown-table-user",
    role: "user",
    parts: [{ type: "text", text: "Summarize the four-dimension assessment." }],
  },
  {
    id: "markdown-table-assistant",
    role: "assistant",
    parts: [{
      type: "text",
      text: [
        "## Assessment summary",
        "",
        "| Dimension | Score | Weight | Key point |",
        "| --- | ---: | ---: | --- |",
        "| Fundamentals | **8/10** | 35% | Gross margin remains resilient |",
        "| News | **5/10** | 20% | Institutional coverage is stable |",
        "| Capital flow | **4/10** | 35% | Short-term outflow needs attention |",
        "| Technical | **5/10** | 10% | Price has recovered from its low |",
      ].join("\n"),
    }],
  },
];

const outputLimitMessages: UIMessage[] = [
  {
    id: "output-limit-user",
    role: "user",
    parts: [{ type: "text", text: "Generate the complete report." }],
  },
  {
    id: "output-limit-assistant",
    role: "assistant",
    metadata: createTranscriptMessageMetadata({ finish: "length" }),
    parts: [{
      type: "text",
      text: "The report is partially complete and can resume from the current file state.",
    }],
  },
];

const scrollAffordanceMessages = Array.from({ length: 14 }).flatMap<UIMessage>((_, index) => [
  {
    id: `scroll-user-${index}`,
    role: "user",
    parts: [{ type: "text", text: `Question ${index + 1}` }],
  },
  {
    id: `scroll-assistant-${index}`,
    role: "assistant",
    parts: [{
      type: "text",
      text: `## Answer ${index + 1}\n\n${"This is a deterministic WorkBuddy scroll-control fixture. ".repeat(8)}`,
    }],
  },
]);

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
        },
        callProviderMetadata: {
          opencode: {
            toolMetadata: { mcpProgress: { progress: 2, total: 2, message: "Complete" } },
          },
        },
        output: {
          result: {
            data: [
              { type: "text", text: "Found quarterly-report.md" },
              {
                type: "image",
                mimeType: "image/svg+xml",
                data: mcpImageBase64,
              },
              { type: "resource", resource: { uri: "drive://quarterly-report", text: "Quarterly report resource" } },
            ],
          },
        },
      },
      {
        type: "dynamic-tool",
        toolName: "fetch_mcp_resource",
        toolCallId: "mcp-resource-http",
        state: "output-available",
        input: { server: "Docs", uri: "https://example.com/guide.md" },
        output: { result: { content: "# Guide" } },
      },
      {
        type: "dynamic-tool",
        toolName: "fetch_mcp_resource",
        toolCallId: "mcp-resource-image",
        state: "output-available",
        input: { server: "Media", uri: "resource://preview.svg" },
        output: { result: { content: `data:image/svg+xml;base64,${mcpImageBase64}` } },
      },
      {
        type: "dynamic-tool",
        toolName: "fetch_mcp_resource",
        toolCallId: "mcp-resource-download",
        state: "output-available",
        input: { server: "Docs", uri: "resource://report.md" },
        output: {
          result: {
            content: "Resource saved to: /tmp/report.md",
            downloadPath: "/tmp/report.md",
          },
        },
      },
      {
        type: "dynamic-tool",
        toolName: "fetch_mcp_resource",
        toolCallId: "mcp-resource-text",
        state: "output-available",
        input: { server: "Docs", uri: "resource://summary.txt" },
        output: { result: { content: "Quarterly summary resource" } },
      },
      {
        type: "dynamic-tool",
        toolName: "append_to_file",
        toolCallId: "append-1",
        state: "output-available",
        input: { path: "/tmp/report.md", content: "Next section" },
        output: { result: { success: true } },
      },
      {
        type: "dynamic-tool",
        toolName: "connect_cloud_service",
        toolCallId: "cloud-1",
        state: "output-available",
        input: { serviceName: "CloudBase" },
        output: { result: { success: true } },
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

const financialVisual = `
<svg viewBox="0 0 680 430" width="100%" role="img" aria-label="贵州茅台 2021 到 2025 年财务趋势">
  <style>
    .title { fill: var(--dls-text-primary); font: 600 22px system-ui; }
    .label { fill: var(--dls-text-secondary); font: 400 12px system-ui; }
    .value { fill: var(--dls-text-primary); font: 500 12px system-ui; }
    .grid { stroke: var(--dls-border); stroke-width: 1; }
  </style>
  <text class="title" x="18" y="30">贵州茅台 2021–2025 核心盈利能力趋势</text>
  <g transform="translate(18 48)">
    <rect x="0" y="0" width="10" height="10" rx="2" fill="#22A06B"/><text class="label" x="16" y="10">营业收入</text>
    <rect x="98" y="0" width="10" height="10" rx="2" fill="#3B82F6"/><text class="label" x="114" y="10">归母净利润</text>
    <line x1="218" y1="5" x2="234" y2="5" stroke="#E05A33" stroke-width="2"/><text class="label" x="240" y="10">ROE</text>
    <line x1="292" y1="5" x2="308" y2="5" stroke="#7667E8" stroke-width="2"/><text class="label" x="314" y="10">毛利率</text>
  </g>
  <g transform="translate(56 78)">
    <line class="grid" x1="0" y1="280" x2="586" y2="280"/>
    <line class="grid" x1="0" y1="210" x2="586" y2="210"/>
    <line class="grid" x1="0" y1="140" x2="586" y2="140"/>
    <line class="grid" x1="0" y1="70" x2="586" y2="70"/>
    <line class="grid" x1="0" y1="0" x2="586" y2="0"/>
    <text class="label" x="-10" y="284" text-anchor="end">0</text>
    <text class="label" x="-10" y="214" text-anchor="end">500</text>
    <text class="label" x="-10" y="144" text-anchor="end">1,000</text>
    <text class="label" x="-10" y="74" text-anchor="end">1,500</text>
    <text class="label" x="-10" y="4" text-anchor="end">2,000</text>
    <g fill="#22A06B">
      <rect x="25" y="127" width="42" height="153" rx="4"/><rect x="141" y="102" width="42" height="178" rx="4"/>
      <rect x="257" y="70" width="42" height="210" rx="4"/><rect x="373" y="38" width="42" height="242" rx="4"/>
      <rect x="489" y="40" width="42" height="240" rx="4"/>
    </g>
    <g fill="#3B82F6">
      <rect x="70" y="207" width="42" height="73" rx="4"/><rect x="186" y="192" width="42" height="88" rx="4"/>
      <rect x="302" y="179" width="42" height="101" rx="4"/><rect x="418" y="160" width="42" height="120" rx="4"/>
      <rect x="534" y="166" width="42" height="114" rx="4"/>
    </g>
    <polyline points="46,192 162,182 278,176 394,171 510,180" fill="none" stroke="#E05A33" stroke-width="2.5"/>
    <polyline points="46,25 162,23 278,22 394,23 510,27" fill="none" stroke="#7667E8" stroke-width="2.5"/>
    <g fill="#E05A33"><circle cx="46" cy="192" r="4"/><circle cx="162" cy="182" r="4"/><circle cx="278" cy="176" r="4"/><circle cx="394" cy="171" r="4"/><circle cx="510" cy="180" r="4"/></g>
    <g fill="#7667E8"><circle cx="46" cy="25" r="4"/><circle cx="162" cy="23" r="4"/><circle cx="278" cy="22" r="4"/><circle cx="394" cy="23" r="4"/><circle cx="510" cy="27" r="4"/></g>
    <text class="label" x="68" y="304" text-anchor="middle">2021</text><text class="label" x="184" y="304" text-anchor="middle">2022</text>
    <text class="label" x="300" y="304" text-anchor="middle">2023</text><text class="label" x="416" y="304" text-anchor="middle">2024</text>
    <text class="label" x="532" y="304" text-anchor="middle">2025</text>
  </g>
  <g transform="translate(18 390)">
    <rect x="0" y="0" width="200" height="30" rx="8" fill="var(--dls-surface-muted)"/><text class="label" x="12" y="19">营收 3 年 CAGR</text><text class="value" x="146" y="19">10.81%</text>
    <rect x="214" y="0" width="200" height="30" rx="8" fill="var(--dls-surface-muted)"/><text class="label" x="226" y="19">2025 营收增速</text><text x="360" y="19" fill="var(--dls-status-danger)" font="500 12px system-ui">-1.21%</text>
    <rect x="428" y="0" width="234" height="30" rx="8" fill="var(--dls-surface-muted)"/><text class="label" x="440" y="19">当前 PE / 5 年分位</text><text class="value" x="584" y="19">18.06</text>
  </g>
</svg>`;

const workBuddyChartVisual = `<div style="padding:20px 24px 16px">
  <h2 class="sr-only">贵州茅台 2021 至 2025 年营收、净利润、毛利率和净利率趋势</h2>
  <div style="font-size:20px;font-weight:500;margin-bottom:6px">贵州茅台 2021–2025 财务趋势</div>
  <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:14px">柱状图为亿元，折线图为百分比</div>
  <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:10px;font-size:12px;color:var(--color-text-secondary)">
    <span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#378add;margin-right:5px"></i>营业收入</span>
    <span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#1d9e75;margin-right:5px"></i>净利润</span>
    <span><i style="display:inline-block;width:14px;height:3px;background:#ba7517;margin:0 5px 3px 0"></i>毛利率</span>
    <span><i style="display:inline-block;width:14px;height:3px;background:#7667e8;margin:0 5px 3px 0"></i>净利率</span>
  </div>
  <div style="position:relative;width:100%;height:390px"><canvas id="moutaiChart" role="img" aria-label="贵州茅台 2021 至 2025 年财务组合趋势图">贵州茅台财务趋势图</canvas></div>
  <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-top:14px">
    <div style="min-width:0;padding:12px;border-radius:8px;background:var(--color-background-secondary)"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--color-text-secondary)">2025 营收</div><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:20px;font-weight:500">1,688 亿元</div></div>
    <div style="min-width:0;padding:12px;border-radius:8px;background:var(--color-background-secondary)"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--color-text-secondary)">2025 净利润</div><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:20px;font-weight:500">823 亿元</div></div>
    <div style="min-width:0;padding:12px;border-radius:8px;background:var(--color-background-secondary)"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--color-text-secondary)">营收同比</div><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:20px;font-weight:500;color:#e24b4a">-1.2%</div></div>
    <div style="min-width:0;padding:12px;border-radius:8px;background:var(--color-background-secondary)"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--color-text-secondary)">Avg. gross margin</div><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:20px;font-weight:500">91.7%</div></div>
    <div style="min-width:0;padding:12px;border-radius:8px;background:var(--color-background-secondary)"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--color-text-secondary)">ROE peak</div><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:20px;font-weight:500">36.0%</div></div>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
  <script>
    const dark = document.documentElement.classList.contains('dark')
    const tick = dark ? '#94a3b8' : '#64748b'
    const grid = dark ? '#3a3a3a' : '#e5e7eb'
    new Chart(document.getElementById('moutaiChart'), {
      data: {
        labels: ['2021','2022','2023','2024','2025'],
        datasets: [
          { type:'bar', label:'营业收入', data:[1062,1241,1477,1709,1688], backgroundColor:'#378add', borderRadius:5, yAxisID:'y' },
          { type:'bar', label:'净利润', data:[525,627,747,862,823], backgroundColor:'#1d9e75', borderRadius:5, yAxisID:'y' },
          { type:'line', label:'毛利率', data:[91.5,91.9,92.0,91.9,91.2], borderColor:'#ba7517', backgroundColor:'#ba7517', pointRadius:4, tension:.3, yAxisID:'y1' },
          { type:'line', label:'净利率', data:[49.4,50.5,50.6,50.5,48.8], borderColor:'#7667e8', backgroundColor:'#7667e8', pointRadius:4, tension:.3, yAxisID:'y1' }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ display:false } },
        scales:{
          x:{ grid:{ display:false }, ticks:{ autoSkip:false, color:tick } },
          y:{ beginAtZero:true, position:'left', ticks:{ color:tick }, grid:{ color:grid }, title:{ display:true, text:'亿元', color:tick } },
          y1:{ min:40, max:100, position:'right', ticks:{ color:tick }, grid:{ drawOnChartArea:false }, title:{ display:true, text:'%', color:tick } }
        }
      }
    })
  </script>
</div>`;

const workBuddyTurnMessages: UIMessage[] = [
  {
    id: "workbuddy-user",
    role: "user",
    metadata: createTranscriptMessageMetadata({ time: { created: 1_000 } }),
    parts: [{ type: "text", text: "生成一张贵州茅台 2021–2025 财务趋势图" }],
  },
  {
    id: "workbuddy-progress",
    role: "assistant",
    parts: [{ type: "text", text: "数据获取完毕，正在补充历史数据并生成可视化报告。" }],
  },
  {
    id: "workbuddy-command",
    role: "assistant",
    parts: [{
      type: "dynamic-tool",
      toolName: "bash",
      toolCallId: "workbuddy-bash",
      state: "output-available",
      input: { command: "curl https://datacenter.example/api | python3 build_financial_report.py" },
      output: "Report data prepared",
    }],
  },
  {
    id: "workbuddy-reasoning",
    role: "assistant",
    parts: [{ type: "reasoning", text: "校验收入、利润、ROE 与毛利率的量纲和年份顺序。" }],
  },
  {
    id: "workbuddy-progress-validated",
    role: "assistant",
    parts: [{ type: "text", text: "历史数据已经齐备，接下来校验图表布局并绘制趋势图。" }],
  },
  {
    id: "workbuddy-reasoning-single",
    role: "assistant",
    parts: [{ type: "reasoning", text: "检查图例、双轴单位和指标卡是否发生重叠。" }],
  },
  {
    id: "workbuddy-visual",
    role: "assistant",
    parts: [{
      type: "dynamic-tool",
      toolName: "render_visual",
      toolCallId: "workbuddy-render-visual",
      state: "output-available",
      input: { title: "贵州茅台 2021–2025 财务趋势", widget_code: workBuddyChartVisual },
      output: { title: "贵州茅台 2021–2025 财务趋势", widget_code: workBuddyChartVisual },
    }],
  },
  {
    id: "workbuddy-final",
    role: "assistant",
    metadata: createTranscriptMessageMetadata({
      time: { created: 2_000, completed: 11_000 },
      cost: 5.04,
      modelID: "Auto",
      tokens: {
        input: 10,
        output: 1_400,
        reasoning: 100,
        cache: { read: 0, write: 0 },
      },
    }),
    parts: [{
      type: "text",
      text: "以上是基于基本面数据生成的 **贵州茅台 2021–2025 财务趋势图**。\n\n- 营收与净利润在 2021–2024 年持续增长，2025 年首次小幅回落。\n- 毛利率仍稳定在 91% 以上，ROE 保持行业高位。\n- 当前估值低于五年中枢，但盈利能力边际承压。",
    }],
  },
];

const workBuddyVisualRunningMessages: UIMessage[] = [
  {
    id: "workbuddy-visual-running-user",
    role: "user",
    parts: [{ type: "text", text: "生成一张财务趋势图" }],
  },
  {
    id: "workbuddy-visual-running-tool",
    role: "assistant",
    parts: [{
      type: "dynamic-tool",
      toolName: "visualizer:show_widget",
      toolCallId: "workbuddy-visual-running",
      state: "input-available",
      input: {
        title: "贵州茅台财务趋势图",
        loading_messages: ["整理财务数据", "绘制趋势图", "校验指标单位"],
      },
    }],
  },
];

const workBuddyVisualStreamingMessages: UIMessage[] = [
  {
    id: "workbuddy-visual-streaming-user",
    role: "user",
    parts: [{ type: "text", text: "生成一张财务趋势图" }],
  },
  {
    id: "workbuddy-visual-streaming-tool",
    role: "assistant",
    parts: [{
      type: "dynamic-tool",
      toolName: "visualizer:show_widget",
      toolCallId: "workbuddy-visual-streaming",
      state: "input-available",
      input: {
        title: "贵州茅台财务趋势图",
        widget_code: financialVisual,
        loading_messages: ["整理财务数据", "绘制趋势图", "校验指标单位"],
      },
    }],
  },
];

const workBuddyVisualFailedMessages: UIMessage[] = [
  {
    id: "workbuddy-visual-failed-user",
    role: "user",
    parts: [{ type: "text", text: "生成一张财务趋势图" }],
  },
  {
    id: "workbuddy-visual-failed-tool",
    role: "assistant",
    parts: [{
      type: "dynamic-tool",
      toolName: "show_widget",
      toolCallId: "workbuddy-visual-failed",
      state: "output-error",
      input: {
        title: "贵州茅台财务趋势图",
        loading_messages: ["整理财务数据", "绘制趋势图"],
      },
      errorText: "Invalid SVG payload",
    }],
  },
];

const activityWaitingMessages: UIMessage[] = [
  {
    id: "activity-waiting-user",
    role: "user",
    parts: [{ type: "text", text: "你还能做什么？" }],
  },
  {
    id: "activity-waiting-assistant-shell",
    role: "assistant",
    parts: [],
  },
];

const activityReasoningMessages: UIMessage[] = [
  ...activityWaitingMessages,
  {
    id: "activity-reasoning-assistant",
    role: "assistant",
    parts: [{ type: "reasoning", text: "梳理问题背景并确认回答重点。" }],
  },
];

const activityStreamingMessages: UIMessage[] = [
  ...activityReasoningMessages,
  {
    id: "activity-streaming-assistant",
    role: "assistant",
    parts: [{
      type: "text",
      text: "当然可以。我可以帮助你整理资料、分析问题、修改文件，也能连续执行多步骤任务。",
    }],
  },
];

const kimiProgressFallbackMessages: UIMessage[] = [
  {
    id: "kimi-progress-user",
    role: "user",
    parts: [{ type: "text", text: "生成一张贵州茅台财务趋势图" }],
  },
  {
    id: "kimi-progress-english",
    role: "assistant",
    parts: [{
      type: "text",
      text: "I will obtain Kweichow Moutai's financial report data and then generate a trend chart for you.",
    }],
  },
  {
    id: "kimi-progress-reasoning-1",
    role: "assistant",
    parts: [{ type: "reasoning", text: "Inspect the first data source." }],
  },
  {
    id: "kimi-progress-browser-1",
    role: "assistant",
    parts: [{
      type: "dynamic-tool",
      toolName: "onmyagent_browser_node_repl",
      toolCallId: "kimi-browser-1",
      state: "output-available",
      input: { code: "open first source" },
      output: "ok",
    }],
  },
  {
    id: "kimi-progress-reasoning-2",
    role: "assistant",
    parts: [{ type: "reasoning", text: "Inspect the next data source." }],
  },
  {
    id: "kimi-progress-browser-2",
    role: "assistant",
    parts: [{
      type: "dynamic-tool",
      toolName: "onmyagent_browser_node_repl",
      toolCallId: "kimi-browser-2",
      state: "input-available",
      input: { code: "open next source" },
    }],
  },
];

const semanticSingletonToolMessages: UIMessage[] = [
  {
    id: "semantic-singleton-user",
    role: "user",
    parts: [{ type: "text", text: "打开财务报告页面" }],
  },
  {
    id: "semantic-singleton-intro",
    role: "assistant",
    parts: [{ type: "text", text: "我先打开报告页面，确认内容是否可用。" }],
  },
  {
    id: "semantic-singleton-browser",
    role: "assistant",
    parts: [{
      type: "dynamic-tool",
      toolName: "onmyagent_browser_node_repl",
      toolCallId: "semantic-singleton-browser",
      state: "input-available",
      input: { code: "await tab.goto('https://example.com/report')" },
    }],
  },
];

function workBuddyRunningMessages(growthCount: number): UIMessage[] {
  const suffix = growthCount > 0 ? ` 已同步 ${growthCount} 个增量数据片段。` : "";
  return [
    {
      id: "workbuddy-running-user",
      role: "user",
      metadata: createTranscriptMessageMetadata({ time: { created: 1_000 } }),
      parts: [{ type: "text", text: "帮我分析下茅台基本面和估值并生成一张趋势图给我" }],
    },
    {
      id: "workbuddy-running-thinking",
      role: "assistant",
      parts: [{
        type: "reasoning",
        text: "拆解分析维度，确认需要基本面、估值、资金面与新闻数据。",
      }],
    },
    {
      id: "workbuddy-running-intro",
      role: "assistant",
      parts: [{
        type: "text",
        text: "我来帮你分析茅台的基本面和估值，并生成趋势图。让我先调用股票分析工具获取数据。",
      }],
    },
    {
      id: "workbuddy-running-finance-tool",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "stock_analysis",
        toolCallId: "stock-analysis-1",
        state: "output-available",
        input: { stock: "600519", dimensions: ["fundamental", "valuation"] },
        output: { revenue: [1095, 1276, 1506, 1741, 1721], pe: 18.06 },
      }],
    },
    {
      id: "workbuddy-running-finance-done",
      role: "assistant",
      parts: [{
        type: "text",
        text: `数据获取成功，继续获取资金面和新闻面数据。${suffix}`,
      }],
    },
    {
      id: "workbuddy-running-sources",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "web_search",
        toolCallId: "web-search-1",
        state: "output-available",
        input: { query: "贵州茅台 2025 财报 资金面 新闻" },
        output: { results: [{ title: "贵州茅台年度报告" }] },
      }],
    },
    {
      id: "workbuddy-running-sources-done",
      role: "assistant",
      parts: [{
        type: "text",
        text: "数据收集完成，现在开始生成趋势图和综合分析报告。",
      }],
    },
    {
      id: "workbuddy-running-tasks",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "todowrite",
        toolCallId: "todo-write-1",
        state: "input-available",
        input: {
          todos: [
            { id: "1", content: "获取茅台历史财务与估值数据", status: "completed" },
            { id: "2", content: "补充资金面与新闻面数据", status: "completed" },
            { id: "3", content: "生成财务趋势图", status: "in_progress" },
            { id: "4", content: "撰写综合分析与估值结论", status: "pending" },
          ],
        },
      }],
    },
  ];
}

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

const jitterStreamText = Array.from({ length: 18 }, (_, index) => `
## Section ${index + 1}

This paragraph grows token by token so the fixture exercises markdown reparsing, line wrapping, ResizeObserver delivery, and sticky-bottom scrolling at the same time.

- First item for section ${index + 1}
- Second item keeps wrapping behavior realistic across several lines of content.
- Third item ends the section before the next heading arrives.
`).join("\n");

function JitterTraceFixture(props: { virtualized?: boolean; completes?: boolean }) {
  const [length, setLength] = useState(() => (
    props.completes ? Math.max(0, jitterStreamText.length - 1_500) : 900
  ));
  const isStreaming = length < jitterStreamText.length;
  const sessionIdRef = useRef(`session-transcript-jitter-fixture-${Date.now()}`);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const resolveScrollElement = useCallback(() => scrollRef.current, []);
  const messages = useMemo<UIMessage[]>(() => {
    const transcript: UIMessage[] = [];
    if (props.virtualized) {
      for (let index = 0; index < 20; index += 1) {
        transcript.push(
          {
            id: `jitter-history-user-${index}`,
            role: "user",
            parts: [{ type: "text", text: `Historical question ${index + 1}` }],
          },
          {
            id: `jitter-history-assistant-${index}`,
            role: "assistant",
            parts: [{ type: "text", text: `Historical answer ${index + 1}. This row is stable.` }],
          },
        );
      }
    }
    transcript.push({
      id: "jitter-user",
      role: "user",
      parts: [{ type: "text", text: "Stream a long structured answer." }],
    },
    {
      id: "jitter-assistant",
      role: "assistant",
      parts: [{ type: "text", text: jitterStreamText.slice(0, length) }],
    });
    return transcript;
  }, [length, props.virtualized]);
  const sessionScroll = useSessionScrollController({
    selectedSessionId: `${sessionIdRef.current}-${props.virtualized ? "virtual" : "plain"}`,
    renderedMessages: messages,
    renderedMessageIds: messages.map((message) => message.id),
    containerRef: scrollRef,
    contentRef,
    active: true,
    sessionChangeScroll: "bottom",
  });

  useEffect(() => {
    let streamTimer: number | undefined;
    const startTimer = window.setTimeout(() => {
      sessionScroll.scrollToBottom("auto");
      streamTimer = window.setInterval(() => {
        setLength((current) => Math.min(jitterStreamText.length, current + 7));
      }, 32);
    }, 300);
    return () => {
      window.clearTimeout(startTimer);
      if (streamTimer !== undefined) window.clearInterval(streamTimer);
    };
  }, [sessionScroll.scrollToBottom]);

  return (
    <main className="h-screen overflow-hidden bg-dls-background text-dls-text">
      <div className="relative h-full min-h-0">
        <div
          ref={scrollRef}
          data-testid="jitter-scroll-container"
          onWheel={(event) => sessionScroll.markWheelGesture(event.deltaY, event.target)}
          onScroll={sessionScroll.handleScroll}
          className="absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-y-contain px-6 py-5 sm:px-8"
        >
          <div ref={contentRef} className="w-full">
            <SessionTranscript
              messages={messages}
              isStreaming={isStreaming}
              developerMode={false}
              showThinking={true}
              assistantAvatar={fixtureAssistant}
              scrollElement={resolveScrollElement}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

function ScrollAffordanceFixture() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sessionScroll = useSessionScrollController({
    selectedSessionId: "session-scroll-affordance-fixture",
    renderedMessages: scrollAffordanceMessages,
    renderedMessageIds: scrollAffordanceMessages.map((message) => message.id),
    containerRef: scrollRef,
    contentRef,
    active: true,
    sessionChangeScroll: "bottom",
  });

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => sessionScroll.scrollToBottom("auto"));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sessionScroll.scrollToBottom]);

  return (
    <main className="h-screen overflow-hidden bg-dls-background text-dls-text">
      <div className="relative h-full min-h-0">
        <div
          ref={scrollRef}
          data-testid="scroll-affordance-container"
          onWheel={(event) => sessionScroll.markWheelGesture(event.deltaY, event.target)}
          onScroll={sessionScroll.handleScroll}
          className="absolute inset-0 overflow-x-hidden overflow-y-auto px-10 py-8"
        >
          <div ref={contentRef} className="mx-auto w-full max-w-[960px]">
            <SessionTranscript
              messages={scrollAffordanceMessages}
              isStreaming={false}
              developerMode={false}
              showThinking={true}
              assistantAvatar={fixtureAssistant}
              scrollElement={() => scrollRef.current}
            />
          </div>
        </div>
        <TranscriptScrollToLatest
          visible={!sessionScroll.isAtBottom}
          label="Jump to latest"
          onActivate={() => sessionScroll.jumpToLatest("auto")}
        />
      </div>
    </main>
  );
}

function Fixture() {
  const [completedExpanded, setCompletedExpanded] = useState(true);
  const [generatingExpanded, setGeneratingExpanded] = useState(true);
  const [errorExpanded, setErrorExpanded] = useState(true);
  const [streamingGrowthCount, setStreamingGrowthCount] = useState(0);

  if (sceneParam === "jitter-trace") return <JitterTraceFixture />;
  if (sceneParam === "jitter-trace-virtual") return <JitterTraceFixture virtualized />;
  if (sceneParam === "jitter-trace-virtual-complete") {
    return <JitterTraceFixture virtualized completes />;
  }
  if (sceneParam === "scroll-affordance") return <ScrollAffordanceFixture />;

  if (sceneParam === "markdown-table") {
    return (
      <main className="h-screen overflow-y-auto bg-dls-background px-10 py-8 text-dls-text">
        <div className="mx-auto max-w-[960px]">
          <SessionTranscript
            messages={markdownTableMessages}
            isStreaming={false}
            developerMode={false}
            showThinking={true}
            assistantAvatar={fixtureAssistant}
          />
        </div>
      </main>
    );
  }

  if (
    sceneParam === "visual-running" ||
    sceneParam === "visual-streaming" ||
    sceneParam === "visual-failed"
  ) {
    const running = sceneParam === "visual-running";
    const streaming = sceneParam === "visual-streaming";
    return (
      <main className="h-screen overflow-y-auto bg-dls-background px-10 py-8 text-dls-text">
        <div className="mx-auto max-w-[960px]">
          <SessionTranscript
            messages={running
              ? workBuddyVisualRunningMessages
              : streaming
                ? workBuddyVisualStreamingMessages
                : workBuddyVisualFailedMessages}
            isStreaming={running || streaming}
            developerMode={false}
            showThinking={true}
            assistantAvatar={fixtureAssistant}
          />
        </div>
      </main>
    );
  }

  if (sceneParam === "workbuddy-running") {
    return (
      <main className="h-screen overflow-y-auto bg-dls-background px-10 py-8 text-dls-text">
        <div className="mx-auto max-w-[960px]">
          <SessionTranscript
            messages={workBuddyRunningMessages(streamingGrowthCount)}
            isStreaming={true}
            developerMode={false}
            showThinking={true}
            assistantAvatar={fixtureAssistant}
            footer={showActivityFooter ? (
              <AssistantWaitingCard label="运行中" collapseLayout />
            ) : null}
          />
          <Button
            data-testid="append-stream-token"
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setStreamingGrowthCount((count) => count + 1)}
          >
            Append stream token
          </Button>
        </div>
      </main>
    );
  }

  if (sceneParam === "kimi-progress-fallback") {
    return (
      <main className="h-screen overflow-y-auto bg-dls-background px-10 py-8 text-dls-text">
        <div className="mx-auto max-w-[960px]">
          <SessionTranscript
            messages={kimiProgressFallbackMessages}
            isStreaming
            developerMode={false}
            showThinking
            assistantAvatar={fixtureAssistant}
          />
        </div>
      </main>
    );
  }

  if (sceneParam === "semantic-singleton-tool") {
    return (
      <main className="h-screen overflow-y-auto bg-dls-background px-10 py-8 text-dls-text">
        <div className="mx-auto max-w-[960px]">
          <SessionTranscript
            messages={semanticSingletonToolMessages}
            isStreaming
            developerMode={false}
            showThinking
            assistantAvatar={fixtureAssistant}
          />
        </div>
      </main>
    );
  }

  if (
    sceneParam === "activity-requesting" ||
    sceneParam === "activity-reasoning" ||
    sceneParam === "activity-streaming"
  ) {
    const messages = sceneParam === "activity-requesting"
      ? activityWaitingMessages
      : sceneParam === "activity-reasoning"
        ? activityReasoningMessages
        : activityStreamingMessages;
    const label = sceneParam === "activity-requesting"
      ? "等待模型响应"
      : "生成回复中";
    return (
      <main className="h-screen overflow-y-auto bg-dls-background px-10 py-8 text-dls-text">
        <div className="mx-auto max-w-[960px]">
          <SessionTranscript
            messages={messages}
            isStreaming
            developerMode={false}
            showThinking
            assistantAvatar={fixtureAssistant}
            footer={<AssistantWaitingCard label={label} collapseLayout />}
          />
        </div>
      </main>
    );
  }

  if (sceneParam === "workbuddy-completed") {
    return (
      <main className="h-screen overflow-y-auto bg-dls-background px-10 py-8 text-dls-text">
        <div className="mx-auto max-w-[960px]">
          <SessionTranscript
            messages={workBuddyTurnMessages}
            isStreaming={false}
            developerMode={false}
            showThinking={true}
            assistantAvatar={fixtureAssistant}
          />
        </div>
      </main>
    );
  }

  if (sceneParam === "output-limit") {
    return (
      <main className="h-screen overflow-y-auto bg-dls-background px-10 py-8 text-dls-text">
        <div className="mx-auto max-w-[960px]">
          <SessionTranscript
            messages={outputLimitMessages}
            isStreaming={false}
            developerMode={false}
            showThinking={true}
            assistantAvatar={fixtureAssistant}
            footer={<OutputLimitContinueCard onContinue={() => undefined} />}
          />
        </div>
      </main>
    );
  }

  return (
    <main data-entry={fixtureEntry} className="h-screen overflow-y-auto bg-dls-background px-10 py-8 text-dls-text">
      <div className="mx-auto max-w-[960px] space-y-8">
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
            messages={workBuddyTurnMessages}
            isStreaming={false}
            developerMode={false}
            showThinking={true}
            assistantAvatar={fixtureAssistant}
          />
          <SessionTranscript
            messages={compactToolMessages}
            isStreaming={false}
            developerMode={false}
            showThinking={true}
            assistantAvatar={fixtureAssistant}
          />
          <SessionTranscript
            messages={cancelledReasoningMessages}
            isStreaming={false}
            developerMode={false}
            showThinking={true}
            assistantAvatar={fixtureAssistant}
          />
          <SessionTranscript
            messages={reasoningMessages(streamingGrowthCount)}
            isStreaming={true}
            developerMode={false}
            showThinking={true}
            assistantAvatar={fixtureAssistant}
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

const fixtureRoot = window.__sessionTranscriptFixtureRoot ?? createRoot(root);
window.__sessionTranscriptFixtureRoot = fixtureRoot;
fixtureRoot.render(
  <PlatformProvider value={createDefaultPlatform()}>
    <Fixture />
  </PlatformProvider>,
);
