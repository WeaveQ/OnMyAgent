/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown, ChevronRight, Search, Star } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { MenuRowButton } from "@/components/ui/action-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { modelEquals, resolveProviderDisplayName } from "../../../../app/utils";
import type { ModelOption, ModelRef } from "../../../../app/types";
import { isDefaultVisibleModel, isRecommendedModel } from "../../../../app/defaults";
import { ProviderIcon } from "../../../design-system/provider-icon";
import { t } from "../../../../i18n";

const HIDDEN_MODELS_KEY = "onmyagent.hiddenModels";
const HIDDEN_MODELS_SEEDED_KEY = "onmyagent.hiddenModelsSeeded";

/**
 * Seed the hidden models set on first run. For providers with curated
 * default-visible lists (OpenAI, Anthropic), hide everything except
 * the top picks defined in app/defaults/models.ts.
 */
function seedHiddenModels(options: ModelOption[]): Set<string> {
  const hidden = new Set<string>();
  for (const opt of options) {
    if (!isDefaultVisibleModel(opt.providerID, opt.modelID)) {
      hidden.add(`${opt.providerID}/${opt.modelID}`);
    }
  }
  return hidden;
}

export function readHiddenModels(): Set<string> {
  try {
    const raw = window.localStorage.getItem(HIDDEN_MODELS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function writeHiddenModels(hidden: Set<string>): void {
  try {
    window.localStorage.setItem(HIDDEN_MODELS_KEY, JSON.stringify([...hidden]));
  } catch {}
}

function hasSeededHiddenModels(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_MODELS_SEEDED_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeededHiddenModels(): void {
  try {
    window.localStorage.setItem(HIDDEN_MODELS_SEEDED_KEY, "1");
  } catch {}
}

export type ModelPickerModalProps = {
  open: boolean;
  options: ModelOption[];
  disabledProviders?: string[];
  query: string;
  setQuery: (value: string) => void;
  target: "default" | "session";
  current: ModelRef;
  onSelect: (model: ModelRef) => void;
  onBehaviorChange: (model: ModelRef, value: string | null) => void;
  onToggleProvider?: (providerId: string, enabled: boolean) => void;
  onOpenSettings: () => void;
  onClose: (options?: { restorePromptFocus?: boolean }) => void;
};

type ProviderGroup = {
  id: string;
  name: string;
  isNew: boolean;
  isCloud: boolean;
  isDisabled: boolean;
  hasCurrent: boolean;
  recommended: ModelOption[];
  other: ModelOption[];
};

export function ModelPickerModal(props: ModelPickerModalProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(() => readHiddenModels());

  const disabledSet = useMemo(
    () => new Set(props.disabledProviders ?? []),
    [props.disabledProviders],
  );

  // Reset on open + seed defaults on first run
  useEffect(() => {
    if (props.open) {
      props.setQuery("");
      if (!hasSeededHiddenModels() && props.options.length > 0) {
        const seeded = seedHiddenModels(props.options);
        writeHiddenModels(seeded);
        markSeededHiddenModels();
        setHiddenModels(seeded);
      } else {
        setHiddenModels(readHiddenModels());
      }
    }
  }, [props.open, props.options]);

  // Focus search
  useEffect(() => {
    if (!props.open) return;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [props.open]);

  // Filter by search
  const filteredOptions = useMemo(() => {
    const q = props.query.trim().toLowerCase();
    if (!q) return props.options;
    return props.options.filter(
      (o) =>
        o.title.toLowerCase().includes(q) ||
        o.providerID.toLowerCase().includes(q) ||
        o.modelID.toLowerCase().includes(q) ||
        (o.description ?? "").toLowerCase().includes(q),
    );
  }, [props.options, props.query]);

  // Group by provider
  const providerGroups = useMemo<ProviderGroup[]>(() => {
    const map = new Map<string, ProviderGroup>();
    for (const opt of filteredOptions) {
      let group = map.get(opt.providerID);
      if (!group) {
        group = {
          id: opt.providerID,
          name: opt.description ?? resolveProviderDisplayName(opt.providerID),
          isNew: !!opt.isRecommended,
          isCloud: opt.source === "cloud",
          isDisabled: disabledSet.has(opt.providerID),
          hasCurrent: false,
          recommended: [],
          other: [],
        };
        map.set(opt.providerID, group);
      }
      if (isRecommendedModel(opt.modelID)) {
        group.recommended.push(opt);
      } else {
        group.other.push(opt);
      }
      if (modelEquals(props.current, { providerID: opt.providerID, modelID: opt.modelID })) {
        group.hasCurrent = true;
      }
    }
    return [...map.values()].sort((a, b) => {
      if (a.isDisabled !== b.isDisabled) return a.isDisabled ? 1 : -1;
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      if (a.hasCurrent !== b.hasCurrent) return a.hasCurrent ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredOptions, props.current, disabledSet]);

  // Auto-expand on search
  useEffect(() => {
    if (props.query.trim()) {
      setExpandedProviders(new Set(providerGroups.map((g) => g.id)));
    }
  }, [props.query, providerGroups]);

  // Expand current provider on open
  useEffect(() => {
    if (!props.open) return;
    const current = providerGroups.find((g) => g.hasCurrent);
    if (current) setExpandedProviders(new Set([current.id]));
  }, [props.open]);

  const toggleProvider = useCallback((id: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleModelVisible = useCallback((providerID: string, modelID: string) => {
    const key = `${providerID}/${modelID}`;
    setHiddenModels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      writeHiddenModels(next);
      return next;
    });
  }, []);

  const batchToggleProvider = useCallback((providerID: string, showAll: boolean) => {
    setHiddenModels((prev) => {
      const next = new Set(prev);
      const models = filteredOptions.filter((o) => o.providerID === providerID);
      for (const m of models) {
        const key = `${m.providerID}/${m.modelID}`;
        if (showAll) {
          next.delete(key);
        } else {
          next.add(key);
        }
      }
      writeHiddenModels(next);
      return next;
    });
  }, [filteredOptions]);

  const handleSelect = useCallback(
    (opt: ModelOption) => props.onSelect({ providerID: opt.providerID, modelID: opt.modelID }),
    [props.onSelect],
  );

  // Escape
  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); props.onClose(); }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [props.open]);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100vh-2rem)] min-h-0 w-full max-w-lg flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("session.models_title")}</DialogTitle>
          <DialogDescription>
            {t("model_picker.session_model_desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          {/* Search */}
          <InputGroup controlSize="lg" radius="xl" tone="surface" className="mb-4 shrink-0">
            <InputGroupAddon align="inline-start">
              <Search size={16} />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchInputRef}
              type="text"
              className="text-sm text-dls-text placeholder:text-dls-secondary"
              placeholder={t("model_picker.search_placeholder")}
              value={props.query}
              onChange={(e) => props.setQuery(e.target.value)}
            />
          </InputGroup>

          {/* Content */}
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 -mr-1">
            {providerGroups.length === 0 ? (
              <div className="space-y-3 rounded-xl border border-dls-border bg-dls-surface-muted px-4 py-6 text-center">
                <div className="text-sm text-dls-secondary">
                  {props.query.trim() ? t("model_picker.no_results") : t("model_picker.no_models_connect_provider")}
                </div>
                {!props.query.trim() ? (
                  <Button variant="outline" onClick={props.onOpenSettings}>
                    Connect a provider
                  </Button>
                ) : null}
              </div>
            ) : (
              providerGroups.map((group) => (
                <ProviderAccordion
                  key={group.id}
                  group={group}
                  expanded={expandedProviders.has(group.id)}
                  current={props.current}
                  canToggleProvider={!!props.onToggleProvider}
                  onToggleExpand={() => toggleProvider(group.id)}
                  onToggleProvider={props.onToggleProvider}
                  onSelect={handleSelect}
                />
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="shrink-0">
          <DialogClose render={<Button variant="outline" />}>
            Done
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Provider accordion                                                 */
/* ------------------------------------------------------------------ */

function ProviderAccordion({
  group,
  expanded,
  current,
  canToggleProvider,
  onToggleExpand,
  onToggleProvider,
  onSelect,
}: {
  group: ProviderGroup;
  expanded: boolean;
  current: ModelRef;
  canToggleProvider: boolean;
  onToggleExpand: () => void;
  onToggleProvider?: (providerId: string, enabled: boolean) => void;
  onSelect: (opt: ModelOption) => void;
}) {
  const totalModels = group.recommended.length + group.other.length;
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div className={group.isDisabled ? "opacity-50" : ""}>
      {/* Provider header */}
      <div className="flex items-center gap-1">
        <MenuRowButton
          type="button"
          align="center"
          className="min-w-0 flex-1 gap-3 py-2.5"
          onClick={onToggleExpand}
        >
          <Chevron size={14} className="shrink-0 text-dls-secondary" />
          <ProviderIcon providerId={group.id} size={18} className="shrink-0 text-dls-text" />
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium text-dls-text">{group.name}</span>
            <span className="ml-2 text-xs text-dls-secondary">
              {totalModels} model{totalModels === 1 ? "" : "s"}
            </span>
          </div>
          <span className="flex shrink-0 items-center gap-1.5">
            {group.isNew ? (
              <StatusBadge shape="soft" size="tiny" tone="accent">{t("session.badge_new")}</StatusBadge>
            ) : null}
            {group.isCloud ? (
              <StatusBadge shape="soft" size="tiny" tone="surface">{t("session.badge_cloud")}</StatusBadge>
            ) : null}
            {group.hasCurrent ? (
              <StatusBadge shape="soft" size="tiny" tone="accent">{t("session.badge_current")}</StatusBadge>
            ) : null}
          </span>
        </MenuRowButton>
        {canToggleProvider ? (
          <Button
            type="button"
            variant={group.isDisabled ? "outline" : "secondary"}
            size="xs"
            className={group.isDisabled ? "mr-2 rounded-full text-dls-secondary hover:bg-dls-hover hover:text-dls-text" : "mr-2 rounded-full bg-dls-accent/10 text-dls-accent hover:bg-dls-accent/10"}
            onClick={(e) => { e.stopPropagation(); onToggleProvider?.(group.id, group.isDisabled); }}
            title={group.isDisabled ? t("session.enable_provider") : t("session.disable_provider")}
          >
            {group.isDisabled ? "Enable" : "Enabled"}
          </Button>
        ) : null}
      </div>

      {/* Models */}
      {expanded && !group.isDisabled ? (
        <div className="ml-9 space-y-0.5 pb-2 pt-0.5">
          {group.recommended.length > 0 ? (
            <>
              <div className="px-2 pb-1 pt-2 text-xs font-medium text-dls-secondary">
                Recommended
              </div>
              {group.recommended.map((opt) => (
                <DefaultModelRow key={opt.modelID} opt={opt} current={current} onSelect={onSelect} recommended />
              ))}
            </>
          ) : null}
          {group.other.length > 0 ? (
            <>
              {group.recommended.length > 0 ? (
                <div className="px-2 pb-1 pt-2 text-xs font-medium text-dls-secondary">
                  All models
                </div>
              ) : null}
              {group.other.map((opt) => (
                <DefaultModelRow key={opt.modelID} opt={opt} current={current} onSelect={onSelect} />
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Default tab: model row (click to select as default)                */
/* ------------------------------------------------------------------ */

function DefaultModelRow({
  opt, current, onSelect, recommended,
}: {
  opt: ModelOption; current: ModelRef; onSelect: (opt: ModelOption) => void; recommended?: boolean;
}) {
  const active = modelEquals(current, { providerID: opt.providerID, modelID: opt.modelID });

  return (
    <MenuRowButton
      type="button"
      align="center"
      className={[
        "gap-2 rounded-lg px-2 py-1.5",
        active ? "bg-dls-accent/10" : "hover:bg-dls-hover",
      ].join(" ")}
      onClick={() => onSelect(opt)}
    >
      {recommended ? <Star size={12} className="shrink-0 text-dls-status-warning" /> : <div className="w-3 shrink-0" />}
      <div className="min-w-0 flex-1">
        <span className={["text-xs", active ? "font-medium text-dls-text" : "text-dls-text"].join(" ")}>{opt.title}</span>
        <span className="ml-2 font-mono text-xs text-dls-secondary/60">{opt.modelID}</span>
      </div>
      {active ? <Check size={14} className="shrink-0 text-dls-accent" /> : null}
    </MenuRowButton>
  );
}
