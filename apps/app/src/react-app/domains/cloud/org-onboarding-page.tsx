/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ArrowUpRightIcon, Check, CircleAlert } from "lucide-react";
import {
  BuildingOffice2Icon,
  CloudIcon,
  ServerStackIcon,
  Square3Stack3DIcon,
} from "@heroicons/react/24/solid";

import {
  createDenClient,
  readDenSettings,
  resolveDenBaseUrls,
  writeDenSettings,
  type DenOrgLlmProvider,
  type DenOrgMarketplace,
  type DenOrgSummary,
  type DenWorkerSummary,
} from "@/app/lib/den";
import { usePlatform } from "../../kernel/platform";
import { useBootState } from "../../shell/boot-state";
import {
  resolveModelDisplayName,
  resolveProviderDisplayName,
} from "@/app/utils";
import { ProviderIcon } from "../../design-system/provider-icon";
import { writeStoredDefaultModel } from "../../kernel/model-config";
import { orgOnboardingVisibilityEvent } from "../../shell/reload-coordinator";
import {
  Page,
  PageBackground,
  PageContainer,
  PageContent,
  PageDescription,
  PageFooter,
  PageHeader,
  PageLoading,
  PageLoadingDescription,
  PageLoadingSpinner,
  PageTitle,
  PageTitlebarRegion,
} from "@/components/page";
import { IconTile } from "@/components/ui/action-row";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MenuRowSurface } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { CodeToken } from "@/components/ui/code-token";
import { NoticeBox } from "@/components/ui/notice-box";
import { CountBadge } from "@/components/ui/status-badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Field, FieldLabel, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { t } from "../../../i18n";
import { APP_NAME, APP_NAME_LOWER } from "../../../i18n/locales/brand";

const RELOAD_AFTER_ONBOARDING_KEY = "onmyagent.reloadAfterOrgOnboarding";

function useDenClient() {
  const settings = useMemo(() => readDenSettings(), []);
  const authToken = settings.authToken ?? "";
  const denClient = useMemo(
    () =>
      createDenClient({
        baseUrl: settings.baseUrl,
        apiBaseUrl: settings.apiBaseUrl,
        token: settings.authToken,
      }),
    [authToken, settings.apiBaseUrl, settings.baseUrl],
  );

  return {
    authToken,
    denClient,
    orgId: settings.activeOrgId ?? "",
    orgName: settings.activeOrgName ?? "",
    settings,
  };
}

function markProvidersSeen(providers: DenOrgLlmProvider[]) {
  if (providers.length === 0) return;

  try {
    const raw = window.localStorage.getItem("onmyagent.seenProviderIds");
    const existing: string[] = raw ? JSON.parse(raw) : [];
    const ids = new Set(existing);
    for (const provider of providers) ids.add(provider.id);
    window.localStorage.setItem(
      "onmyagent.seenProviderIds",
      JSON.stringify([...ids]),
    );
  } catch {}
}

/**
 * Full-screen onboarding page shown after sign-in + org selection.
 * Fetches all org resources (providers, marketplaces, workers, skills)
 * and shows them so the user knows what their org provides.
 *
 * Route: /onboarding
 */
