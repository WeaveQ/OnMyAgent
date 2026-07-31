/**
 * Turn-end follow-up chips: prefer model-emitted markers; otherwise derive
 * next-step prompts from the latest user + assistant turn (stage-aware).
 */

const FOLLOWUPS_FENCE_RE =
  /(?:^|\n)\s*:::followups\s*\n([\s\S]*?)\n\s*:::\s*(?:\n|$)/i;
const FOLLOWUPS_COMMENT_RE =
  /<!--\s*followups\s*([\s\S]*?)-->/i;

const MAX_SUGGESTIONS = 4;
const MIN_LABEL_LEN = 2;
const MAX_LABEL_LEN = 48;

/**
 * Standalone "文件路径：xxx.xlsx" lines are redundant with the product-card strip.
 * Keep them out of the bubble; open-target may still scan raw message text.
 */
function isDeclaredDeliverablePathLine(line: string): boolean {
  return /^(?:文件路径|File path)\s*[:：]\s*\S+\s*$/iu.test(line.trim());
}

export function stripDeclaredDeliverablePathLines(text: string): string {
  if (!text) return text;
  return text
    .split("\n")
    .filter((line) => !isDeclaredDeliverablePathLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export function stripFollowUpMarkers(text: string): string {
  return stripDeclaredDeliverablePathLines(text)
    .replace(FOLLOWUPS_FENCE_RE, "\n")
    .replace(FOLLOWUPS_COMMENT_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export function parseFollowUpMarkers(text: string): string[] {
  const fence = text.match(FOLLOWUPS_FENCE_RE);
  const comment = text.match(FOLLOWUPS_COMMENT_RE);
  const raw = fence?.[1] ?? comment?.[1] ?? "";
  if (!raw.trim()) return [];
  return normalizeSuggestionList(
    raw
      .split("\n")
      .map((line) => line.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
      .filter(Boolean),
  );
}

function normalizeSuggestionList(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const label = item.replace(/\s+/g, " ").trim();
    if (label.length < MIN_LABEL_LEN || label.length > MAX_LABEL_LEN) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

function agentPackageName(agentId: string | null | undefined): string | null {
  if (!agentId) return null;
  const trimmed = agentId.trim();
  if (!trimmed) return null;
  const colon = trimmed.lastIndexOf(":");
  return colon >= 0 ? trimmed.slice(colon + 1) : trimmed;
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

/** True when assistant is still waiting for materials, not delivering results. */
function isAwaitingUserMaterials(assistantText: string): boolean {
  const invite = includesAny(assistantText, [
    "丢过来",
    "发过来",
    "发给我",
    "发我",
    "发吧",
    "先读内容",
    "我先读",
    "把手头",
    "把资料",
    "资料直接",
    "直接丢",
    "还没看到",
    "等你发",
    "先把",
    "再动手",
    "没有材料",
    "没有文件",
    "你发",
  ]);
  const futureOnly =
    includesAny(assistantText, ["我会", "可以帮你", "我来", "整理发货信息我来"]) &&
    !hasDeliveredResult(assistantText);
  return invite || futureOnly;
}

/** Strong signals that a concrete result was already produced this turn. */
function hasDeliveredResult(assistantText: string): boolean {
  return includesAny(assistantText, [
    "已整理",
    "整理如下",
    "整理结果",
    "这票结论",
    "已确认信息",
    "还缺 / 有风险",
    "缺失项",
    "缺项清单",
    "补问话术如下",
    "可直接发给客户",
    "成本参考",
    "最低可报",
    "建议客户价",
    "预估毛利",
    "差异清单",
    "对不上的地方",
    "一票一行",
    "| 发货人",
    "| 收货人",
    "发货信息表",
  ]);
}

function hasDeliveredQuote(assistantText: string): boolean {
  return (
    includesAny(assistantText, ["建议客户价", "最低可报", "预估毛利", "报价建议"]) &&
    hasDeliveredResult(assistantText)
  );
}

function hasDeliveredAudit(assistantText: string): boolean {
  return includesAny(assistantText, [
    "缺项清单",
    "还缺：",
    "缺失项",
    "补问话术如下",
    "可直接发给客户的补问",
    "高风险缺失",
  ]);
}

function hasDeliveredStructure(assistantText: string): boolean {
  return includesAny(assistantText, [
    "已整理",
    "整理如下",
    "发货信息表",
    "一票一行",
    "标准发货",
    "| 发货人",
    "| 收货人",
  ]);
}

function hasDeliveredConsistency(assistantText: string): boolean {
  return includesAny(assistantText, [
    "差异清单",
    "对不上的地方",
    "订单写错",
    "核对结果",
    "一致项",
  ]);
}

type OrderDispatchStage =
  | "awaiting_input"
  | "after_structure"
  | "after_audit"
  | "after_quote"
  | "after_consistency"
  | "generic";

function detectOrderDispatchStage(
  assistantText: string,
  userText: string,
): OrderDispatchStage {
  if (hasDeliveredQuote(assistantText)) return "after_quote";
  if (hasDeliveredConsistency(assistantText)) return "after_consistency";
  if (hasDeliveredAudit(assistantText)) return "after_audit";
  if (hasDeliveredStructure(assistantText)) return "after_structure";
  if (isAwaitingUserMaterials(assistantText)) return "awaiting_input";

  // User only asked to start, assistant has not delivered yet
  if (
    includesAny(userText, ["整理", "发货", "看看", "报价", "核对", "缺什么"]) &&
    !hasDeliveredResult(assistantText)
  ) {
    return "awaiting_input";
  }
  return "generic";
}

function orderDispatchHeuristics(
  assistantText: string,
  userText: string,
): string[] {
  const stage = detectOrderDispatchStage(assistantText, userText);

  switch (stage) {
    case "awaiting_input":
      return normalizeSuggestionList([
        "这是客户聊天和截图，帮我整理",
        "我发一份 Excel 发货表给你",
        "按我公司模板整理一版",
        "资料在图片里，你先读一下",
      ]);
    case "after_structure":
      return normalizeSuggestionList([
        "检查这票还缺什么",
        "根据这份表帮我算报价",
        "导出成 Excel",
        "冷链/城配字段再补全一下",
      ]);
    case "after_audit":
      return normalizeSuggestionList([
        "按这段补问话术发给客户",
        "客户补齐后继续帮我算报价",
        "缺项先按假设出一版草稿报价",
      ]);
    case "after_quote":
      return normalizeSuggestionList([
        "把报价和订单再核对一遍",
        "导出一份可发给客户的报价表",
        "写一段报价确认话术",
      ]);
    case "after_consistency":
      return normalizeSuggestionList([
        "按差异清单改一版订单字段",
        "写一段给客户确认的话",
        "改完后再检查一遍",
      ]);
    default:
      return normalizeSuggestionList([
        "帮我整理这票发货信息",
        "检查还缺什么",
        "帮我算怎么报价",
        "检查订单有没有写错",
      ]);
  }
}

function fleetHeuristics(assistantText: string, userText: string): string[] {
  if (isAwaitingUserMaterials(assistantText) || !hasDeliveredResult(assistantText)) {
    if (includesAny(userText, ["挑车", "派车", "车辆"])) {
      return normalizeSuggestionList([
        "这是订单和车辆表，帮我挑车",
        "我发车辆司机资料给你",
      ]);
    }
    return normalizeSuggestionList([
      "帮我挑合适的车",
      "派车前帮我检查",
      "写好派车信息",
    ]);
  }
  if (includesAny(assistantText, ["优先", "备选", "不建议", "候选"])) {
    return normalizeSuggestionList([
      "派车前再帮我检查一遍",
      "写好发给司机的任务信息",
    ]);
  }
  return normalizeSuggestionList([
    "帮我挑合适的车",
    "派车前帮我检查",
    "写好派车信息",
  ]);
}

function fulfillmentHeuristics(assistantText: string, userText: string): string[] {
  if (isAwaitingUserMaterials(assistantText) || !hasDeliveredResult(assistantText)) {
    if (includesAny(userText, ["到哪", "进度", "在途"])) {
      return normalizeSuggestionList([
        "这是司机群聊，帮我整理进度",
        "客户在催，先写一版通知",
      ]);
    }
    return normalizeSuggestionList([
      "整理货现在到哪里了",
      "帮我写客户进度通知",
      "检查签收回单",
    ]);
  }
  if (includesAny(assistantText, ["异常", "延误", "破损", "拒收"])) {
    return normalizeSuggestionList([
      "写一版客户延误说明",
      "检查回单能不能结账",
    ]);
  }
  return normalizeSuggestionList([
    "根据这份进度写客户通知",
    "继续检查异常证据还缺什么",
    "检查签收回单",
  ]);
}

function financeHeuristics(assistantText: string, userText: string): string[] {
  if (isAwaitingUserMaterials(assistantText) || !hasDeliveredResult(assistantText)) {
    if (includesAny(userText, ["对账", "账单", "结账"])) {
      return normalizeSuggestionList([
        "这是运单和账单，帮我对一下",
        "我发几张表给你合并",
      ]);
    }
    return normalizeSuggestionList([
      "把运单和账单合到一起",
      "找出哪些金额对不上",
      "算这票赚不赚钱",
    ]);
  }
  if (includesAny(assistantText, ["差额", "对不上", "少收", "多付"])) {
    return normalizeSuggestionList([
      "检查这票能不能结账",
      "整理开票资料",
    ]);
  }
  return normalizeSuggestionList([
    "继续查差额原因",
    "检查这票能不能结账",
    "整理开票申请",
  ]);
}

function genericHeuristics(
  assistantText: string,
  userText: string,
  quickPrompts: string[],
): string[] {
  if (isAwaitingUserMaterials(assistantText)) {
    return normalizeSuggestionList([
      "这是相关资料，你先看一下",
      "我补充一下背景和要求",
      "按这个方向继续",
    ]);
  }

  const fromQuick = quickPrompts
    .map((prompt) => prompt.trim())
    .filter((prompt) => prompt.length > 0 && prompt.length <= MAX_LABEL_LEN)
    .slice(0, MAX_SUGGESTIONS);
  if (fromQuick.length > 0) return normalizeSuggestionList(fromQuick);

  if (includesAny(assistantText, ["表格", "Excel", "文件", "导出"])) {
    return normalizeSuggestionList([
      "导出成 Excel",
      "按我的模板再改一版",
      "继续补充还缺的信息",
    ]);
  }
  if (includesAny(userText, ["继续", "然后", "下一步"])) {
    return normalizeSuggestionList([
      "按刚才说的继续",
      "再检查一遍有没有遗漏",
    ]);
  }
  return normalizeSuggestionList([
    "继续完善刚才的结果",
    "再检查一遍有没有遗漏",
    "按这个结果生成一份文件",
  ]);
}

export function resolveFollowUpSuggestions(input: {
  lastAssistantText: string;
  lastUserText?: string;
  agentId?: string | null;
  quickPrompts?: string[];
}): string[] {
  const assistantText = input.lastAssistantText.trim();
  if (!assistantText) return [];

  const marked = parseFollowUpMarkers(assistantText);
  if (marked.length > 0) return marked;

  const packageName = agentPackageName(input.agentId);
  const quickPrompts = input.quickPrompts ?? [];
  const userText = (input.lastUserText ?? "").trim();

  if (packageName === "order-dispatch-specialist") {
    return orderDispatchHeuristics(assistantText, userText);
  }
  if (packageName === "fleet-management-specialist") {
    return fleetHeuristics(assistantText, userText);
  }
  if (packageName === "fulfillment-specialist") {
    return fulfillmentHeuristics(assistantText, userText);
  }
  if (packageName === "logistics-finance-specialist") {
    return financeHeuristics(assistantText, userText);
  }
  return genericHeuristics(assistantText, userText, quickPrompts);
}

function messageText(
  message: { parts?: ReadonlyArray<{ type?: string; text?: string }> } | undefined,
): string {
  if (!message) return "";
  return (message.parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

export function latestAssistantText(
  messages: ReadonlyArray<{ role?: string; parts?: ReadonlyArray<{ type?: string; text?: string }> }>,
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const text = messageText(message);
    if (text) return text;
  }
  return "";
}

/** User text that immediately precedes the latest assistant reply. */
export function latestUserTextBeforeAssistant(
  messages: ReadonlyArray<{ role?: string; parts?: ReadonlyArray<{ type?: string; text?: string }> }>,
): string {
  let sawAssistant = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === "assistant") {
      if (messageText(message)) sawAssistant = true;
      continue;
    }
    if (sawAssistant && message.role === "user") {
      const text = messageText(message);
      if (text) return text;
    }
  }
  return "";
}
