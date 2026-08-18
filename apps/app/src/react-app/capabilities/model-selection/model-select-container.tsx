"use client";

import * as React from "react";

import { isDesktopProviderBlocked } from "@/app/cloud/desktop-app-restrictions";
import type { ModelOption, ModelRef } from "@/app/types";
import { newProvidersEvent } from "@/app/lib/provider-events";
import { ModelSelectView } from "@/components/model-select";
import { t } from "@/i18n";
import { ProviderIcon } from "@/react-app/design-system/provider-icon";
import { useCheckDesktopRestriction } from "@/react-app/domains/shared";
import { isProviderModelFree } from "@/app/utils/providers";
import {
  getConnectedProviderItems,
  sessionRouteProviderListEnabled,
  useProviderListQuery,
} from "@/react-app/domains/connections";
import { readHiddenModels } from "./hidden-models-store";
import { openModelPickerEvent, useWorkspace } from "@/react-app/shell";

type ModelSelectContainerProps = {
  open: boolean;
  value: ModelRef;
  onOpenChange: (open: boolean) => void;
  onChange: (model: ModelRef) => void | Promise<void>;
  disabled?: boolean;
  options?: ModelOption[];
};

export function ModelSelectContainer(props: ModelSelectContainerProps) {
  const discovered = useModelOptions(props.open, props.options === undefined);
  const options = props.options ?? discovered.options;
  const optionsCatalogReady = props.options === undefined ? discovered.catalogReady : true;

  return (
    <ModelSelectView
      open={props.open}
      value={props.value}
      onOpenChange={props.onOpenChange}
      onChange={props.onChange}
      disabled={props.disabled}
      options={options}
      catalogReady={optionsCatalogReady}
      renderProviderIcon={(option) => (
        <ProviderIcon
          providerId={option.providerID}
          providerName={option.description}
          className="size-3.5 opacity-70"
          size={14}
        />
      )}
      onOpenModelPicker={props.options === undefined
        ? () => window.dispatchEvent(new CustomEvent(openModelPickerEvent))
        : undefined}
    />
  );
}

function useModelOptions(open: boolean, enabled: boolean): {
  options: ModelOption[];
  catalogReady: boolean;
} {
  const { client, opencodeBaseUrl, selectedWorkspaceRoot } = useWorkspace();
  const checkDesktopRestriction = useCheckDesktopRestriction();

  const { data, refetch, isFetched } = useProviderListQuery({
    client,
    baseUrl: opencodeBaseUrl,
    directory: selectedWorkspaceRoot,
    enabled: enabled && sessionRouteProviderListEnabled({
      hasClient: Boolean(client),
      pickerOpen: open,
    }),
  });

  React.useEffect(() => {
    if (!enabled || !open || !client) return;
    void refetch();
  }, [client, enabled, open, refetch]);

  React.useEffect(() => {
    if (!enabled || !client) return;
    const handler = () => {
      void refetch();
    };
    window.addEventListener(newProvidersEvent, handler);
    return () => window.removeEventListener(newProvidersEvent, handler);
  }, [client, enabled, refetch]);

  return React.useMemo(() => {
    const hidden = readHiddenModels();
    const restrictToCloud = checkDesktopRestriction({
      restriction: "allowCustomProviders",
    });

    const options = getConnectedProviderItems(data)
      .flatMap((provider) =>
        Object.entries(provider.models).map(([id, model]) => ({
          providerID: provider.id,
          modelID: id,
          title: model.name,
          description: provider.name,
          behaviorTitle: t("app.model_behavior_title"),
          behaviorLabel: t("settings.default_label"),
          behaviorDescription: "",
          behaviorValue: null,
          isFree: isProviderModelFree({
            providerId: provider.id,
            modelId: id,
            model,
          }),
          isConnected: true,
        })),
      );

    return {
      options: options.filter((option) => {
        if (hidden.has(`${option.providerID}/${option.modelID}`)) {
          return false;
        }

        if (
          isDesktopProviderBlocked({
            providerId: option.providerID,
            checkRestriction: checkDesktopRestriction,
          })
        ) {
          return false;
        }

        if (restrictToCloud && !option.isConnected) {
          return false;
        }

        return true;
      }),
      catalogReady: data !== undefined || isFetched,
    };
  }, [checkDesktopRestriction, data, isFetched, open]);
}