export function OrgOnboardingPage() {
  const navigate = useNavigate();
  const { authToken, denClient, orgId, settings } = useDenClient();
  const { markRouteReady } = useBootState();
  const [hasSelectedOrganization, setHasSelectedOrganization] = useState(false);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(orgOnboardingVisibilityEvent, {
        detail: { visible: true },
      }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent(orgOnboardingVisibilityEvent, {
          detail: { visible: false },
        }),
      );
    };
  }, []);

  useEffect(() => {
    markRouteReady();
  }, [markRouteReady]);

  useEffect(() => {
    if (!authToken) {
      navigate("/assistant", { replace: true });
    }
  }, [authToken, navigate]);

  const { data, error, isPending } = useQuery({
    queryKey: [
      "den-org-onboarding",
      settings.baseUrl,
      settings.apiBaseUrl,
      "orgs",
    ],
    enabled: Boolean(authToken),
    queryFn: () => denClient.listOrgs(),
  });

  if (!authToken) {
    return null;
  }

  if (isPending) {
    return (
      <Page>
        <PageBackground />
        <PageTitlebarRegion />
        <PageContainer>
          <PageHeader>
            <IconTile className="mx-auto size-14" size="lg" shape="xl" border>
              <BuildingOffice2Icon className="size-7 text-foreground" />
            </IconTile>
            <PageTitle>{t("den.your_organization")}</PageTitle>
          </PageHeader>
          <PageContent>
            <PageLoading>
              <PageLoadingSpinner />
              <PageLoadingDescription>
                {t("den.loading_organizations")}
              </PageLoadingDescription>
            </PageLoading>
          </PageContent>
        </PageContainer>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <PageBackground />
        <PageTitlebarRegion />
        <PageContainer>
          <PageHeader>
            <IconTile className="mx-auto size-14" size="lg" shape="xl" border>
              <BuildingOffice2Icon className="size-7 text-foreground" />
            </IconTile>
            <PageTitle>{t("den.choose_your_organization")}</PageTitle>
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>
                {error instanceof Error
                  ? error.message
                  : t("den.unable_to_load_organizations")}
              </AlertDescription>
            </Alert>
          </PageHeader>
        </PageContainer>
      </Page>
    );
  }

  if ((data?.orgs.length ?? 0) > 0 && !hasSelectedOrganization) {
    return (
      <OrganizationSelectionPage
        orgs={data.orgs}
        defaultOrganization={
          data.orgs.find((org) => org.id === orgId) ?? data.orgs[0]
        }
        onContinue={() => setHasSelectedOrganization(true)}
      />
    );
  }

  return <ResourceSelectionPage />;
}

