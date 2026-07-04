/** @jsxImportSource react */
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { CheckCircle2, Circle, Search } from "lucide-react";

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
import { MenuRowSurface } from "@/components/ui/action-row";
import { EmptyStateBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "../../../../i18n";
import { modelEquals } from "../../../../app/utils";
import type { ModelOption, ModelRef } from "../../../../app/types";

function ProviderIcon({
  providerId,
  size = 16,
  className,
}: {
  providerId: string;
  size?: number;
  className?: string;
}) {
  const initial = providerId.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        fontSize: Math.round(size * 0.65),
        fontWeight: 600,
      }}
    >
      {initial}
    </span>
  );
}

export type ProviderLinkItem = {
  providerID: string;
  title: string;
  matchCount: number;
  index: number;
};

export function ModelPickerDialog(props: {
  target: "default" | "session";
  query: string;
  totalOptions: number;
  filteredCount: number;
  current: ModelRef;
  searchInputRef: RefObject<HTMLInputElement | null>;
  activeIndex: number;
  renderedCount: number;
  recommendedOptions: { opt: ModelOption; index: number }[];
  otherEnabledOptions: { opt: ModelOption; index: number }[];
  otherOptions: ProviderLinkItem[];
  registerOptionRef: (index: number) => (el: HTMLDivElement | null) => void;
  onSetQuery: (value: string) => void;
  onSetActiveIndex: (index: number) => void;
  onSelect: (model: ModelRef) => void;
  onBehaviorChange: (model: ModelRef, value: string | null) => void;
  onOpenSettings: () => void;
  onClose: (options?: { restorePromptFocus?: boolean }) => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100vh-2rem)] min-h-0 w-full max-w-lg flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t(props.target === "default" ? "model_picker.default_model_title" : "model_picker.chat_model_title")}
          </DialogTitle>
          <DialogDescription>
            {t(props.target === "default" ? "model_picker.default_model_desc" : "model_picker.chat_model_desc")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          <ModelPickerSearch
            query={props.query}
            totalOptions={props.totalOptions}
            filteredCount={props.filteredCount}
            searchInputRef={props.searchInputRef}
            onSetQuery={props.onSetQuery}
          />
          <ModelPickerSections
            current={props.current}
            activeIndex={props.activeIndex}
            renderedCount={props.renderedCount}
            recommendedOptions={props.recommendedOptions}
            otherEnabledOptions={props.otherEnabledOptions}
            otherOptions={props.otherOptions}
            registerOptionRef={props.registerOptionRef}
            onSetActiveIndex={props.onSetActiveIndex}
            onSelect={props.onSelect}
            onBehaviorChange={props.onBehaviorChange}
            onOpenSettings={props.onOpenSettings}
            onClose={props.onClose}
          />
        </div>
        <DialogFooter className="shrink-0">
          <DialogClose render={<Button variant="outline" />}>
            {t("settings.done")}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModelPickerSearch(props: {
  query: string;
  totalOptions: number;
  filteredCount: number;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onSetQuery: (value: string) => void;
}) {
  return (
    <div className="mt-5 shrink-0">
      <InputGroup controlSize="lg" radius="xl" tone="surface">
        <InputGroupAddon align="inline-start">
          <Search size={16} />
        </InputGroupAddon>
        <InputGroupInput
          ref={props.searchInputRef}
          type="text"
          value={props.query}
          onChange={(event) => props.onSetQuery(event.currentTarget.value)}
          placeholder={t("settings.search_models")}
          className="text-sm text-dls-text placeholder:text-dls-secondary"
        />
      </InputGroup>
      {props.query.trim() ? (
        <div className="mt-2 text-xs text-dls-secondary">
          {t("settings.showing_models", { count: props.filteredCount, total: props.totalOptions })}
        </div>
      ) : null}
    </div>
  );
}

function ModelPickerSections(props: {
  current: ModelRef;
  activeIndex: number;
  renderedCount: number;
  recommendedOptions: { opt: ModelOption; index: number }[];
  otherEnabledOptions: { opt: ModelOption; index: number }[];
  otherOptions: ProviderLinkItem[];
  registerOptionRef: (index: number) => (el: HTMLDivElement | null) => void;
  onSetActiveIndex: (index: number) => void;
  onSelect: (model: ModelRef) => void;
  onBehaviorChange: (model: ModelRef, value: string | null) => void;
  onOpenSettings: () => void;
  onClose: (options?: { restorePromptFocus?: boolean }) => void;
}) {
  return (
    <div className="-mr-1 mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
      <ModelOptionsSection
        title={t("model_picker.recommended")}
        options={props.recommendedOptions}
        current={props.current}
        activeIndex={props.activeIndex}
        registerOptionRef={props.registerOptionRef}
        onSetActiveIndex={props.onSetActiveIndex}
        onSelect={props.onSelect}
        onBehaviorChange={props.onBehaviorChange}
      />
      <ModelOptionsSection
        title={t("model_picker.other_connected_models")}
        options={props.otherEnabledOptions}
        current={props.current}
        activeIndex={props.activeIndex}
        registerOptionRef={props.registerOptionRef}
        onSetActiveIndex={props.onSetActiveIndex}
        onSelect={props.onSelect}
        onBehaviorChange={props.onBehaviorChange}
      />
      {props.otherOptions.length > 0 ? (
        <section className="space-y-2">
          <div className="px-1 text-xs font-medium text-dls-secondary">
            {t("model_picker.more_providers")}
          </div>
          {props.otherOptions.map((provider) => (
            <ProviderLinkRow
              key={provider.providerID}
              provider={provider}
              activeIndex={props.activeIndex}
              registerOptionRef={props.registerOptionRef}
              onSetActiveIndex={props.onSetActiveIndex}
              onOpenSettings={props.onOpenSettings}
              onClose={props.onClose}
            />
          ))}
        </section>
      ) : null}
      {props.renderedCount === 0 ? (
        <EmptyStateBox size="comfortable">
          {t("model_picker.no_results")}
        </EmptyStateBox>
      ) : null}
    </div>
  );
}

function ModelOptionsSection(props: {
  title: string;
  options: { opt: ModelOption; index: number }[];
  current: ModelRef;
  activeIndex: number;
  registerOptionRef: (index: number) => (el: HTMLDivElement | null) => void;
  onSetActiveIndex: (index: number) => void;
  onSelect: (model: ModelRef) => void;
  onBehaviorChange: (model: ModelRef, value: string | null) => void;
}) {
  if (props.options.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="px-1 text-xs font-medium text-dls-secondary">
        {props.title}
      </div>
      {props.options.map(({ opt, index }) => (
        <ModelOptionRow
          key={`${opt.providerID}/${opt.modelID}`}
          opt={opt}
          index={index}
          activeIndex={props.activeIndex}
          current={props.current}
          registerOptionRef={props.registerOptionRef}
          onSetActiveIndex={props.onSetActiveIndex}
          onSelect={props.onSelect}
          onBehaviorChange={props.onBehaviorChange}
        />
      ))}
    </section>
  );
}

function ModelOptionRow(props: {
  opt: ModelOption;
  index: number;
  activeIndex: number;
  current: ModelRef;
  registerOptionRef: (index: number) => (el: HTMLDivElement | null) => void;
  onSetActiveIndex: (index: number) => void;
  onSelect: (model: ModelRef) => void;
  onBehaviorChange: (model: ModelRef, value: string | null) => void;
}) {
  const { opt } = props;
  const active = modelEquals(props.current, {
    providerID: opt.providerID,
    modelID: opt.modelID,
  });
  const isKeyboardActive = props.index === props.activeIndex;
  const selectOption = () => props.onSelect({ providerID: opt.providerID, modelID: opt.modelID });

  return (
    <MenuRowSurface
      role="button"
      tabIndex={0}
      ref={props.registerOptionRef(props.index)}
      active={active}
      className={[
        "group cursor-pointer",
        active
          ? ""
          : isKeyboardActive
            ? "bg-dls-surface-muted text-dls-text"
            : "hover:bg-dls-surface hover:text-dls-secondary",
      ].join(" ")}
      onMouseEnter={() => props.onSetActiveIndex(props.index)}
      onClick={selectOption}
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        selectOption();
      }}
    >
      <div className="flex items-start gap-3">
        <ProviderIcon
          providerId={opt.providerID}
          size={16}
          className={[
            "mt-[1px] shrink-0 transition-colors",
            active ? "text-dls-text" : "text-dls-secondary group-hover:text-dls-secondary",
          ].join(" ")}
        />
        <div className="flex-1 min-w-0">
          <div className={["text-sm flex items-center justify-between gap-2", active ? "font-medium text-dls-text" : "text-current"].join(" ")}>
            <span className="truncate">{opt.title}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              {opt.source === "cloud" ? (
                <StatusBadge shape="soft" size="tiny" tone="accent">
                  Cloud
                </StatusBadge>
              ) : null}
              {active ? (
                <StatusBadge shape="soft" size="tiny" tone="accent">
                  Current
                </StatusBadge>
              ) : null}
            </span>
          </div>
          <div className={["mt-0.5 flex items-center gap-3 text-xs", active ? "text-dls-secondary" : "text-dls-secondary group-hover:text-dls-secondary"].join(" ")}>
            <span className="truncate">{opt.description ?? opt.providerID}</span>
            <span className="ml-auto opacity-70 font-mono">
              {opt.providerID}/{opt.modelID}
            </span>
          </div>
          {opt.footer ? (
            <div className={["text-xs mt-1", active ? "text-dls-secondary" : "text-dls-secondary group-hover:text-dls-secondary"].join(" ")}>
              {opt.footer}
            </div>
          ) : null}
          {active && (opt.behaviorOptions?.length ?? 0) > 0 ? <ModelBehaviorOptions opt={opt} onBehaviorChange={props.onBehaviorChange} /> : null}
        </div>
      </div>
    </MenuRowSurface>
  );
}

