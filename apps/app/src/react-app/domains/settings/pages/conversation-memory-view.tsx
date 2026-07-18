/** @jsxImportSource react */
import { useCallback, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

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
  SettingsBlock,
  SettingsBlockRow,
  SettingsPageSection,
} from "../settings-section";
import { LayoutStack } from "../settings-layout";

const MAX_MEMORY_ITEMS = 50;
const MAX_MEMORY_TEXT_CHARS = 500;

export type ConversationMemoryViewProps = {
  conversationMemory: ConversationMemoryState;
  onConversationMemoryChange: (next: ConversationMemoryState) => void;
};

export function ConversationMemoryView(props: ConversationMemoryViewProps) {
  const { conversationMemory, onConversationMemoryChange } = props;
  const [manualText, setManualText] = useState("");

  const sortedItems = useMemo(
    () =>
      [...conversationMemory.items].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversationMemory.items],
  );

  const addManualMemory = useCallback(() => {
    const text = manualText.trim().slice(0, MAX_MEMORY_TEXT_CHARS);
    if (!text) return;
    const item: ConversationMemoryItem = {
      id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      text,
      source: "manual",
      updatedAt: Date.now(),
    };
    const items = [item, ...conversationMemory.items].slice(0, MAX_MEMORY_ITEMS);
    onConversationMemoryChange({ ...conversationMemory, items });
    setManualText("");
  }, [conversationMemory, manualText, onConversationMemoryChange]);

  const removeMemory = useCallback(
    (id: string) => {
      onConversationMemoryChange({
        ...conversationMemory,
        items: conversationMemory.items.filter((item) => item.id !== id),
      });
    },
    [conversationMemory, onConversationMemoryChange],
  );

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
                description={t("settings.memory_conversation_add_placeholder")}
                actions={
                  <Button
                    type="button"
                    size="sm"
                    disabled={!manualText.trim()}
                    onClick={addManualMemory}
                  >
                    <Plus className="size-4" />
                    {t("settings.memory_conversation_add")}
                  </Button>
                }
              >
                <Textarea
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder={t(
                    "settings.memory_conversation_add_placeholder",
                  )}
                  className="min-h-28 w-full resize-y bg-dls-surface-muted py-2.5 text-sm leading-6 placeholder:text-dls-secondary/70"
                  maxLength={MAX_MEMORY_TEXT_CHARS}
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
                  {sortedItems.map((item) => (
                    <li key={item.id}>
                      <SettingsBlockRow
                        align="start"
                        title={
                          <span className="whitespace-pre-wrap break-words font-normal leading-6">
                            {item.text}
                          </span>
                        }
                        description={
                          <span>
                            {item.source === "manual"
                              ? t("settings.memory_conversation_source_manual")
                              : t("settings.memory_conversation_source_dialog")}
                            {" · "}
                            {t("settings.memory_conversation_updated", {
                              time: formatRelativeTime(item.updatedAt),
                            })}
                          </span>
                        }
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
                  ))}
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
