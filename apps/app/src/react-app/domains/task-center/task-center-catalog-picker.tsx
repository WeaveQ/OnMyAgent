/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { PersonalLocalAgent } from "@/app/lib/desktop-types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { t } from "@/i18n";
import {
  taskCenterModelsForAgent,
  type TaskCenterModelOption,
} from "./task-center-model";

function PickerEmpty(props: { children: string }) {
  return (
    <div className="px-3 py-5 text-center text-sm text-dls-secondary" role="status">
      {props.children}
    </div>
  );
}

export function TaskCenterAgentPicker(props: {
  agents: PersonalLocalAgent[];
  value: PersonalLocalAgent | null;
  onChange: (agent: PersonalLocalAgent) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const visibleAgents = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return props.agents;
    return props.agents.filter((agent) =>
      [agent.name, agent.id, agent.provider].some((value) =>
        value.toLocaleLowerCase().includes(normalized),
      ),
    );
  }, [props.agents, query]);
  const label = props.value?.name ?? t("task_center.select_agent_placeholder");

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={props.disabled || !props.agents.length}
            aria-label={props.label ?? t("task_center.agent_selector")}
            aria-expanded={open}
            aria-haspopup="listbox"
            className="w-full justify-between gap-2 text-start"
          >
            <span className="min-w-0 truncate">{label}</span>
            <ChevronDown className="size-4 shrink-0 text-dls-secondary" aria-hidden />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-80 gap-3 p-3" role="dialog">
        <PopoverHeader>
          <PopoverTitle>{props.label ?? t("task_center.agent_selector")}</PopoverTitle>
          <PopoverDescription>{t("task_center.selector_search_hint")}</PopoverDescription>
        </PopoverHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-dls-secondary" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("task_center.selector_search")}
            aria-label={t("task_center.selector_search")}
            className="ps-9"
            autoFocus
          />
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto" role="listbox" aria-label={props.label}>
          {visibleAgents.length ? (
            visibleAgents.map((agent) => {
              const selected = agent.id === props.value?.id;
              return (
                <button
                  key={agent.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-catalog-id={agent.id}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm transition-colors hover:bg-dls-hover focus-visible:bg-dls-hover focus-visible:outline-none"
                  onClick={() => {
                    props.onChange(agent);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{agent.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-dls-secondary">
                      {agent.provider} · {agent.id}
                    </span>
                  </span>
                  {selected ? <Check className="size-4 shrink-0 text-dls-accent" aria-hidden /> : null}
                </button>
              );
            })
          ) : (
            <PickerEmpty>{t("task_center.selector_no_results")}</PickerEmpty>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TaskCenterModelPicker(props: {
  agent: PersonalLocalAgent | null;
  value: TaskCenterModelOption | null;
  onChange: (model: TaskCenterModelOption | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const models = taskCenterModelsForAgent(props.agent);
  const visibleModels = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return models;
    return models.filter((model) =>
      [model.id, model.label].some((value) =>
        value.toLocaleLowerCase().includes(normalized),
      ),
    );
  }, [models, query]);
  const label = props.value?.label ?? t("task_center.default_model");

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={props.disabled || !props.agent}
            aria-label={props.label ?? t("task_center.model_selector")}
            aria-expanded={open}
            aria-haspopup="listbox"
            className="w-full justify-between gap-2 text-start"
          >
            <span className="min-w-0 truncate">{label}</span>
            <ChevronDown className="size-4 shrink-0 text-dls-secondary" aria-hidden />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-80 gap-3 p-3" role="dialog">
        <PopoverHeader>
          <PopoverTitle>{props.label ?? t("task_center.model_selector")}</PopoverTitle>
          <PopoverDescription>{t("task_center.model_selector_hint")}</PopoverDescription>
        </PopoverHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-dls-secondary" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("task_center.selector_search")}
            aria-label={t("task_center.selector_search")}
            className="ps-9"
            autoFocus
          />
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto" role="listbox" aria-label={props.label}>
          <button
            type="button"
            role="option"
            aria-selected={!props.value}
            data-catalog-model="default"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm transition-colors hover:bg-dls-hover focus-visible:bg-dls-hover focus-visible:outline-none"
            onClick={() => {
              props.onChange(null);
              setOpen(false);
              setQuery("");
            }}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{t("task_center.default_model")}</span>
              <span className="mt-0.5 block truncate text-xs text-dls-secondary">{t("task_center.default_model_hint")}</span>
            </span>
            {!props.value ? <Check className="size-4 shrink-0 text-dls-accent" aria-hidden /> : null}
          </button>
          {visibleModels.length ? (
            visibleModels.map((model) => {
              const selected = model.id === props.value?.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-catalog-model={model.id}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm transition-colors hover:bg-dls-hover focus-visible:bg-dls-hover focus-visible:outline-none"
                  onClick={() => {
                    props.onChange(model);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{model.label}</span>
                    <span className="mt-0.5 block truncate text-xs text-dls-secondary">{model.id}</span>
                  </span>
                  {selected ? <Check className="size-4 shrink-0 text-dls-accent" aria-hidden /> : null}
                </button>
              );
            })
          ) : query ? (
            <PickerEmpty>{t("task_center.selector_no_results")}</PickerEmpty>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
