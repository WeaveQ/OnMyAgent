import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Folder,
  Globe,
  Home,
  RefreshCw,
  Share2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { ActionRowButton, IconTile } from "@/components/ui/action-row";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import {
  roleOptions,
  industryOptions,
  toolOptions,
  taskOptions,
  ToggleChip,
  FieldLabel,
  normalizeProfileOptionValues,
} from "../domains/settings";
import { t } from "../../i18n";
import {
  pickDirectory,
  resolveWorkspaceListSelectedId,
  workspaceCreate,
  workspaceSetRuntimeActive,
  workspaceSetSelected,
  type WorkspaceList,
} from "../../app/lib/desktop";
import { isDesktopRuntime } from "../../app/utils";
import { useLocal, type OnboardingProfile } from "../kernel/local-provider";
import { createOnMyAgentServerClient } from "../../app/lib/onmyagent-server";
import { resolveOnMyAgentConnection } from "./onmyagent-connection";
import { writeActiveWorkspaceId } from "./session-memory";
import {
  workspaceAssistantRoute,
  workspaceSessionRoute,
} from "./workspace-routes";

type OnboardingStep = "hello" | "workspace" | "profile";

type ProfileDraft = {
  userName: string;
  assistantName: string;
  mbti: string;
  roles: string[];
  industries: string[];
  tools: string[];
  tasks: string[];
};

const initialProfileDraft: ProfileDraft = {
  userName: "",
  assistantName: "",
  mbti: "",
  roles: [],
  industries: [],
  tools: [],
  tasks: [],
};

const mbtiOptions = [
  "INTJ",
  "INTP",
  "ENTJ",
  "ENTP",
  "INFJ",
  "INFP",
  "ENFJ",
  "ENFP",
  "ISTJ",
  "ISFJ",
  "ESTJ",
  "ESFJ",
  "ISTP",
  "ISFP",
  "ESTP",
  "ESFP",
];
const mbtiSelectItems = mbtiOptions.map((value) => ({ label: value, value }));

const welcomeTextClass = {
  progress: "shrink-0 text-sm font-medium tabular-nums text-dls-secondary",
  accessTitle: "text-base font-medium text-dls-text",
  accessDescription: "mt-1 text-sm leading-6 text-dls-secondary",
  heroTitle: "mt-8 inline-flex items-center gap-1 text-3xl font-medium tracking-tight text-dls-text",
  heroDescription: "mt-4 max-w-2xl text-base leading-7 text-dls-secondary",
  pageTitle: "text-2xl font-medium text-dls-text",
  pageDescription: "mt-2 text-base leading-7 text-dls-secondary",
  sectionTitle: "text-lg font-medium text-dls-text",
  sectionLabel: "mb-3.5 text-base font-medium text-dls-secondary",
  selectedLabel: "text-sm font-medium text-dls-text",
  selectedPath: "min-w-0 truncate text-sm text-dls-secondary",
};

const welcomeLayoutClass = {
  shell: "fixed inset-0 z-50 flex flex-col overflow-hidden bg-dls-background text-dls-text",
  panel: "relative flex h-full w-full flex-col overflow-hidden",
  ambient: "pointer-events-none absolute inset-0 overflow-hidden",
  ambientLogo: "absolute -right-20 top-16 size-96 rotate-12 opacity-5",
  header: "relative z-10 mx-auto flex w-full max-w-5xl items-center gap-8 px-8 pb-3 pt-8",
  progressWrap: "min-w-0 flex-1",
  body: "relative z-10 min-h-0 flex-1",
  footer: "relative z-10 mx-auto w-full max-w-5xl px-8 pb-8 pt-3",
  logoTile: "flex size-28 items-center justify-center rounded-xl border border-dls-accent/30 bg-dls-surface p-5",
  selectedWorkspace: "mx-auto mt-8 flex w-full max-w-3xl items-center gap-2 rounded-lg border border-dls-accent/30 bg-dls-decision-soft px-4 py-3",
  refreshButton: "shrink-0 text-dls-secondary hover:bg-dls-hover hover:text-dls-accent",
  profileFooter: "flex items-center justify-between gap-3",
  footerActions: "flex gap-3",
  profileScroll: "h-full px-8 pb-8 pt-8",
  profileContent: "mx-auto flex max-w-4xl flex-col gap-9",
  profileSection: "grid gap-6 pb-6 last:pb-0",
  profileGrid: "grid gap-5 md:grid-cols-3",
  profileInput: "mt-2 h-11 rounded-lg text-base",
  mbtiTrigger: "mt-2 h-11 w-full rounded-lg border-dls-border bg-dls-surface px-3 text-base text-dls-text data-[size=default]:h-11",
  mbtiContent: "rounded-xl border border-dls-border bg-dls-surface text-dls-text",
  mbtiItem: "rounded-lg text-base",
  chipRow: "flex flex-wrap gap-3",
  roleGrid: "grid gap-3 md:grid-cols-3",
};

function folderNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "workspace";
}

function toProfile(draft: ProfileDraft, skipped: boolean): OnboardingProfile {
  return {
    userName: draft.userName.trim(),
    assistantName: draft.assistantName.trim(),
    mbti: draft.mbti.trim(),
    roles: normalizeProfileOptionValues(draft.roles),
    industries: normalizeProfileOptionValues(draft.industries),
    tools: normalizeProfileOptionValues(draft.tools),
    tasks: normalizeProfileOptionValues(draft.tasks),
    docPreference: "",
    terminology: "",
    skipped,
    updatedAt: Date.now(),
  };
}

function ProgressBar(props: { step: OnboardingStep }) {
  const activeCount =
    props.step === "hello" ? 1 : props.step === "workspace" ? 2 : 3;
  return (
    <div className="flex items-center gap-2">
      {[0, 1, 2].map((index) => (
        <div key={index} className="h-1.5 flex-1 overflow-hidden rounded-sm bg-dls-border">
          <div
            className={cn(
              "h-full rounded-sm bg-dls-accent transition-all duration-500 ease-out",
              index < activeCount ? "w-full" : "w-0",
            )}
          />
        </div>
      ))}
      <span className={welcomeTextClass.progress}>
        {activeCount}/3
      </span>
    </div>
  );
}

function AccessCard(props: {
  selected: boolean;
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <ActionRowButton
      density="access"
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={cn(
        "items-center gap-4",
        props.disabled
          ? "bg-dls-active opacity-55"
          : props.selected
            ? "border-dls-accent bg-dls-accent/10"
            : "hover:border-dls-accent/30",
      )}
    >
      <IconTile
        size="md"
        shape="lg"
        border
        className={cn(
          props.disabled
            ? "text-dls-secondary"
            : props.selected
              ? "border-dls-accent bg-dls-decision-soft text-dls-accent"
              : "bg-dls-surface-muted text-dls-accent",
        )}
      >
        <Icon className="size-5" />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className={welcomeTextClass.accessTitle}>
          {props.title}
        </div>
        <div className={welcomeTextClass.accessDescription}>
          {props.description}
        </div>
      </div>
      <ChevronRight
        className={cn(
          "size-5 shrink-0",
          props.disabled
            ? "text-dls-secondary/70"
            : props.selected
              ? "text-dls-accent"
              : "text-dls-secondary",
        )}
      />
    </ActionRowButton>
  );
}

function OnboardingShell(props: {
  step: OnboardingStep;
  children: ReactNode;
  footer: ReactNode;
  onSkip?: () => void;
}) {
  return (
    <div className={welcomeLayoutClass.shell}>
      <div className={welcomeLayoutClass.panel}>
        <div aria-hidden="true" className={welcomeLayoutClass.ambient}>
          <img
            src={resolvePublicAssetUrl("/onmyagent-logo.png")}
            alt=""
            className={welcomeLayoutClass.ambientLogo}
          />
        </div>
        <div className={welcomeLayoutClass.header}>
          <div className={welcomeLayoutClass.progressWrap}>
            <ProgressBar step={props.step} />
          </div>
          {props.onSkip ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={props.onSkip}
              className="shrink-0 text-dls-secondary hover:text-dls-text"
            >
              {t("welcome.skip_all")}
              <ChevronRight className="size-4" />
            </Button>
          ) : null}
        </div>
        <div className={welcomeLayoutClass.body}>{props.children}</div>
        <div className={welcomeLayoutClass.footer}>{props.footer}</div>
      </div>
    </div>
  );
}

