import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DEFAULT_CONTEXT_LIMIT,
  bucketPercentOfTotal,
  contextUsageExceedsKnownLimit,
  contextUsageHasKnownLimit,
  contextUsagePercent,
  formatBucketPercent,
  formatCompactTokens,
  lookupModelContextLimit,
  resolveContextTotal,
  toContextUsageSnapshot,
} from "../src/react-app/capabilities/context-usage/context-usage-model";
import {
  buildSessionContextUsage,
  estimateContextUsedFromTokens,
  estimateSessionContextBreakdown,
  estimateTokensFromText,
} from "../src/react-app/capabilities/context-usage/session-context-usage";
import {
  ContextUsageIndicator,
  ContextUsagePopoverBody,
} from "../src/react-app/domains/local-agents/context-usage-indicator";

describe("context usage model", () => {
  test("resolveContextTotal prefers runtime → catalog → table → default", () => {
    expect(resolveContextTotal({ runtimeTotal: 192_000 })).toEqual({
      total: 192_000,
      source: "runtime",
    });
    expect(
      resolveContextTotal({
        catalogContextWindow: 128_000,
        modelId: "claude-sonnet-4.5",
      }),
    ).toEqual({ total: 128_000, source: "catalog" });
    expect(resolveContextTotal({ modelId: "claude-sonnet-4.5" })).toEqual({
      total: 1_000_000,
      source: "table",
    });
    expect(resolveContextTotal({ modelId: "doubao-seed-evolving" })).toEqual({
      total: 256_000,
      source: "table",
    });
    expect(resolveContextTotal({ modelId: "huoshan/doubao-seed-evolving" })).toEqual({
      total: 256_000,
      source: "table",
    });
    expect(resolveContextTotal({ modelId: "totally-unknown-xyz" })).toEqual({
      total: DEFAULT_CONTEXT_LIMIT,
      source: "default",
    });
    expect(resolveContextTotal({})).toEqual({
      total: DEFAULT_CONTEXT_LIMIT,
      source: "default",
    });
  });

  test("lookupModelContextLimit fuzzy-matches and defaults", () => {
    expect(lookupModelContextLimit("gpt-4o")).toBe(128_000);
    expect(lookupModelContextLimit("claude-3.5-sonnet-latest")).toBe(200_000);
    expect(lookupModelContextLimit(null)).toBe(DEFAULT_CONTEXT_LIMIT);
  });

  test("toContextUsageSnapshot preserves reported total when used exceeds it", () => {
    const snap = toContextUsageSnapshot({ used: 250, total: 100, totalSource: "runtime" });
    expect(snap?.used).toBe(250);
    expect(snap?.total).toBe(100);
    expect(contextUsagePercent(snap?.used ?? 0, snap?.total ?? 0)).toBe(100);
    expect(snap && contextUsageExceedsKnownLimit(snap)).toBe(true);
  });

  test("does not claim overflow when the total is only a default estimate", () => {
    const estimated = toContextUsageSnapshot({
      used: 250_000,
      total: DEFAULT_CONTEXT_LIMIT,
      totalSource: "default",
    });
    expect(estimated && contextUsageExceedsKnownLimit(estimated)).toBe(false);
    expect(estimated && contextUsageHasKnownLimit(estimated)).toBe(false);
    const html = renderToStaticMarkup(createElement(ContextUsageIndicator, { usage: estimated }));
    expect(html).toContain('data-percent="100.0"');
    expect(html).toContain('data-limit-known="false"');
    expect(html).not.toContain("text-dls-danger");
  });

  test("does not turn a below-estimate unknown model into a percentage warning", () => {
    const estimated = toContextUsageSnapshot({
      used: 190_000,
      total: DEFAULT_CONTEXT_LIMIT,
      totalSource: "default",
    });
    const html = renderToStaticMarkup(createElement(ContextUsageIndicator, { usage: estimated }));
    expect(html).toContain('data-percent="95.0"');
    expect(html).toContain('data-limit-known="false"');
    expect(html).not.toContain("text-dls-danger");
  });

  test("popover always shows percent, used/total, and five category rows", () => {
    const usage = toContextUsageSnapshot({
      used: 44_636,
      total: 256_000,
      totalSource: "table",
    });
    expect(usage).not.toBeNull();
    const html = renderToStaticMarkup(
      createElement(ContextUsagePopoverBody, {
        usage: usage!,
        percent: contextUsagePercent(usage!.used, usage!.total),
        percentClass: "text-dls-text",
        barToneClass: "bg-dls-accent",
        isOverLimit: false,
        onClose: () => undefined,
      }),
    );
    expect(html).toContain("17.4%");
    expect(html).toContain("44.6K");
    expect(html).toContain("256.0K");
    expect(html).toContain("System prompts");
    expect(html).toContain("Tools &amp; subagents");
    expect(html).toContain("Messages");
    expect(html).toContain("Connectors &amp; MCP");
    expect(html).toContain("Skills");
    expect(html).not.toContain("context limit is unavailable");
    expect(html).toContain('data-testid="local-agent-context-usage-close"');
  });

  test("popover row percents follow the estimated breakdown", () => {
    const usage = buildSessionContextUsage({
      modelId: "doubao-seed-evolving",
      usedTokens: 44_636,
      estimateFrom: {
        systemPrompt: "You are a media expert. ".repeat(40),
        messages: [{ role: "user", parts: [{ type: "text", text: "写个脚本" }] }],
        skills: [{ name: "script", description: "Write video scripts" }],
      },
    });
    const html = renderToStaticMarkup(
      createElement(ContextUsagePopoverBody, {
        usage,
        percent: contextUsagePercent(usage.used, usage.total),
        percentClass: "text-dls-text",
        barToneClass: "bg-dls-accent",
        isOverLimit: false,
        onClose: () => undefined,
      }),
    );
    expect(html).toContain("17.4%");
    expect(html).toContain("Tools &amp; subagents");
    expect(html).toContain("13%");
    expect(html).toContain("4.3%");
  });

  test("toContextUsageSnapshot keeps valid breakdown", () => {
    const snap = toContextUsageSnapshot({
      used: 100,
      total: 200,
      breakdown: [
        { id: "system", tokens: 20 },
        { id: "messages", tokens: 80 },
      ],
    });
    expect(snap?.breakdown).toEqual([
      { id: "system", tokens: 20 },
      { id: "messages", tokens: 80 },
    ]);
    expect(bucketPercentOfTotal(20, 200)).toBe(10);
    expect(contextUsagePercent(100, 200)).toBe(50);
  });

  test("formatCompactTokens", () => {
    expect(formatCompactTokens(142_400)).toBe("142.4K");
    expect(formatCompactTokens(192_000)).toBe("192.0K");
    expect(formatCompactTokens(1_000_000)).toBe("1000.0K");
    expect(formatCompactTokens(500)).toBe("500");
  });

  test("formatBucketPercent matches the reference card", () => {
    expect(formatBucketPercent(0)).toBe("0%");
    expect(formatBucketPercent(0.04)).toBe("0%");
    expect(formatBucketPercent(0.3)).toBe("0.3%");
    expect(formatBucketPercent(1)).toBe("1%");
    expect(formatBucketPercent(54.3)).toBe("54.3%");
    expect(formatBucketPercent(55.8)).toBe("55.8%");
  });

  test("popover legend keeps one-decimal bucket percents", () => {
    const usage = toContextUsageSnapshot({
      used: 107_136,
      total: 192_000,
      totalSource: "runtime",
      breakdown: [
        { id: "system", tokens: 576 },
        { id: "tools", tokens: 1_920 },
        { id: "messages", tokens: 104_256 },
        { id: "connectors", tokens: 0 },
        { id: "skills", tokens: 384 },
      ],
    });
    const html = renderToStaticMarkup(
      createElement(ContextUsagePopoverBody, {
        usage: usage!,
        percent: contextUsagePercent(usage!.used, usage!.total),
        percentClass: "text-dls-text",
        barToneClass: "bg-dls-accent",
        isOverLimit: false,
        onClose: () => undefined,
      }),
    );
    expect(html).toContain("55.8%");
    expect(html).toContain("107.1K");
    expect(html).toContain("192.0K");
    expect(html).toContain("0.3%");
    expect(html).toContain(">1%");
    expect(html).toContain("54.3%");
    expect(html).toContain("0.2%");
    expect(html).toContain("var(--grass-9)");
    expect(html).toContain("var(--amber-9)");
    expect(html).toContain("var(--violet-9)");
    expect(html).toContain("var(--sky-9)");
    expect(html).toContain("var(--blue-9)");
  });

  test("estimateContextUsedFromTokens sums input + cache read", () => {
    expect(estimateContextUsedFromTokens({ input: 100, cacheRead: 50 })).toBe(150);
    expect(estimateContextUsedFromTokens({ input: 80, cacheRead: null })).toBe(80);
    expect(estimateContextUsedFromTokens(null)).toBeNull();
  });

  test("buildSessionContextUsage always resolves total for empty sessions", () => {
    const snap = buildSessionContextUsage({
      modelId: "gpt-4o",
      usedTokens: null,
    });
    expect(snap.used).toBe(0);
    expect(snap.total).toBe(128_000);
    expect(snap.usedSource).toBe("estimate");
    expect(snap.breakdown).toBeNull();
  });

  test("used tokens without a split land in messages so rows are not all zero", () => {
    const snap = buildSessionContextUsage({
      modelId: "doubao-seed-evolving",
      usedTokens: 44_636,
    });
    expect(snap.used).toBe(44_636);
    const byId = Object.fromEntries((snap.breakdown ?? []).map((item) => [item.id, item.tokens]));
    expect(byId.messages).toBe(44_636);
    expect(byId.system).toBe(0);
    expect(byId.tools).toBe(0);
    expect(byId.connectors).toBe(0);
    expect(byId.skills).toBe(0);
  });

  test("estimateSessionContextBreakdown keeps a measured system prompt and splits leftover across present buckets", () => {
    const used = 10_000;
    const prompt = "A".repeat(400);
    const userText = "你好世界";
    const breakdown = estimateSessionContextBreakdown(used, {
      systemPrompt: prompt,
      messages: [
        { role: "user", parts: [{ type: "text", text: userText }] },
        {
          role: "assistant",
          parts: [{ type: "tool", tool: "read", input: { path: "a.txt" } }],
        },
      ],
      skills: [{ name: "media", description: "Write scripts" }],
      mcpServers: [{ name: "lark" }],
    });
    expect(breakdown).not.toBeNull();
    const byId = Object.fromEntries((breakdown ?? []).map((item) => [item.id, item.tokens]));
    expect(byId.system).toBe(estimateTokensFromText(prompt));
    expect(byId.messages).toBe(estimateTokensFromText(userText));
    expect(byId.skills).toBeGreaterThan(estimateTokensFromText("media\nWrite scripts"));
    expect(byId.connectors).toBeGreaterThan(estimateTokensFromText("lark"));
    expect(byId.tools).toBeGreaterThan(byId.messages);
    expect((breakdown ?? []).reduce((sum, item) => sum + item.tokens, 0)).toBe(used);
  });

  test("estimateSessionContextBreakdown gives system a share when the agent prompt is missing", () => {
    const used = 48_900;
    const breakdown = estimateSessionContextBreakdown(used, {
      messages: [{ role: "user", parts: [{ type: "text", text: "写个分镜" }] }],
    });
    const byId = Object.fromEntries((breakdown ?? []).map((item) => [item.id, item.tokens]));
    expect(byId.system).toBeGreaterThan(0);
    expect(byId.tools).toBeGreaterThan(byId.system);
    expect(byId.messages).toBeGreaterThan(0);
    expect(byId.system + byId.tools + byId.messages).toBe(used);
    expect(byId.skills).toBe(0);
    expect(byId.connectors).toBe(0);
  });
});
