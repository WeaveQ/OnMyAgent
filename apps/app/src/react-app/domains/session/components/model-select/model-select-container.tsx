"use client";

import * as React from "react";

import { isDesktopProviderBlocked } from "@/app/cloud/desktop-app-restrictions";
import type { ModelOption, ModelRef } from "@/app/types";
import { newProvidersEvent } from "@/app/lib/provider-events";
import { ModelSelectView } from "@/components/model-select";
import { t } from "@/i18n";
import { ProviderIcon } from "@/react-app/design-system/provider-icon";
import { useCheckDesktopRestriction } from "@/react-app/domains/shared/desktop-config-context";
import { getConnectedProviderItems, useProviderListQuery } from "@/react-app/domains/shared/provider-list-query";
import { readHiddenModels } from "../../sync/hidden-models-store";
import { openModelPickerEvent, useWorkspace } from "@/react-app/shell";

type ModelSelectContainerProps = {
  open: boolean;
  value: ModelRef;
  onOpenChange: (open: boolean) => void;
  onChange: (model: ModelRef) => void;
  disabled?: boolean;
};

export function ModelSelectContainer(props: ModelSelectContainerProps) {
  const options = useModelOptions(props.open);

  return (
    <ModelSelectView
      open={props.open}
      value={props.value}
      onOpenChange={props.onOpenChange}
      onChange={props.onChange}
      disabled={props.disabled}
      options={options}
      renderProviderIcon={(option) => (
        <ProviderIcon
          providerId={option.providerID}
          providerName={option.description}
          className="size-3.5 opacity-70"
          size={14}
        />
      )}
      onOpenModelPicker={() => window.dispatchEvent(new CustomEvent(openModelPickerEvent))}
    />
  );
}

function useModelOptions(open: boolean): ModelOption[] {
  const { client, opencodeBaseUrl, selectedWorkspaceRoot } = useWorkspace();
  const checkDesktopRestriction = useCheckDesktopRestriction();

  const { data, refetch } = useProviderListQuery({
    client,
    baseUrl: opencodeBaseUrl,
    directory: selectedWorkspaceRoot,
    enabled: Boolean(client),
  });

  React.useEffect(() => {
    if (!open || !client) return;
    void refetch();
  }, [client, open, refetch]);

  React.useEffect(() => {
    if (!client) return;
    const handler = () => {
      void refetch();
    };
    window.addEventListener(newProvidersEvent, handler);
    return () => window.removeEventListener(newProvidersEvent, handler);
  }, [client, refetch]);

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
          isFree: false,
          isConnected: true,
        })),
      );

    return options.filter((option) => {
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
    });
  }, [checkDesktopRestriction, data, open]);
}