export function WelcomeRoute() {
  const navigate = useNavigate();
  const local = useLocal();
  const [step, setStep] = useState<OnboardingStep>("hello");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [createdWorkspaceId, setCreatedWorkspaceId] = useState("");
  const [profile, setProfile] = useState<ProfileDraft>(initialProfileDraft);

  const updateProfile = <K extends keyof ProfileDraft>(
    key: K,
    value: ProfileDraft[K],
  ) => {
    setProfile((current) => ({ ...current, [key]: value }));
  };

  const toggleListValue = (
    key: "roles" | "industries" | "tools" | "tasks",
    value: string,
  ) => {
    setProfile((current) => {
      const values = current[key];
      const next = values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value];
      return { ...current, [key]: next };
    });
  };

  const profileValueSelected = (values: string[], value: string) =>
    normalizeProfileOptionValues(values).includes(value);

  const pickWorkspaceFolder = useCallback(async () => {
    if (!isDesktopRuntime() || pickingFolder) return;
    setPickingFolder(true);
    setWorkspaceError(null);
    try {
      const folder = await pickDirectory({
        title: t("onboarding.authorize_folder"),
      });
      if (typeof folder === "string" && folder.trim()) {
        setSelectedFolder(folder);
      }
    } catch (error) {
      setWorkspaceError(
        error instanceof Error
          ? error.message
          : t("welcome.select_workspace_failed"),
      );
    } finally {
      setPickingFolder(false);
    }
  }, [pickingFolder]);

  const completeWorkspaceStep = useCallback(async () => {
    if (!selectedFolder) return;
    setCreatingWorkspace(true);
    setWorkspaceError(null);
    try {
      const workspaceName = folderNameFromPath(selectedFolder);
      const list = (await workspaceCreate({
        folderPath: selectedFolder,
        name: workspaceName,
        preset: "starter",
      })) as WorkspaceList;
      const createdId =
        resolveWorkspaceListSelectedId(list) ||
        list.workspaces[list.workspaces.length - 1]?.id ||
        "";
      let targetWorkspaceId = createdId;
      if (createdId) {
        await workspaceSetSelected(createdId).catch(() => undefined);
        await workspaceSetRuntimeActive(createdId).catch(() => undefined);
        writeActiveWorkspaceId(createdId);
      }
      try {
        const { normalizedBaseUrl, resolvedToken, resolvedHostToken } =
          await resolveOnMyAgentConnection();
        if (normalizedBaseUrl && resolvedToken) {
          const onmyagentClient = createOnMyAgentServerClient({
            baseUrl: normalizedBaseUrl,
            token: resolvedToken,
            hostToken: resolvedHostToken || undefined,
          });
          const serverList = await onmyagentClient
            .createLocalWorkspace({
              folderPath: selectedFolder,
              name: workspaceName,
              preset: "starter",
            })
            .catch(() => null);
          targetWorkspaceId = serverList
            ? resolveWorkspaceListSelectedId(serverList) ||
              serverList.workspaces[serverList.workspaces.length - 1]?.id ||
              targetWorkspaceId
            : targetWorkspaceId;
        }
      } catch {
        // Best-effort server registration.
      }
      if (targetWorkspaceId) {
        writeActiveWorkspaceId(targetWorkspaceId);
        setCreatedWorkspaceId(targetWorkspaceId);
      }
      setStep("profile");
    } catch (error) {
      setWorkspaceError(
        error instanceof Error
          ? error.message
          : t("welcome.create_workspace_failed"),
      );
    } finally {
      setCreatingWorkspace(false);
    }
  }, [pickWorkspaceFolder, selectedFolder]);

  const finishOnboarding = useCallback(
    (skipped: boolean) => {
      local.setPrefs((previous) => ({
        ...previous,
        hasCompletedOnboarding: true,
        onboardingProfile: toProfile(profile, skipped),
      }));
      navigate(
        createdWorkspaceId
          ? workspaceAssistantRoute(createdWorkspaceId)
          : "/assistant",
        { replace: true },
      );
    },
    [createdWorkspaceId, local, navigate, profile],
  );

  const selectedFolderLabel = useMemo(
    () => selectedFolder || t("welcome.no_folder_selected"),
    [selectedFolder],
  );

  useEffect(() => {
    if (local.prefs.hasCompletedOnboarding) {
      navigate("/assistant", { replace: true });
    }
  }, [local.prefs.hasCompletedOnboarding, navigate]);

  if (step === "hello") {
    return (
      <OnboardingShell
        step="hello"
        footer={
          <div className="flex justify-end">
            <Button
              type="button"
              size="lg"
              onClick={() => setStep("workspace")}
            >
              {t("welcome.start_setup")}
              <ArrowRight className="size-4" />
            </Button>
          </div>
        }
      >
        <div className="mx-auto flex h-full max-w-5xl flex-col items-center justify-center px-8 pb-12 text-center">
          <div className={welcomeLayoutClass.logoTile}>
            <img
              src={resolvePublicAssetUrl("/onmyagent-logo.png")}
              alt="OnMyAgent"
              className="size-full rounded-lg object-contain"
            />
          </div>
          <div className={welcomeTextClass.heroTitle}>
            <span>
              {t("welcome.hello_prefix")}
            </span>
            <span className="text-dls-accent">
              OnMyAgent
            </span>
          </div>
          <p className={welcomeTextClass.heroDescription}>
            {t("welcome.intro")}
          </p>
        </div>
      </OnboardingShell>
    );
  }

  if (step === "workspace") {
    return (
      <OnboardingShell
        step="workspace"
        footer={
          <div className="flex flex-col gap-3">
            {workspaceError ? <NoticeBox size="comfortable" tone="error">{workspaceError}</NoticeBox> : null}
            <div className="flex items-center justify-between gap-4">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => setStep("hello")}
              >
                <ArrowLeft className="size-4" />
                {t("common.back")}
              </Button>
              <Button
                type="button"
                size="lg"
                onClick={() => {
                  void completeWorkspaceStep();
                }}
                disabled={
                  creatingWorkspace ||
                  pickingFolder ||
                  !selectedFolder ||
                  !isDesktopRuntime()
                }
              >
                {creatingWorkspace ? (
                  <LoadingSpinner size="default" />
                ) : null}
                {t("common.next")}
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        }
      >
        <ScrollArea className="h-full px-8 pb-6 pt-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className={welcomeTextClass.pageTitle}>
              {t("welcome.choose_workspace_title")}
            </h1>
            <p className={welcomeTextClass.pageDescription}>
              {t("welcome.choose_workspace_body")}
            </p>
          </div>
          <div className="mx-auto mt-6 flex w-full max-w-3xl flex-col gap-3">
            <AccessCard
              selected={!!selectedFolder}
              icon={Home}
              title={t("welcome.local_workspace_title")}
              description={t("welcome.local_workspace_body")}
              onClick={() => void pickWorkspaceFolder()}
            />
            <AccessCard
              selected={false}
              icon={Globe}
              title={t("welcome.remote_workspace_title")}
              description={t("welcome.remote_workspace_body")}
              disabled
              onClick={() => {}}
            />
            <AccessCard
              selected={false}
              icon={Share2}
              title={t("welcome.shared_workspace_title")}
              description={t("welcome.shared_workspace_body")}
              disabled
              onClick={() => {}}
            />
          </div>
          {selectedFolder ? (
            <div className={welcomeLayoutClass.selectedWorkspace}>
              <span className={welcomeTextClass.selectedLabel}>
                {t("welcome.local_workspace_label")}
              </span>
              <span className={welcomeTextClass.selectedPath}>
                {selectedFolder}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => void pickWorkspaceFolder()}
                className={welcomeLayoutClass.refreshButton}
              >
                <RefreshCw className="size-4" />
              </Button>
            </div>
          ) : null}
        </ScrollArea>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell
      step="profile"
      footer={
        <div className={welcomeLayoutClass.profileFooter}>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => setStep("workspace")}
          >
            <ArrowLeft className="size-4" />
            {t("common.back")}
          </Button>
          <div className={welcomeLayoutClass.footerActions}>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => finishOnboarding(true)}
            >
              {t("welcome.skip")}
            </Button>
            <Button
              type="button"
              size="lg"
              onClick={() => finishOnboarding(false)}
            >
              {t("settings.done")}
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      }
    >
      <ScrollArea className={welcomeLayoutClass.profileScroll}>
        <div className={welcomeLayoutClass.profileContent}>
          <section className={welcomeLayoutClass.profileSection}>
            <h2 className={welcomeTextClass.sectionTitle}>
              {t("welcome.get_acquainted")}
            </h2>
            <div className={welcomeLayoutClass.profileGrid}>
              <FieldLabel>
                {t("welcome.your_name")}
                <Input
                  value={profile.userName}
                  onChange={(event) =>
                    updateProfile("userName", event.currentTarget.value)
                  }
                  placeholder={t("welcome.your_name_placeholder")}
                  className={welcomeLayoutClass.profileInput}
                />
              </FieldLabel>
              <FieldLabel>
                {t("welcome.assistant_name")}
                <Input
                  value={profile.assistantName}
                  onChange={(event) =>
                    updateProfile("assistantName", event.currentTarget.value)
                  }
                  placeholder="OnMyAgent"
                  className={welcomeLayoutClass.profileInput}
                />
              </FieldLabel>
              <FieldLabel>
                MBTI
                <Select
                  value={profile.mbti}
                  items={mbtiSelectItems}
                  onValueChange={(value) => updateProfile("mbti", value ?? "")}
                >
                  <SelectTrigger className={welcomeLayoutClass.mbtiTrigger}>
                    <SelectValue placeholder="ENTJ" />
                  </SelectTrigger>
                  <SelectContent align="start" className={welcomeLayoutClass.mbtiContent}>
                    {mbtiOptions.map((value) => (
                      <SelectItem key={value} value={value} className={welcomeLayoutClass.mbtiItem}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldLabel>
            </div>
          </section>

          <section className={welcomeLayoutClass.profileSection}>
            <h2 className={welcomeTextClass.sectionTitle}>
              {t("welcome.about_you")}
            </h2>
            <div className="mt-7 flex flex-col gap-7">
              <div>
                <div className={welcomeTextClass.sectionLabel}>
                  {t("welcome.role")}
                </div>
                <div className={welcomeLayoutClass.roleGrid}>
                  {roleOptions.map((role) => (
                    <ToggleChip
                      key={role.value}
                      label={role.label}
                      selected={profileValueSelected(profile.roles, role.value)}
                      onClick={() => toggleListValue("roles", role.value)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className={welcomeTextClass.sectionLabel}>
                  {t("welcome.industry")}
                </div>
                <div className={welcomeLayoutClass.chipRow}>
                  {industryOptions.map((industry) => (
                    <ToggleChip
                      key={industry.value}
                      label={industry.label}
                      selected={profileValueSelected(profile.industries, industry.value)}
                      onClick={() => toggleListValue("industries", industry.value)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className={welcomeLayoutClass.profileSection}>
            <h2 className={welcomeTextClass.sectionTitle}>
              {t("welcome.work_habits")}
            </h2>
            <div className="mt-7 flex flex-col gap-7">
              <div>
                <div className={welcomeTextClass.sectionLabel}>
                  {t("welcome.common_tools")}
                </div>
                <div className={welcomeLayoutClass.chipRow}>
                  {toolOptions.map((tool) => (
                    <ToggleChip
                      key={tool.value}
                      label={tool.label}
                      selected={profileValueSelected(profile.tools, tool.value)}
                      onClick={() => toggleListValue("tools", tool.value)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className={welcomeTextClass.sectionLabel}>
                  {t("welcome.frequent_tasks")}
                </div>
                <div className={welcomeLayoutClass.chipRow}>
                  {taskOptions.map((task) => (
                    <ToggleChip
                      key={task.value}
                      label={task.label}
                      selected={profileValueSelected(profile.tasks, task.value)}
                      onClick={() => toggleListValue("tasks", task.value)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </ScrollArea>
    </OnboardingShell>
  );
}