function ModelBehaviorOptions(props: {
  opt: ModelOption;
  onBehaviorChange: (model: ModelRef, value: string | null) => void;
}) {
  return (
    <div role="presentation" className="mt-3 flex items-center gap-2" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <span className="text-xs font-medium text-dls-secondary mr-1">{props.opt.behaviorTitle}:</span>
      <div className="flex flex-wrap items-center gap-3">
        {(props.opt.behaviorOptions ?? []).map((option) => (
          <Button
            key={option.value ?? "default"}
            type="button"
            variant="ghost"
            size="xs"
            className={[
              "h-auto px-0",
              props.opt.behaviorValue === option.value ? "text-dls-text font-medium" : "text-dls-secondary hover:text-dls-text",
            ].join(" ")}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onBehaviorChange({ providerID: props.opt.providerID, modelID: props.opt.modelID }, option.value);
            }}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ProviderLinkRow(props: {
  provider: ProviderLinkItem;
  activeIndex: number;
  registerOptionRef: (index: number) => (el: HTMLDivElement | null) => void;
  onSetActiveIndex: (index: number) => void;
  onOpenSettings: () => void;
  onClose: (options?: { restorePromptFocus?: boolean }) => void;
}) {
  const isKeyboardActive = props.provider.index === props.activeIndex;
  const openProviderSettings = () => {
    props.onClose({ restorePromptFocus: false });
    props.onOpenSettings();
  };

  return (
    <MenuRowSurface
      role="button"
      tabIndex={0}
      ref={props.registerOptionRef(props.provider.index)}
      active={isKeyboardActive}
      className="group cursor-pointer hover:bg-dls-surface hover:text-dls-secondary"
      onMouseEnter={() => props.onSetActiveIndex(props.provider.index)}
      onClick={openProviderSettings}
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        openProviderSettings();
      }}
    >
      <div className="flex items-start gap-3">
        <ProviderIcon
          providerId={props.provider.providerID}
          size={16}
          className={[
            "mt-[1px] shrink-0 transition-colors",
            isKeyboardActive ? "text-dls-text" : "text-dls-secondary group-hover:text-dls-secondary",
          ].join(" ")}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm flex items-center justify-between gap-2 text-current">
            <span className="truncate">{props.provider.title}</span>
          </div>
          <div className={["mt-0.5 flex items-center gap-3 text-xs", isKeyboardActive ? "text-dls-secondary" : "text-dls-secondary group-hover:text-dls-secondary"].join(" ")}>
            <span className="truncate">{t("model_picker.connect_provider_hint")}</span>
            <span className="ml-auto opacity-70">{t("model_picker.model_count", { count: props.provider.matchCount })}</span>
          </div>
        </div>
      </div>
    </MenuRowSurface>
  );
}

export function ModelPickerSelectedIcon({ active }: { active: boolean }) {
  return active ? <CheckCircle2 size={14} /> : <Circle size={14} />;
}