export function ResourceSelectionPage() {
  const navigate = useNavigate();
  const platform = usePlatform();
  const { markRouteReady } = useBootState();
  const { authToken, denClient, orgId, orgName, settings } = useDenClient();

  const [selectedDefault, setSelectedDefault] = useState<{
    providerId: string;
    modelId: string;
    label: string;
  } | null>(null);

  // Redirect if no auth or no org — can't show onboarding without them
  useEffect(() => {
    markRouteReady();
  }, [markRouteReady]);

  useEffect(() => {
    if (!authToken || !orgId) {
      navigate("/assistant", { replace: true });
    }
  }, [authToken, navigate, orgId]);

  const { providers, marketplaces, workers, loading, error } = useQueries({
    queries: [
      {
        queryKey: [
          "den-org-onboarding",
          settings.baseUrl,
          settings.apiBaseUrl,
          orgId,
          "providers",
        ],
        enabled: Boolean(authToken && orgId),
        queryFn: () => denClient.listOrgLlmProviders(orgId),
      },
      {
        queryKey: [
          "den-org-onboarding",
          settings.baseUrl,
          settings.apiBaseUrl,
          orgId,
          "marketplaces",
        ],
        enabled: Boolean(authToken && orgId),
        queryFn: () => denClient.listOrgMarketplaces(orgId),
      },
      {
        queryKey: [
          "den-org-onboarding",
          settings.baseUrl,
          settings.apiBaseUrl,
          orgId,
          "workers",
        ],
        enabled: Boolean(authToken && orgId),
        queryFn: () => denClient.listWorkers(orgId),
      },
    ],
    combine: ([providersQuery, marketplacesQuery, workersQuery]) => ({
      providers: providersQuery.data ?? [],
      marketplaces: marketplacesQuery.data ?? [],
      workers: workersQuery.data ?? [],
      loading:
        providersQuery.isPending ||
        marketplacesQuery.isPending ||
        workersQuery.isPending,
      error:
        providersQuery.error?.message ??
        marketplacesQuery.error?.message ??
        workersQuery.error?.message ??
        null,
    }),
  });

  const handleContinue = useCallback(() => {
    // If user picked a default model, write it
    if (selectedDefault) {
      writeStoredDefaultModel({
        providerID: selectedDefault.providerId,
        modelID: selectedDefault.modelId,
      });
    }
    // Mark all providers shown on this page as "seen" so the global
    // toast doesn't re-fire for them on the next sync interval.
    markProvidersSeen(providers);
    if (providers.length > 0) {
      try {
        window.localStorage.setItem(RELOAD_AFTER_ONBOARDING_KEY, "1");
      } catch {}
    }
    navigate("/assistant", { replace: true });
  }, [navigate, providers, selectedDefault]);

  const totalModels = providers.reduce(
    (sum, provider) => sum + provider.models.length,
    0,
  );
  const hasResources =
    providers.length > 0 || marketplaces.length > 0 || workers.length > 0;

  return (
    <Page>
      <PageBackground />
      <PageTitlebarRegion />

      <PageContainer>
        {/* Header */}
        <PageHeader>
          <IconTile className="mx-auto size-14" size="lg" shape="xl" border>
            <BuildingOffice2Icon className="size-7 text-foreground" />
          </IconTile>
          <PageTitle>{orgName || "Your organization"}</PageTitle>
          {loading ? null : error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : hasResources ? (
            <PageDescription>
              You have access to the following resources.
            </PageDescription>
          ) : null}
        </PageHeader>

        {loading ? (
          <PageContent>
            <PageLoading>
              <PageLoadingSpinner />
              <PageLoadingDescription>
                Loading available resources...
              </PageLoadingDescription>
            </PageLoading>
          </PageContent>
        ) : !hasResources ? (
          <PageContent>
            <Empty className="h-fit flex-none">
              <EmptyHeader>
                <EmptyTitle>
                  No resources have been configured for this organization yet.
                </EmptyTitle>
                <EmptyDescription>
                  Add AI providers, marketplaces, or workers from the {APP_NAME}
                  Cloud dashboard.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  onClick={() =>
                    platform.openLink(
                      resolveDenBaseUrls(settings.baseUrl).baseUrl,
                    )
                  }
                >
                  Open {APP_NAME} Cloud
                  <ArrowUpRightIcon data-icon="inline-end" />
                </Button>
              </EmptyContent>
            </Empty>
          </PageContent>
        ) : (
          <PageContent>
            <ScrollArea className="px-2.5">
              <Accordion
                multiple
                className="rounded-2xl border border-border bg-transparent before:hidden"
              >
                {/* AI Providers */}
                {providers.length > 0 ? (
                  <Section
                    icon={<CloudIcon className="size-5 text-foreground/60" />}
                    title={t("den.ai_providers_title")}
                    description={t("den.ai_providers_desc")}
                    count={t("den.models_count", { count: totalModels })}
                  >
                    {providers.map((provider) => (
                      <ProviderCard
                        key={provider.id}
                        provider={provider}
                        selectedDefault={selectedDefault}
                        onSelectDefault={setSelectedDefault}
                      />
                    ))}
                  </Section>
                ) : null}

                {/* Marketplaces */}
                {marketplaces.length > 0 ? (
                  <Section
                    icon={
                      <Square3Stack3DIcon className="size-5 text-foreground/60" />
                    }
                    title={t("den.marketplaces_title")}
                    description={t("den.marketplaces_desc")}
                    count={t("den.marketplaces_count", { count: marketplaces.length })}
                  >
                    {marketplaces.map((mp) => (
                      <MarketplaceCard key={mp.id} marketplace={mp} />
                    ))}
                  </Section>
                ) : null}

                {/* Workers */}
                {workers.length > 0 ? (
                  <Section
                    icon={
                      <ServerStackIcon className="size-5 text-foreground/60" />
                    }
                    title={t("den.cloud_workers_section_title")}
                    description={t("den.cloud_workers_section_desc")}
                    count={t("den.workers_count", { count: workers.length })}
                  >
                    {workers.map((worker) => (
                      <WorkerCard key={worker.workerId} worker={worker} />
                    ))}
                  </Section>
                ) : null}
              </Accordion>
            </ScrollArea>
            {/* Selected default indicator */}
            {selectedDefault ? (
              <NoticeBox className="text-center" size="comfortable" tone="info">
                <Check size={14} className="mr-1 inline" />
                {selectedDefault.label} will be set as your default model.
              </NoticeBox>
            ) : null}
          </PageContent>
        )}

        <PageFooter>
          {/* Footer hint */}
          {!loading && hasResources ? (
            <p className="text-center text-xs text-muted-foreground text-balance leading-relaxed">
              Providers are added to your workspace automatically. Marketplaces
              and workers are available from Cloud settings.
            </p>
          ) : null}
          <Button
            className="w-fit"
            type="button"
            size="lg"
            onClick={handleContinue}
            disabled={loading}
          >
            {hasResources ? "Continue to workspace" : "Continue"}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </PageFooter>
      </PageContainer>
    </Page>
  );
}

