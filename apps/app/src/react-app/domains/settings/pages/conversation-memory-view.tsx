/** @jsxImportSource react */
import { useCallback, useMemo, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyStateBox } from "@/components/ui/notice-box";
import { t } from "@/i18n";
import { formatRelativeTime } from "../../../../app/utils";
import type {
  ConversationMemoryItem,
  ConversationMemoryState,
} from "../../../kernel/local-provider";
import {
  MAX_CONVERSATION_MEMORY_ITEMS,
  MAX_CONVERSATION_MEMORY_TEXT_CHARS,
  appendMemoryItems,
  buildPersonalProfileInsightPrompt,
  createConversationMemoryId,
  importProfileBlockToItems,
  parseProfileMemoryLine,
  type MemoryProfileCategory,
} from "../../shared";
import {
  SettingsBlock,
  SettingsBlockRow,
  SettingsPageSection,
} from "../settings-section";
import { LayoutStack } from "../settings-layout";

export type ConversationMemoryViewProps = {
  conversationMemory: ConversationMemoryState;
  onConversationMemoryChange: (next: ConversationMemoryState) => void;
};

function categoryLabel(category: MemoryProfileCategory | null): string {
  switch (category) {
    case "instruction":
      return t("settings.memory_category_instruction");
    case "identity":
      return t("settings.memory_category_identity");
    case "career":
      return t("settings.memory_category_career");
    case "project":
      return t("settings.memory_category_project");
    case "preference":
      return t("settings.memory_category_preference");
    default:
      return t("settings.memory_conversation_source_manual");
  }
}

export function ConversationMemoryView(props: ConversationMemoryViewProps) {
  const { conversationMemory, onConversationMemoryChange } = props;
  const [manualText, setManualText] = useState("");
  const [copyHint, setCopyHint] = useState(false);

  const sortedItems = useMemo(
    () =>
      [...conversationMemory.items].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversationMemory.items],
  );

  const addManualMemory = useCallback(() => {
    const raw = manualText.trim();
    if (!raw) return;

    // Multi-line / profile paste → split into category lines when possible.
    if (raw.includes("\n") || /^#{0,3}\s*\S+/m.test(raw)) {
      const imported = importProfileBlockToItems(raw);
      if (imported.length > 0) {
        onConversationMemoryChange(
          appendMemoryItems(conversationMemory, imported),
        );
        setManualText("");
        return;
      }
    }

    const text = raw.slice(0, MAX_CONVERSATION_MEMORY_TEXT_CHARS);
    const item: ConversationMemoryItem = {
      id: createConversationMemoryId("mem"),
      text,
      source: "manual",
      updatedAt: Date.now(),
    };
    const items = [item, ...conversationMemory.items].slice(
      0,
      MAX_CONVERSATION_MEMORY_ITEMS,
    );
    onConversationMemoryChange({
      ...conversationMemory,
      items,
      pending: conversationMemory.pending ?? [],
    });
    setManualText("");
  }, [conversationMemory, manualText, onConversationMemoryChange]);

  const removeMemory = useCallback(
    (id: string) => {
      onConversationMemoryChange({
        ...conversationMemory,
        items: conversationMemory.items.filter((item) => item.id !== id),
        pending: conversationMemory.pending ?? [],
      });
    },
    [conversationMemory, onConversationMemoryChange],
  );

  const copyInsightPrompt = useCallback(async () => {
    const prompt = buildPersonalProfileInsightPrompt();
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyHint(true);
      window.setTimeout(() => setCopyHint(false), 2000);
    } catch {
      setManualText(prompt);
    }
  }, []);

  return (
    <LayoutStack className="gap-y-8">
      <SettingsPageSection
        title={t("settings.memory_conversation_section")}
        description={t("settings.memory_conversation_section_desc")}
      >
        <SettingsBlock>
          <SettingsBlockRow
            align="start"
            title={t("settings.memory_conversation_toggle")}
            description={t("settings.memory_conversation_toggle_desc")}
            actions={
              <Switch
                checked={conversationMemory.enabled}
                onCheckedChange={(checked) =>
                  onConversationMemoryChange({
                    ...conversationMemory,
                    enabled: checked === true,
                    pending: conversationMemory.pending ?? [],
                  })
                }
                aria-label={t("settings.memory_conversation_toggle")}
              />
            }
          />

          {conversationMemory.enabled ? (
            <>
              <SettingsBlockRow
                align="start"
                title={t("settings.memory_conversation_add_label")}
                description={t("settings.memory_conversation_add_hint")}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void copyInsightPrompt()}
                    >
                      <Copy className="size-4" />
                      {copyHint
                        ? t("settings.memory_conversation_prompt_copied")
                        : t("settings.memory_conversation_copy_prompt")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!manualText.trim()}
                      onClick={addManualMemory}
                    >
                      <Plus className="size-4" />
                      {t("settings.memory_conversation_add")}
                    </Button>
                  </div>
                }
              >
                <Textarea
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder={t(
                    "settings.memory_conversation_add_placeholder",
                  )}
                  className="min-h-28 w-full resize-y bg-dls-surface-muted py-2.5 text-sm leading-6 placeholder:text-dls-secondary/70"
                  maxLength={4000}
                  onKeyDown={(event) => {
                    if (
                      (event.metaKey || event.ctrlKey) &&
                      event.key === "Enter" &&
                      manualText.trim()
                    ) {
                      event.preventDefault();
                      addManualMemory();
                    }
                  }}
                />
              </SettingsBlockRow>

              {sortedItems.length === 0 ? (
                <div className="px-4 py-4">
                  <EmptyStateBox
                    size="comfortable"
                    tone="muted"
                    className="text-sm leading-6"
                  >
                    {t("settings.memory_conversation_empty")}
                  </EmptyStateBox>
                </div>
              ) : (
                <ul className="divide-y divide-dls-border">
                  {sortedItems.map((item) => {
                    const parsed = parseProfileMemoryLine(item.text);
                    const title = parsed.content || item.text;
                    const metaParts = [
                      item.source === "manual"
                        ? t("settings.memory_conversation_source_manual")
                        : t("settings.memory_conversation_source_dialog"),
                      categoryLabel(parsed.category),
                      parsed.date !== "unknown" ? parsed.date : null,
                      t("settings.memory_conversation_updated", {
                        time: formatRelativeTime(item.updatedAt),
                      }),
                    ].filter(Boolean);
                    return (
                      <li key={item.id}>
                        <SettingsBlockRow
                          align="start"
                          title={
                            <span className="whitespace-pre-wrap break-words font-normal leading-6">
                              {title}
                            </span>
                          }
                          description={<span>{metaParts.join(" · ")}</span>}
                          actions={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-dls-secondary hover:text-dls-status-danger-fg"
                              onClick={() => removeMemory(item.id)}
                              aria-label={t(
                                "settings.memory_conversation_delete",
                              )}
                              title={t("settings.memory_conversation_delete")}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : (
            <div className="px-4 py-3.5">
              <p className="text-sm leading-5 text-dls-secondary">
                {t("settings.memory_conversation_disabled_hint")}
              </p>
            </div>
          )}
        </SettingsBlock>
      </SettingsPageSection>
    </LayoutStack>
  );
}