interface MarketplaceCardProps {
  marketplace: DenOrgMarketplace;
}

function MarketplaceCard({ marketplace }: MarketplaceCardProps) {
  return (
    <MenuRowSurface align="center" className="-mx-2 border border-border bg-transparent" density="compact">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">
          {marketplace.name}
        </div>
        {marketplace.description ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {marketplace.description}
          </div>
        ) : null}
      </div>
      <CountBadge size="compact">
        {marketplace.pluginCount} plugin
        {marketplace.pluginCount === 1 ? "" : "s"}
      </CountBadge>
    </MenuRowSurface>
  );
}

interface WorkerCardProps {
  worker: DenWorkerSummary;
}

function WorkerCard({ worker }: WorkerCardProps) {
  return (
    <MenuRowSurface align="center" className="-mx-2 border border-border bg-transparent" density="compact">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">
          {worker.workerName}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {worker.status}
          {worker.provider ? ` · ${worker.provider}` : ""}
        </div>
      </div>
    </MenuRowSurface>
  );
}

/* ------------------------------------------------------------------ */
/*  Section wrapper                                                    */
/* ------------------------------------------------------------------ */

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  count: string;
  children: React.ReactNode;
}

function Section({ icon, title, description, count, children }: SectionProps) {
  return (
    <AccordionItem value={title}>
      <AccordionTrigger className="items-center px-5 py-4 gap-4.75 hover:no-underline">
        {icon}

        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <h3 className="flex items-center gap-2 font-medium">
            {title}
            <span className="text-muted-foreground text-xs">
              {count}
            </span>
          </h3>
          <p className="text-sm font-normal normal-case tracking-normal text-muted-foreground">
            {description}
          </p>
        </div>
      </AccordionTrigger>
      <AccordionContent className="space-y-2 pb-2">{children}</AccordionContent>
    </AccordionItem>
  );
}

/* ------------------------------------------------------------------ */
/*  Provider card with "Use as default" option                         */
/* ------------------------------------------------------------------ */

interface ProviderCardProps {
  provider: DenOrgLlmProvider;
  selectedDefault: { providerId: string; modelId: string } | null;
  onSelectDefault: (
    value: {
      providerId: string;
      modelId: string;
      label: string;
    } | null,
  ) => void;
}

function ProviderCard({
  provider,
  selectedDefault,
  onSelectDefault,
}: ProviderCardProps) {
  // The local provider ID matches the cloud provider's org-level ID
  const localProviderId = provider.id.trim();
  const firstModel = provider.models[0] ?? null;
  const isSelected = selectedDefault?.providerId === localProviderId;

  const handleUseAsDefault = () => {
    if (!firstModel) return;
    if (isSelected) {
      onSelectDefault(null);
    } else {
      onSelectDefault({
        providerId: localProviderId,
        modelId: firstModel.id,
        label: `${resolveProviderDisplayName(provider.name || provider.providerId)} · ${firstModel.name || resolveModelDisplayName(firstModel.id)}`,
      });
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-3 transition-colors -mx-2",
        isSelected ? "border-dls-accent" : "border-border",
      )}
    >
      <div className="flex items-center gap-4.5">
        <ProviderIcon
          providerId={provider.providerId}
          providerName={provider.name}
          size={20}
          className="text-foreground"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {resolveProviderDisplayName(provider.name || provider.providerId)}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {provider.models.length === 1
              ? "1 model"
              : `${provider.models.length} models`}
          </div>
        </div>
        {firstModel ? (
          <Button
            type="button"
            variant="ghost"
            size="pill-xs"
            className={cn(
              "shrink-0",
              isSelected
                ? "bg-dls-decision-soft text-dls-accent"
                : "border border-border text-muted-foreground hover:bg-hover hover:text-foreground",
            )}
            onClick={handleUseAsDefault}
          >
            {isSelected ? "Default" : "Use as default"}
          </Button>
        ) : (
          <Check size={16} className="shrink-0 text-dls-accent" />
        )}
      </div>
      {provider.models.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {provider.models.slice(0, 5).map((model) => (
            <CodeToken
              key={model.id}
              tone="surface"
              size="sm"
              className="border-border bg-hover text-muted-foreground"
            >
              {model.name || resolveModelDisplayName(model.id)}
            </CodeToken>
          ))}
          {provider.models.length > 5 ? (
            <CountBadge size="label" className="text-muted-foreground">
              +{provider.models.length - 5} more
            </CountBadge>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface OrganizationSelectionPageProps {
  orgs: DenOrgSummary[];
  defaultOrganization: DenOrgSummary;
  onContinue: () => void;
}

function OrganizationSelectionPage({
  orgs,
  defaultOrganization,
  onContinue,
}: OrganizationSelectionPageProps) {
  const { authToken, denClient, settings } = useDenClient();
  const [selected, setSelected] = useState(defaultOrganization);
  const { error, isPending, mutate } = useMutation({
    mutationFn: async (nextOrg: DenOrgSummary) => {
      await denClient.setActiveOrganization({ organizationId: nextOrg.id });
      return nextOrg;
    },
    onSuccess: (nextOrg) => {
      writeDenSettings({
        ...settings,
        authToken: authToken || null,
        activeOrgId: nextOrg.id,
        activeOrgSlug: nextOrg.slug,
        activeOrgName: nextOrg.name,
      });

      onContinue();
    },
  });

  return (
    <Page>
      <PageBackground />
      <PageTitlebarRegion />
      <PageContainer>
        <PageHeader>
          <IconTile className="mx-auto size-14" size="lg" shape="xl" border>
            <BuildingOffice2Icon className="size-7 text-foreground" />
          </IconTile>
          <PageTitle>{t("den.choose_your_organization")}</PageTitle>
          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>
                {error instanceof Error
                  ? error.message
                  : t("den.unable_to_select_organization")}
              </AlertDescription>
            </Alert>
          ) : (
            <PageDescription>
              {t("den.select_organization_desc")}
            </PageDescription>
          )}
        </PageHeader>

        <PageContent>
          <OrganizationList
            orgs={orgs}
            value={selected}
            onValueChange={setSelected}
          />
        </PageContent>

        <PageFooter>
          <Button
            className="w-fit"
            type="button"
            size="lg"
            onClick={() => mutate(selected)}
            disabled={isPending}
          >
            {isPending ? t("den.connecting") : t("den.continue_with_organization")}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </PageFooter>
      </PageContainer>
    </Page>
  );
}

interface OrganizationListProps {
  orgs: DenOrgSummary[];
  value: DenOrgSummary;
  onValueChange: (value: DenOrgSummary) => void;
}

export function OrganizationList({
  orgs,
  value,
  onValueChange,
}: OrganizationListProps) {
  return (
    <RadioGroup
      value={value.id}
      onValueChange={(nextOrgId) => {
        const nextOrg = orgs.find((org) => org.id === nextOrgId);
        if (nextOrg) onValueChange(nextOrg);
      }}
      aria-label={t("den.organizations")}
    >
      {orgs.map((org) => {
        const fieldId = `organization-${org.id}`;

        return (
          <FieldLabel
            key={org.id}
            htmlFor={fieldId}
            className="p-0! transition-colors hover:bg-input/10"
          >
            <Field orientation="horizontal">
              <FieldTitle className="flex min-w-0 items-center gap-4">
                <BuildingOffice2Icon className="size-6 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-col items-start">
                  <span className="max-w-full truncate text-sm font-medium">
                    {org.name}
                  </span>
                  <span className="max-w-full truncate text-muted-foreground text-xs">
                    {org.slug}
                  </span>
                </div>
              </FieldTitle>
              <RadioGroupItem
                value={org.id}
                id={fieldId}
                className="group-hover/field-label:bg-foreground/25"
              />
            </Field>
          </FieldLabel>
        );
      })}
    </RadioGroup>
  );
}
