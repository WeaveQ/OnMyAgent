import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from "react";
import {
  Cloud,
  Edit2,
  FolderOpen,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import { saveInstalledSkillToOnMyAgentOrg } from "@/app/lib/den-skills";
import {
  buildDenAuthUrl,
  createDenClient,
  DEFAULT_DEN_BASE_URL,
  readDenSettings,
  type DenOrgSkillHubSummary,
} from "../../../../app/lib/den";
import type {
  DenOrgSkillCard,
  HubSkillCard,
  HubSkillRepo,
  SkillCard,
} from "../../../../app/types";
import {
  modalNoticeErrorClass,
  modalNoticeSuccessClass,
  pillGhostClass,
  pillPrimaryClass,
  pillSecondaryClass,
  surfaceCardClass,
  tagClass,
} from "../../shared/modal-styles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { IconTile, NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import { SettingsListEmptyState } from "../settings-list";
import {
  SelectMenu,
  type SelectMenuOption,
} from "../../../design-system/select-menu";
import { APP_NAME } from "../../../../i18n/locales/brand";
import { SettingsNotice, SettingsPanel } from "../settings-section";

type InstallResult = { ok: boolean; message: string };
type SkillsFilter = "all" | "installed" | "cloud" | "hub";
type InstalledSkillFilter = "builtin" | "mine";
type CloudSkillInstallState =
  | "available"
  | "installed"
  | "update"
  | "missing_local";
type ToastTone = "info" | "success" | "warning" | "error";

const pageTitleClass =
  "text-xl font-medium leading-7 text-dls-text";
const sectionTitleClass =
  "text-base font-medium leading-6 text-dls-text";
const skillTextClass = {
  cardTitle: "truncate text-sm font-medium leading-5 text-dls-text",
  fieldLabel: "text-xs font-medium text-dls-secondary",
  cardDescription: "mt-2 line-clamp-2 text-sm leading-relaxed text-dls-secondary",
  intro: "text-sm leading-relaxed text-dls-secondary",
};
const panelCardClass =
  "rounded-xl border border-dls-border bg-dls-surface p-5 transition-all hover:border-dls-border";

const skillLayoutClass = {
  page: "space-y-8 max-w-3xl w-full",
  hero: "flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between",
  heroDescription: "mt-2 max-w-2xl text-sm leading-relaxed text-dls-secondary",
  actionRow: "flex flex-wrap gap-3 lg:justify-end",
  filterRow: "flex flex-wrap items-center gap-2",
  cardShelf: "rounded-xl bg-dls-hover p-4",
  cardGrid: "grid grid-cols-1 gap-4 md:grid-cols-2",
  cardBody: "flex min-w-0 gap-4",
  cardMeta: "mt-3 flex flex-wrap items-center gap-2 text-xs text-dls-secondary",
  cardFooter: "flex items-center justify-between gap-3 border-t border-dls-border pt-4",
  cardFooterWrap: "flex flex-wrap items-center justify-between gap-3 border-t border-dls-border pt-4",
  cardActions: "flex flex-wrap gap-2",
  card: `${panelCardClass} flex flex-col gap-4 text-left`,
};

const ONMYAGENT_DEFAULT_SKILL_NAMES = new Set([
  "workspace-guide",
  "get-started",
  "skill-creator",
  "command-creator",
  "agent-creator",
  "plugin-creator",
]);

const SKILL_SOURCE_LABELS: Record<NonNullable<SkillCard["scope"]>, string> = {
  get builtin() { return t("skills.source_builtin"); },
  onmyagent: "OnMyAgent",
  get local() { return t("skills.source_local"); },
};

function isOpenworkInjectedSkill(skill: SkillCard) {
  const normalizedName = skill.name.trim().toLowerCase();
  const normalizedPath = skill.path.replace(/\\/g, "/").toLowerCase();
  return (
    normalizedPath.includes("/.opencode/skills/") &&
    (ONMYAGENT_DEFAULT_SKILL_NAMES.has(normalizedName) ||
      normalizedName.endsWith("-creator"))
  );
}

export type ImportedCloudSkillRecord = {
  installedName: string;
  updatedAt?: string | null;
};

export type SkillsExtensionsStore = {
  skills: () => SkillCard[];
  skillsStatus: () => string | null;
  hubSkills: () => HubSkillCard[];
  hubSkillsStatus: () => string | null;
  cloudOrgSkills: () => DenOrgSkillCard[];
  cloudOrgSkillsStatus: () => string | null;
  importedCloudSkills: () => Record<string, ImportedCloudSkillRecord>;
  hubRepo: () => HubSkillRepo | null;
  hubRepos: () => HubSkillRepo[];
  ensureHubSkillsFresh: () => void | Promise<void>;
  ensureCloudOrgSkillsFresh: () => void | Promise<void>;
  refreshSkills: (options?: { force?: boolean }) => void | Promise<void>;
  refreshHubSkills: (options?: { force?: boolean }) => void | Promise<void>;
  refreshCloudOrgSkills: (options?: {
    force?: boolean;
  }) => void | Promise<void>;
  setHubRepo: (repo: HubSkillRepo) => void | Promise<void>;
  addHubRepo: (repo: HubSkillRepo) => void | Promise<void>;
  removeHubRepo: (repo: HubSkillRepo) => void | Promise<void>;
  installSkillCreator: () => Promise<InstallResult>;
  installCloudOrgSkill: (skill: DenOrgSkillCard) => Promise<InstallResult>;
  installHubSkill: (name: string) => Promise<InstallResult>;
  importLocalSkill: () => void | Promise<void>;
  revealSkillsFolder: () => void | Promise<void>;
  readSkill: (name: string) => Promise<{ content: string } | null>;
  saveSkill: (input: {
    name: string;
    content: string;
    description?: string;
  }) => void | Promise<void>;
  uninstallSkill: (name: string) => void | Promise<void>;
};

export type SkillsViewProps = {
  workspaceName: string;
  busy: boolean;
  showHeader?: boolean;
  canInstallSkillCreator: boolean;
  canUseDesktopTools: boolean;
  accessHint?: string | null;
  extensions: SkillsExtensionsStore;
  onOpenLink: (url: string) => void;
  onToast?: (input: { title: string; tone?: ToastTone }) => void;
  createSessionAndOpen: (
    initialPrompt?: string,
  ) => Promise<string | undefined> | string | void;
};

type SkillsViewLocalState = {
  uninstallTarget: SkillCard | null;
  searchQuery: string;
  activeFilter: SkillsFilter;
  installedSkillFilter: InstalledSkillFilter;
  customRepoOpen: boolean;
  customRepoOwner: string;
  customRepoName: string;
  customRepoRef: string;
  customRepoError: string | null;
  shareTarget: SkillCard | null;
  cloudSessionNonce: number;
  shareTeamBusy: boolean;
  shareTeamError: string | null;
  shareTeamSuccess: string | null;
  sharePermissionChoice: string;
  shareHubsLoading: boolean;
  shareHubsError: string | null;
  shareManageableHubs: DenOrgSkillHubSummary[];
  selectedSkill: SkillCard | null;
  selectedContent: string;
  selectedLoading: boolean;
  selectedDirty: boolean;
  selectedError: string | null;
  installingSkillCreator: boolean;
  installingHubSkill: string | null;
  installingCloudSkillId: string | null;
  denUiTick: number;
};

type SkillsViewLocalAction<
  K extends keyof SkillsViewLocalState = keyof SkillsViewLocalState,
> =
  | { type: "set"; key: K; value: unknown }
  | { type: "denSessionUpdated" }
  | { type: "shareHubsStart" }
  | { type: "shareHubsLoaded"; hubs: DenOrgSkillHubSummary[] }
  | { type: "shareHubsFailed"; error: string }
  | { type: "shareHubsDone" }
  | { type: "closeShare" }
  | { type: "openShare"; skill: SkillCard };

const initialSkillsViewLocalState: SkillsViewLocalState = {
  uninstallTarget: null,
  searchQuery: "",
  activeFilter: "all",
  installedSkillFilter: "builtin",
  customRepoOpen: false,
  customRepoOwner: "",
  customRepoName: "",
  customRepoRef: "main",
  customRepoError: null,
  shareTarget: null,
  cloudSessionNonce: 0,
  shareTeamBusy: false,
  shareTeamError: null,
  shareTeamSuccess: null,
  sharePermissionChoice: "org",
  shareHubsLoading: false,
  shareHubsError: null,
  shareManageableHubs: [],
  selectedSkill: null,
  selectedContent: "",
  selectedLoading: false,
  selectedDirty: false,
  selectedError: null,
  installingSkillCreator: false,
  installingHubSkill: null,
  installingCloudSkillId: null,
  denUiTick: 0,
};

function skillsViewLocalReducer(
  state: SkillsViewLocalState,
  action: SkillsViewLocalAction,
): SkillsViewLocalState {
  switch (action.type) {
    case "set": {
      const current = state[action.key];
      const next =
        typeof action.value === "function"
          ? (action.value as (value: typeof current) => typeof current)(current)
          : action.value;
      if (Object.is(current, next)) return state;
      return { ...state, [action.key]: next };
    }
    case "denSessionUpdated":
      return {
        ...state,
        denUiTick: state.denUiTick + 1,
        cloudSessionNonce: state.cloudSessionNonce + 1,
      };
    case "shareHubsStart":
      return { ...state, shareHubsLoading: true, shareHubsError: null };
    case "shareHubsLoaded":
      return { ...state, shareManageableHubs: action.hubs };
    case "shareHubsFailed":
      return {
        ...state,
        shareHubsError: action.error,
        shareManageableHubs: [],
      };
    case "shareHubsDone":
      return { ...state, shareHubsLoading: false };
    case "closeShare":
      return {
        ...state,
        shareTarget: null,
        shareTeamBusy: false,
        shareTeamError: null,
        shareTeamSuccess: null,
        sharePermissionChoice: "org",
        shareHubsError: null,
        shareManageableHubs: [],
      };
    case "openShare":
      return {
        ...state,
        shareTarget: action.skill,
        shareTeamBusy: false,
        shareTeamError: null,
        shareTeamSuccess: null,
        sharePermissionChoice: "org",
        shareHubsError: null,
        shareManageableHubs: [],
        cloudSessionNonce: state.cloudSessionNonce + 1,
      };
  }
}

export function SkillsView(props: SkillsViewProps) {
  const { extensions } = props;
  const [localState, dispatchLocal] = useReducer(
    skillsViewLocalReducer,
    initialSkillsViewLocalState,
  );
  const {
    uninstallTarget,
    searchQuery,
    activeFilter,
    installedSkillFilter,
    customRepoOpen,
    customRepoOwner,
    customRepoName,
    customRepoRef,
    customRepoError,
    shareTarget,
    cloudSessionNonce,
    shareTeamBusy,
    shareTeamError,
    shareTeamSuccess,
    sharePermissionChoice,
    shareHubsLoading,
    shareHubsError,
    shareManageableHubs,
    selectedSkill,
    selectedContent,
    selectedLoading,
    selectedDirty,
    selectedError,
    installingSkillCreator,
    installingHubSkill,
    installingCloudSkillId,
    denUiTick,
  } = localState;
  const setLocal = <K extends keyof SkillsViewLocalState>(
    key: K,
    value: SetStateAction<SkillsViewLocalState[K]>,
  ) => dispatchLocal({ type: "set", key, value });
  const setUninstallTarget = (value: SetStateAction<SkillCard | null>) =>
    setLocal("uninstallTarget", value);
  const setSearchQuery = (value: SetStateAction<string>) =>
    setLocal("searchQuery", value);
  const setActiveFilter = (value: SetStateAction<SkillsFilter>) =>
    setLocal("activeFilter", value);
  const setInstalledSkillFilter = (value: SetStateAction<InstalledSkillFilter>) =>
    setLocal("installedSkillFilter", value);
  const setCustomRepoOpen = (value: SetStateAction<boolean>) =>
    setLocal("customRepoOpen", value);
  const setCustomRepoOwner = (value: SetStateAction<string>) =>
    setLocal("customRepoOwner", value);
  const setCustomRepoName = (value: SetStateAction<string>) =>
    setLocal("customRepoName", value);
  const setCustomRepoRef = (value: SetStateAction<string>) =>
    setLocal("customRepoRef", value);
  const setCustomRepoError = (value: SetStateAction<string | null>) =>
    setLocal("customRepoError", value);
  const setShareTeamBusy = (value: SetStateAction<boolean>) =>
    setLocal("shareTeamBusy", value);
  const setShareTeamError = (value: SetStateAction<string | null>) =>
    setLocal("shareTeamError", value);
  const setShareTeamSuccess = (value: SetStateAction<string | null>) =>
    setLocal("shareTeamSuccess", value);
  const setSharePermissionChoice = (value: SetStateAction<string>) =>
    setLocal("sharePermissionChoice", value);
  const setSelectedSkill = (value: SetStateAction<SkillCard | null>) =>
    setLocal("selectedSkill", value);
  const setSelectedContent = (value: SetStateAction<string>) =>
    setLocal("selectedContent", value);
  const setSelectedLoading = (value: SetStateAction<boolean>) =>
    setLocal("selectedLoading", value);
  const setSelectedDirty = (value: SetStateAction<boolean>) =>
    setLocal("selectedDirty", value);
  const setSelectedError = (value: SetStateAction<string | null>) =>
    setLocal("selectedError", value);
  const setInstallingSkillCreator = (value: SetStateAction<boolean>) =>
    setLocal("installingSkillCreator", value);
  const setInstallingHubSkill = (value: SetStateAction<string | null>) =>
    setLocal("installingHubSkill", value);
  const setInstallingCloudSkillId = (value: SetStateAction<string | null>) =>
    setLocal("installingCloudSkillId", value);

  const showToast = useCallback(
    (title: string, tone: ToastTone = "info") => {
      props.onToast?.({ title, tone });
    },
    [props],
  );

  const maskError = useCallback(
    (value: unknown) =>
      value instanceof Error ? value.message : t("common.something_went_wrong"),
    [],
  );

  useEffect(() => {
    void extensions.ensureHubSkillsFresh();
    void extensions.ensureCloudOrgSkillsFresh();
    const onDenSession = () => {
      dispatchLocal({ type: "denSessionUpdated" });
      void extensions.refreshCloudOrgSkills({ force: true });
    };
    window.addEventListener("onmyagent-den-session-updated", onDenSession);
    return () =>
      window.removeEventListener("onmyagent-den-session-updated", onDenSession);
  }, [extensions]);

  useEffect(() => {
    if (!shareTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dispatchLocal({ type: "closeShare" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shareTarget]);

  const shareCloudSignedIn = useMemo(() => {
    cloudSessionNonce;
    return Boolean(readDenSettings().authToken?.trim());
  }, [cloudSessionNonce]);

  const shareTeamOrgLabel = useMemo(() => {
    cloudSessionNonce;
    const name = readDenSettings().activeOrgName?.trim();
    return name || t("skills.share_team_org_fallback");
  }, [cloudSessionNonce]);

  const shareTeamDisabledReason = useMemo(() => {
    if (!shareCloudSignedIn) return null;
    const settings = readDenSettings();
    if (!settings.activeOrgId?.trim() && !settings.activeOrgSlug?.trim()) {
      return t("skills.share_team_choose_org");
    }
    return null;
  }, [shareCloudSignedIn]);

  useEffect(() => {
    if (!shareTarget || !shareCloudSignedIn) return;

    let cancelled = false;
    void (async () => {
      dispatchLocal({ type: "shareHubsStart" });
      try {
        const settings = readDenSettings();
        const token = settings.authToken?.trim() ?? "";
        if (!token) return;

        let orgId = settings.activeOrgId?.trim() ?? "";
        const client = createDenClient({ baseUrl: settings.baseUrl, token });
        if (!orgId) {
          const result = await client.listOrgs();
          orgId = result.orgs[0]?.id ?? "";
        }
        if (!orgId) {
          throw new Error(t("skills.share_team_choose_org"));
        }
        const hubs = await client.listOrgSkillHubSummaries(orgId);
        if (cancelled) return;
        dispatchLocal({
          type: "shareHubsLoaded",
          hubs: hubs.filter((hub) => hub.canManage),
        });
      } catch (error) {
        if (cancelled) return;
        dispatchLocal({ type: "shareHubsFailed", error: maskError(error) });
      } finally {
        if (!cancelled) dispatchLocal({ type: "shareHubsDone" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [maskError, shareCloudSignedIn, shareTarget]);

  const skills = extensions.skills();
  const hubSkills = extensions.hubSkills();
  const cloudOrgSkills = extensions.cloudOrgSkills();
  const importedCloudSkills = extensions.importedCloudSkills();
  const hubRepo = extensions.hubRepo();
  const hubRepos = extensions.hubRepos();
  const skillsStatus = extensions.skillsStatus();
  const hubSkillsStatus = extensions.hubSkillsStatus();
  const cloudOrgSkillsStatus = extensions.cloudOrgSkillsStatus();

  const skillCreatorInstalled = useMemo(
    () => skills.some((skill) => skill.name === "skill-creator"),
    [skills],
  );

  const filteredSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return skills;
    return skills.filter((skill) => {
      const description = skill.description ?? "";
      return (
        skill.name.toLowerCase().includes(query) ||
        description.toLowerCase().includes(query)
      );
    });
  }, [searchQuery, skills]);

  const visibleInstalledSkills = useMemo(
    () =>
      filteredSkills.filter((skill) =>
        installedSkillFilter === "builtin"
          ? skill.scope === "builtin" || isOpenworkInjectedSkill(skill)
          : skill.scope !== "builtin" && !isOpenworkInjectedSkill(skill),
      ),
    [filteredSkills, installedSkillFilter],
  );

  const builtInSkillCount = useMemo(
    () =>
      filteredSkills.filter(
        (skill) => skill.scope === "builtin" || isOpenworkInjectedSkill(skill),
      ).length,
    [filteredSkills],
  );

  const mySkillCount = filteredSkills.length - builtInSkillCount;

  const installedNames = useMemo(
    () => new Set(skills.map((skill) => skill.name)),
    [skills],
  );

  const filteredHubSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const items = hubSkills.filter((skill) => !installedNames.has(skill.name));
    if (!query) return items;
    return items.filter((skill) => {
      const description = skill.description ?? "";
      const trigger = skill.trigger ?? "";
      return (
        skill.name.toLowerCase().includes(query) ||
        description.toLowerCase().includes(query) ||
        trigger.toLowerCase().includes(query)
      );
    });
  }, [hubSkills, installedNames, searchQuery]);

  const filteredCloudOrgSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return cloudOrgSkills;
    return cloudOrgSkills.filter((skill) => {
      const description = skill.description ?? "";
      const hub = skill.hubName ?? "";
      return (
        skill.title.toLowerCase().includes(query) ||
        description.toLowerCase().includes(query) ||
        hub.toLowerCase().includes(query)
      );
    });
  }, [cloudOrgSkills, searchQuery]);

  const cloudSkillInstallState = useCallback(
    (skill: DenOrgSkillCard): CloudSkillInstallState => {
      const imported = importedCloudSkills[skill.id];
      if (!imported) return "available";
      if (!installedNames.has(imported.installedName)) return "missing_local";

      const remoteUpdatedAt = skill.updatedAt
        ? Date.parse(skill.updatedAt)
        : Number.NaN;
      const importedUpdatedAt = imported.updatedAt
        ? Date.parse(imported.updatedAt)
        : Number.NaN;
      if (
        Number.isFinite(remoteUpdatedAt) &&
        (!Number.isFinite(importedUpdatedAt) ||
          remoteUpdatedAt > importedUpdatedAt)
      ) {
        return "update";
      }
      return "installed";
    },
    [importedCloudSkills, installedNames],
  );

  const cloudOrgLabel = useMemo(() => {
    denUiTick;
    const name = readDenSettings().activeOrgName?.trim();
    return name || t("skills.cloud_org_fallback");
  }, [denUiTick]);

  const cloudSessionReady = useMemo(() => {
    denUiTick;
    const settings = readDenSettings();
    return Boolean(settings.authToken?.trim() && settings.activeOrgId?.trim());
  }, [denUiTick]);

  const cloudNeedsSignIn = useMemo(() => {
    denUiTick;
    return !readDenSettings().authToken?.trim();
  }, [denUiTick]);

  const sharePermissionOptions = useMemo<SelectMenuOption[]>(
    () => [
      { value: "private", label: t("skills.share_team_permission_private") },
      { value: "org", label: t("skills.share_team_permission_org") },
      ...shareManageableHubs.map((hub) => ({ value: hub.id, label: hub.name })),
    ],
    [shareManageableHubs],
  );

  const shareModalSubtitle = t("skills.share_subtitle_team");

  const activeHubRepoLabel = useMemo(
    () =>
      hubRepo
        ? `${hubRepo.owner}/${hubRepo.repo}@${hubRepo.ref}`
        : t("skills.no_hub_repo_label"),
    [hubRepo],
  );

  const hasDefaultHubRepo = useMemo(
    () =>
      hubRepos.some(
        (repo) =>
          `${repo.owner}/${repo.repo}@${repo.ref}` ===
          "WeaveQ/onmyagent-hub@main",
      ),
    [hubRepos],
  );

  const showInstalledSection =
    activeFilter === "all" || activeFilter === "installed";
  const showCloudSection = activeFilter === "all" || activeFilter === "cloud";
  const showHubSection = activeFilter === "all" || activeFilter === "hub";
  const canCreateInChat =
    !props.busy && (props.canInstallSkillCreator || props.canUseDesktopTools);

  const resolveSharePermission = () => {
    const choice = sharePermissionChoice.trim();
    if (!choice || choice === "org")
      return { shared: "org" as const, hubId: null as string | null };
    if (choice === "private")
      return { shared: null, hubId: null as string | null };
    return { shared: null, hubId: choice };
  };

  const closeShareLink = useCallback(() => {
    dispatchLocal({ type: "closeShare" });
  }, []);

  const runDesktopAction = useCallback(
    (action: () => void | Promise<void>) => {
      if (props.busy) return;
      if (!props.canUseDesktopTools) {
        showToast(t("skills.desktop_required"), "warning");
        return;
      }
      void Promise.resolve(action());
    },
    [props.busy, props.canUseDesktopTools, showToast],
  );

  const refreshCatalogs = useCallback(() => {
    if (props.busy) return;
    void extensions.refreshSkills({ force: true });
    void extensions.refreshHubSkills({ force: true });
    void extensions.refreshCloudOrgSkills({ force: true });
  }, [extensions, props.busy]);

  const installSkillCreator = useCallback(async () => {
    if (props.busy || installingSkillCreator) return;
    if (!props.canInstallSkillCreator) {
      showToast(props.accessHint ?? t("skills.host_only_error"), "warning");
      return;
    }
    setInstallingSkillCreator(true);
    showToast(t("skills.installing_skill_creator"));
    try {
      const result = await extensions.installSkillCreator();
      showToast(result.message, "success");
    } catch (error) {
      showToast(maskError(error), "error");
    } finally {
      setInstallingSkillCreator(false);
    }
  }, [
    extensions,
    installingSkillCreator,
    maskError,
    props.accessHint,
    props.busy,
    props.canInstallSkillCreator,
    showToast,
  ]);

  const installFromCloud = useCallback(
    async (skill: DenOrgSkillCard) => {
      if (props.busy || installingCloudSkillId) return;
      const state = cloudSkillInstallState(skill);
      if (state === "installed") return;
      setInstallingCloudSkillId(skill.id);
      showToast(
        t(
          state === "update"
            ? "skills.cloud_updating"
            : "skills.cloud_installing",
          undefined,
          { title: skill.title },
        ),
      );
      try {
        const result = await extensions.installCloudOrgSkill(skill);
        showToast(result.message, result.ok ? "success" : "error");
      } catch (error) {
        showToast(maskError(error), "error");
      } finally {
        setInstallingCloudSkillId(null);
      }
    },
    [
      cloudSkillInstallState,
      extensions,
      installingCloudSkillId,
      maskError,
      props.busy,
      showToast,
    ],
  );

  const installFromHub = useCallback(
    async (skill: HubSkillCard) => {
      if (props.busy || installingHubSkill) return;
      setInstallingHubSkill(skill.name);
      showToast(`${t("skills.installing_prefix")} ${skill.name}...`);
      try {
        const result = await extensions.installHubSkill(skill.name);
        showToast(result.message, "success");
      } catch (error) {
        showToast(maskError(error), "error");
      } finally {
        setInstallingHubSkill(null);
      }
    },
    [extensions, installingHubSkill, maskError, props.busy, showToast],
  );

  const handleNewSkill = useCallback(async () => {
    if (props.busy) return;
    if (props.canInstallSkillCreator && !skillCreatorInstalled) {
      await installSkillCreator();
    }
    await Promise.resolve(props.createSessionAndOpen("/skill-creator"));
  }, [installSkillCreator, props, skillCreatorInstalled]);

  const openCloudSignIn = useCallback(() => {
    const base = readDenSettings().baseUrl?.trim() || DEFAULT_DEN_BASE_URL;
    props.onOpenLink(buildDenAuthUrl(base, "sign-in"));
  }, [props]);

  const openShareLink = useCallback(
    (skill: SkillCard) => {
      if (props.busy) return;
      dispatchLocal({ type: "openShare", skill });
    },
    [props.busy],
  );

  const startShareSkillSignIn = useCallback(() => {
    const settings = readDenSettings();
    props.onOpenLink(buildDenAuthUrl(settings.baseUrl, "sign-in"));
  }, [props]);

  const publishSkillToTeam = useCallback(async () => {
    if (!shareTarget || props.busy || shareTeamBusy || shareTeamDisabledReason)
      return;
    setShareTeamBusy(true);
    setShareTeamError(null);
    setShareTeamSuccess(null);
    try {
      const skill = await extensions.readSkill(shareTarget.name);
      if (!skill) throw new Error("Failed to load skill");
      const sharing = resolveSharePermission();
      const { orgName, orgId } = await saveInstalledSkillToOnMyAgentOrg({
        skillText: skill.content,
        shared: sharing.shared,
        skillHubId: sharing.hubId,
      });
      setShareTeamSuccess(
        t("skills.share_team_uploaded_success", undefined, { org: orgName }),
      );
      window.dispatchEvent(
        new CustomEvent<{ orgId: string }>("onmyagent-den-org-skills-changed", {
          detail: { orgId },
        }),
      );
      void extensions.refreshCloudOrgSkills({ force: true });
    } catch (error) {
      setShareTeamError(maskError(error));
    } finally {
      setShareTeamBusy(false);
    }
  }, [
    extensions,
    maskError,
    props.busy,
    shareTarget,
    shareTeamBusy,
    shareTeamDisabledReason,
  ]);

  const openSkill = useCallback(
    async (skill: SkillCard) => {
      if (props.busy) return;
      setSelectedSkill(skill);
      setSelectedContent("");
      setSelectedDirty(false);
      setSelectedError(null);
      setSelectedLoading(true);
      try {
        const result = await extensions.readSkill(skill.name);
        if (!result) {
          setSelectedError(t("skills.skill_load_failed"));
          return;
        }
        setSelectedContent(result.content);
      } catch (error) {
        setSelectedError(maskError(error));
      } finally {
        setSelectedLoading(false);
      }
    },
    [extensions, maskError, props.busy],
  );

  const saveSelectedSkill = useCallback(async () => {
    if (!selectedSkill || !selectedDirty) return;
    if (selectedSkill.readonly) {
      setSelectedError(t("skills.builtin_readonly_edit"));
      return;
    }
    setSelectedError(null);
    try {
      await Promise.resolve(
        extensions.saveSkill({
          name: selectedSkill.name,
          content: selectedContent,
          description: selectedSkill.description,
        }),
      );
      setSelectedDirty(false);
    } catch (error) {
      setSelectedError(maskError(error));
    }
  }, [extensions, maskError, selectedContent, selectedDirty, selectedSkill]);

  const selectHubRepo = useCallback(
    (repo: HubSkillRepo) => {
      void Promise.resolve(extensions.setHubRepo(repo)).then(() => {
        void extensions.refreshHubSkills({ force: true });
      });
    },
    [extensions],
  );

  const openCustomRepoModal = useCallback(() => {
    if (props.busy) return;
    setCustomRepoOpen(true);
    setCustomRepoOwner(hubRepo?.owner ?? "");
    setCustomRepoName(hubRepo?.repo ?? "");
    setCustomRepoRef(hubRepo?.ref || "main");
    setCustomRepoError(null);
  }, [hubRepo, props.busy]);

  const closeCustomRepoModal = useCallback(() => {
    setCustomRepoOpen(false);
    setCustomRepoError(null);
  }, []);

  const saveCustomRepo = useCallback(() => {
    const owner = customRepoOwner.trim();
    const repo = customRepoName.trim();
    const ref = customRepoRef.trim() || "main";
    if (!owner || !repo) {
      setCustomRepoError(t("skills.owner_repo_required"));
      return;
    }
    void Promise.resolve(extensions.addHubRepo({ owner, repo, ref })).then(
      () => {
        void extensions.refreshHubSkills({ force: true });
      },
    );
    closeCustomRepoModal();
  }, [
    closeCustomRepoModal,
    customRepoName,
    customRepoOwner,
    customRepoRef,
    extensions,
  ]);

  const handleSkillCardKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    skill: SkillCard,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void openSkill(skill);
  };

  return (
    <section className={skillLayoutClass.page}>
      <div className="space-y-6">
        <div className={skillLayoutClass.hero}>
          <div className="min-w-0">
            {props.showHeader !== false ? (
              <h2 className={pageTitleClass}>{t("skills.title")}</h2>
            ) : null}
            <p className={skillLayoutClass.heroDescription}>
              {t("skills.worker_profile_desc")}
            </p>
          </div>

          <div className={skillLayoutClass.actionRow}>
            <Button variant="outline" size="sm"
              type="button"
              onClick={() => runDesktopAction(extensions.revealSkillsFolder)}
              disabled={props.busy || !props.canUseDesktopTools}
            >
              <FolderOpen size={14} />
              {t("skills.reveal_folder")}
            </Button>
            <Button variant="default" size="lg"
              type="button"
              onClick={() => void handleNewSkill()}
              disabled={!canCreateInChat}
            >
              <Sparkles size={14} />
              {t("skills.create_in_chat")}
            </Button>
          </div>
        </div>

        <SettingsPanel className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <InputGroup controlSize="xl" radius="xl" tone="surface" className="min-w-0 flex-1">
            <InputGroupAddon align="inline-start" inset="comfortable">
              <Search size={16} />
            </InputGroupAddon>
            <InputGroupInput
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder={t("skills.catalog_search_placeholder")}
              className="text-sm text-dls-text"
            />
          </InputGroup>

          <div className={skillLayoutClass.filterRow}>
            {(["all", "installed", "cloud", "hub"] as SkillsFilter[]).map(
              (filter) => (
                <NavTabButton
                  key={filter}
                  type="button"
                  onClick={() => setActiveFilter(filter)}
                  active={activeFilter === filter}
                >
                  {filter === "all"
                    ? t("skills.filter_all")
                    : filter === "installed"
                      ? t("skills.filter_installed")
                      : filter === "cloud"
                        ? t("skills.filter_cloud")
                        : t("skills.filter_hub")}
                </NavTabButton>
              ),
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={refreshCatalogs}
              disabled={props.busy}
            >
              <RefreshCw data-icon="inline-start" size={14} />
              {t("common.refresh")}
            </Button>
          </div>
        </SettingsPanel>
      </div>

      {props.accessHint ? (
        <SettingsNotice size="comfortable">
          {props.accessHint}
        </SettingsNotice>
      ) : null}
      {!props.accessHint &&
      !props.canInstallSkillCreator &&
      !props.canUseDesktopTools ? (
        <SettingsNotice size="comfortable">
          {t("skills.host_mode_only")}
        </SettingsNotice>
      ) : null}

      {skillsStatus ? (
        <SettingsNotice size="comfortable" className="whitespace-pre-wrap break-words">
          {skillsStatus}
        </SettingsNotice>
      ) : null}

      {showInstalledSection ? (
        <div className="space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className={sectionTitleClass}>{t("skills.installed")}</h3>
              <p className="mt-1 text-sm text-dls-secondary">
                {t("skills.installed_desc")}
              </p>
            </div>
            <div className="text-xs text-dls-secondary">
              {t("skills.shown_count", undefined, {
                count: visibleInstalledSkills.length,
              })}
            </div>
          </div>

          <SegmentedTabGroup className="w-fit">
            {(["builtin", "mine"] as InstalledSkillFilter[]).map((view) => {
              const active = installedSkillFilter === view;
              const count = view === "builtin" ? builtInSkillCount : mySkillCount;
              return (
                <NavTabButton
                  key={view}
                  active={active}
                  size="tab"
                  shape="tab"
                  onClick={() => setInstalledSkillFilter(view)}
                  className="px-4 py-2 text-sm font-medium"
                >
                  {view === "builtin"
                    ? t("skills.builtin_tab")
                    : t("skills.mine_tab")}
                  <span className="tabular-nums text-dls-secondary">{count}</span>
                </NavTabButton>
              );
            })}
          </SegmentedTabGroup>

          {visibleInstalledSkills.length === 0 ? (
            <SettingsListEmptyState size="spacious" className="text-left">
              {installedSkillFilter === "builtin"
                ? t("skills.no_builtin_skills")
                : t("skills.no_my_skills")}
            </SettingsListEmptyState>
          ) : (
            <div className={skillLayoutClass.cardShelf}>
              <div className={skillLayoutClass.cardGrid}>
                {visibleInstalledSkills.map((skill) => (
                  <div
                    key={skill.path}
                    role="button"
                    tabIndex={0}
                    className={`${panelCardClass} flex cursor-pointer flex-col gap-4 text-left`}
                    onClick={() => void openSkill(skill)}
                    onKeyDown={(event) => handleSkillCardKeyDown(event, skill)}
                  >
                    <div className={skillLayoutClass.cardBody}>
                      <IconTile size="md" shape="xl" border>
                        <Package size={20} className="text-dls-secondary" />
                      </IconTile>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className={skillTextClass.cardTitle}>
                            {skill.name}
                          </h4>
                          {isOpenworkInjectedSkill(skill) ? (
                            <span className={tagClass}>{APP_NAME}</span>
                          ) : null}
                          {skill.scope ? (
                            <span className={tagClass}>
                              {SKILL_SOURCE_LABELS[skill.scope]}
                            </span>
                          ) : null}
                          {skill.readonly ? (
                            <span className={tagClass}>{t("skills.readonly")}</span>
                          ) : null}
                        </div>
                        <p className={skillTextClass.cardDescription}>
                          {skill.description || t("skills.no_description")}
                        </p>
                      </div>
                    </div>

                    <div className={skillLayoutClass.cardFooterWrap}>
                      <span className={tagClass}>
                        {t("skills.installed_status")}
                      </span>
                      <div className={skillLayoutClass.cardActions}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openShareLink(skill);
                          }}
                          disabled={props.busy}
                          title={t("skills.share_option_team_title")}
                        >
                          <Users data-icon="inline-start" size={14} />
                          {t("skills.share_option_team_title")}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void openSkill(skill);
                          }}
                          disabled={props.busy}
                          title={skill.readonly ? t("common.view") : t("common.edit")}
                        >
                          <Edit2 data-icon="inline-start" size={14} />
                          {skill.readonly ? t("common.view") : t("common.edit")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (skill.readonly) {
                              showToast(
                                t("skills.builtin_readonly_uninstall"),
                                "warning",
                              );
                              return;
                            }
                            if (props.busy || !props.canUseDesktopTools) {
                              if (!props.canUseDesktopTools)
                                showToast(
                                  t("skills.desktop_required"),
                                  "warning",
                                );
                              return;
                            }
                            setUninstallTarget(skill);
                          }}
                          disabled={
                            props.busy ||
                            !props.canUseDesktopTools ||
                            skill.readonly
                          }
                          title={t("skills.uninstall")}
                        >
                          <Trash2 data-icon="inline-start" size={14} />
                          {t("common.remove")}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {showCloudSection ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="mb-0.5 text-xs text-dls-secondary">
                {cloudOrgLabel}
              </p>
              <h3 className={sectionTitleClass}>
                {t("skills.cloud_section_title")}
              </h3>
              <p className={skillLayoutClass.heroDescription}>
                {t("skills.cloud_section_subtitle")}
              </p>
            </div>
            <div className={skillLayoutClass.filterRow}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  void extensions.refreshCloudOrgSkills({ force: true })
                }
                disabled={props.busy}
              >
                <RefreshCw data-icon="inline-start" size={14} />
                {t("skills.cloud_refresh")}
              </Button>
            </div>
          </div>

          {!cloudSessionReady ? (
            <SettingsListEmptyState className="text-left">
              {cloudNeedsSignIn ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p>{t("skills.cloud_sign_in_hint")}</p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={openCloudSignIn}
                  >
                    {t("skills.cloud_sign_in")}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p>{t("skills.cloud_choose_org_hint")}</p>
                  <p className="text-sm">
                    {t("skills.cloud_choose_org_detail")}
                  </p>
                </div>
              )}
            </SettingsListEmptyState>
          ) : (
            <>
              {cloudOrgSkillsStatus ? (
                <SettingsNotice size="comfortable" className="whitespace-pre-wrap break-words">
                  {cloudOrgSkillsStatus}
                </SettingsNotice>
              ) : null}

              {filteredCloudOrgSkills.length === 0 ? (
                <SettingsListEmptyState size="spacious" className="text-left">
                  {cloudOrgSkills.length === 0
                    ? t("skills.cloud_org_empty")
                    : t("skills.cloud_no_search_matches")}
                </SettingsListEmptyState>
              ) : (
                <div className={skillLayoutClass.cardShelf}>
                  <div className={skillLayoutClass.cardGrid}>
                    {filteredCloudOrgSkills.map((skill) => {
                      const state = cloudSkillInstallState(skill);
                      const installedName =
                        importedCloudSkills[skill.id]?.installedName ?? null;
                      return (
                        <div
                          key={skill.id}
                        className={skillLayoutClass.card}
                        >
                          <div className="flex min-w-0 gap-4">
                            <IconTile size="md" shape="xl" border>
                              <Cloud size={20} className="text-dls-secondary" />
                            </IconTile>
                            <div className="min-w-0 flex-1">
                              <h4 className={skillTextClass.cardTitle}>
                                {skill.title}
                              </h4>
                              {skill.description ? (
                                <p className={skillTextClass.cardDescription}>
                                  {skill.description}
                                </p>
                              ) : null}
                              <div className={skillLayoutClass.cardMeta}>
                                {skill.hubName ? (
                                  <span className={tagClass}>
                                    {t("skills.cloud_hub_label", undefined, {
                                      name: skill.hubName,
                                    })}
                                  </span>
                                ) : null}
                                {skill.shared === "org" ? (
                                  <span className={tagClass}>
                                    {t("skills.cloud_shared_org")}
                                  </span>
                                ) : null}
                                {skill.shared === "public" ? (
                                  <span className={tagClass}>
                                    {t("skills.cloud_shared_public")}
                                  </span>
                                ) : null}
                                {skill.shared === null && !skill.hubName ? (
                                  <span className={tagClass}>
                                    {t("skills.cloud_shared_private")}
                                  </span>
                                ) : null}
                                {installedName ? (
                                  <span className={tagClass}>
                                    {t("skills.cloud_installed_as", undefined, {
                                      name: installedName,
                                    })}
                                  </span>
                                ) : null}
                                {state === "installed" ? (
                                  <span className={tagClass}>
                                    {t("skills.cloud_status_installed")}
                                  </span>
                                ) : null}
                                {state === "update" ? (
                                  <span className={tagClass}>
                                    {t("skills.cloud_status_update")}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          <div className={skillLayoutClass.cardFooter}>
                            <span className={tagClass}>
                              {t("skills.cloud_footer_label")}
                            </span>
                            <Button
                              type="button"
                              variant={installingCloudSkillId === skill.id || state === "installed" ? "secondary" : "default"}
                              size="sm"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void installFromCloud(skill);
                              }}
                              disabled={
                                props.busy ||
                                installingCloudSkillId === skill.id ||
                                state === "installed"
                              }
                            >
                              {installingCloudSkillId === skill.id ? (
                                <LoadingSpinner size="sm" data-icon="inline-start" />
                              ) : (
                                <Plus data-icon="inline-start" size={14} />
                              )}
                              {installingCloudSkillId === skill.id
                                ? t("skills.cloud_installing_short")
                                : state === "update"
                                  ? t("skills.cloud_update_skill")
                                  : state === "installed"
                                    ? t("skills.cloud_status_installed")
                                    : t("skills.install")}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : null}

      {showHubSection ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className={sectionTitleClass}>
                {t("skills.available_from_hub")}
              </h3>
              <p className="mt-1 text-sm text-dls-secondary">
                {t("skills.hub_desc")}
              </p>
            </div>
            <div className={skillLayoutClass.filterRow}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void Promise.resolve(
                    extensions.addHubRepo({
                      owner: "WeaveQ",
                      repo: "onmyagent-hub",
                      ref: "main",
                    }),
                  ).then(() => {
                    void extensions.refreshHubSkills({ force: true });
                  });
                }}
                disabled={props.busy || hasDefaultHubRepo}
              >
                <Plus data-icon="inline-start" size={14} />
                {t("skills.add_onmyagent_hub")}
              </Button>
              <Button variant="outline" size="lg"
                type="button"
                onClick={openCustomRepoModal}
                disabled={props.busy}
               >
                <Plus size={14} />
                {t("skills.add_git_repo")}
              </Button>
              <Button variant="outline" size="sm"
                type="button"
                onClick={() =>
                  void extensions.refreshHubSkills({ force: true })
                }
                disabled={props.busy}
               >
                <RefreshCw size={14} />
                {t("skills.refresh_hub")}
              </Button>
            </div>
          </div>

          <SettingsPanel className="space-y-3">
            <div className="text-xs text-dls-secondary">
              {t("skills.source_label")}:{" "}
              <span className="font-mono text-dls-text">
                {activeHubRepoLabel}
              </span>
            </div>
            <div className={skillLayoutClass.filterRow}>
              {hubRepos.map((repo) => {
                const key = `${repo.owner}/${repo.repo}@${repo.ref}`;
                const active = hubRepo
                  ? key === `${hubRepo.owner}/${hubRepo.repo}@${hubRepo.ref}`
                  : false;
                return (
                  <div
                    key={key}
                    className="inline-flex items-center overflow-hidden rounded-full border border-dls-border bg-dls-surface"
                  >
                    <Button
                      type="button"
                      onClick={() => selectHubRepo(repo)}
                      variant="ghost"
                      size="xs"
                      className={`rounded-none px-3 font-medium ${
                        active
                          ? "bg-dls-accent text-dls-accent-fg hover:text-dls-accent-fg"
                          : "text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
                      }`}
                      disabled={props.busy}
                    >
                      {key}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="rounded-none text-dls-secondary hover:bg-dls-status-danger-soft hover:text-dls-status-danger-fg"
                      onClick={() => {
                        void Promise.resolve(
                          extensions.removeHubRepo(repo),
                        ).then(() => {
                          void extensions.refreshHubSkills({ force: true });
                        });
                      }}
                      disabled={props.busy}
                      title={t("skills.remove_saved_repo")}
                    >
                      ×
                    </Button>
                  </div>
                );
              })}
            </div>
          </SettingsPanel>

          {hubSkillsStatus ? (
            <SettingsNotice size="comfortable" className="whitespace-pre-wrap break-words">
              {hubSkillsStatus}
            </SettingsNotice>
          ) : null}

          {filteredHubSkills.length === 0 ? (
            <SettingsListEmptyState size="spacious" className="text-left">
              {hubRepo
                ? t("skills.no_hub_skills")
                : t("skills.no_hub_repo_selected")}
            </SettingsListEmptyState>
          ) : (
            <div className={skillLayoutClass.cardShelf}>
              <div className={skillLayoutClass.cardGrid}>
                {filteredHubSkills.map((skill) => (
                  <div
                    key={`${skill.source.owner}/${skill.source.repo}/${skill.name}`}
                    className={skillLayoutClass.card}
                  >
                    <div className={skillLayoutClass.cardBody}>
                      <IconTile size="md" shape="xl" border>
                        <Package size={20} className="text-dls-secondary" />
                      </IconTile>
                      <div className="min-w-0 flex-1">
                        <h4 className={skillTextClass.cardTitle}>
                          {skill.name}
                        </h4>
                        <p className={skillTextClass.cardDescription}>
                          {skill.description ||
                            t("skills.from_repo", undefined, {
                              owner: skill.source.owner,
                              repo: skill.source.repo,
                            })}
                        </p>
                        <div className={skillLayoutClass.cardMeta}>
                          <span className={`${tagClass} font-mono`}>
                            {skill.source.owner}/{skill.source.repo}
                          </span>
                          {skill.trigger ? (
                            <span
                              className={tagClass}
                              title={t("skills.trigger_label", undefined, {
                                trigger: skill.trigger,
                              })}
                            >
                              {t("skills.trigger_label", undefined, {
                                trigger: skill.trigger,
                              })}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className={skillLayoutClass.cardFooter}>
                      <span className={tagClass}>{t("skills.hub_label")}</span>
                      <Button
                        type="button"
                        variant={installingHubSkill === skill.name ? "secondary" : "default"}
                        size="sm"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void installFromHub(skill);
                        }}
                        disabled={
                          props.busy || installingHubSkill === skill.name
                        }
                        title={t("skills.install_name_title", undefined, {
                          name: skill.name,
                        })}
                      >
                        {installingHubSkill === skill.name ? (
                          <LoadingSpinner size="sm" data-icon="inline-start" />
                        ) : (
                          <Plus data-icon="inline-start" size={14} />
                        )}
                        {installingHubSkill === skill.name
                          ? t("skills.installing")
                          : t("common.add")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      <Dialog
        open={Boolean(selectedSkill)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSkill(null);
            setSelectedContent("");
            setSelectedDirty(false);
            setSelectedError(null);
            setSelectedLoading(false);
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] min-h-0 w-full max-w-4xl flex-col overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <div className="flex min-w-0 items-center gap-3">
              <DialogTitle className="min-w-0 flex-1 truncate">
                {selectedSkill?.name}
              </DialogTitle>
              {selectedSkill?.scope ? (
                <span className={tagClass}>
                  {SKILL_SOURCE_LABELS[selectedSkill.scope]}
                </span>
              ) : null}
              {selectedSkill?.readonly ? (
                <span className={tagClass}>{t("skills.readonly")}</span>
              ) : null}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  disabled={!selectedDirty || props.busy || selectedSkill?.readonly}
                  onClick={() => void saveSelectedSkill()}
                >
                  {t("common.save")}
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {selectedError ? (
              <SettingsNotice tone="error" className="mb-3">
                {selectedError}
              </SettingsNotice>
            ) : null}
            {selectedLoading ? (
              <div className="text-xs text-dls-secondary">
                {t("skills.loading")}
              </div>
            ) : (
              <Textarea
                value={selectedContent}
                onChange={(event) => {
                  if (selectedSkill?.readonly) return;
                  setSelectedContent(event.currentTarget.value);
                  setSelectedDirty(true);
                }}
                readOnly={selectedSkill?.readonly}
                variant="dlsMono"
                controlSize="largeEditor"
                spellCheck={false}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={Boolean(uninstallTarget)}
        title={t("skills.uninstall_title")}
        message={t("skills.uninstall_warning").replace(
          "{name}",
          uninstallTarget?.name ?? "",
        )}
        confirmLabel={t("skills.uninstall")}
        cancelLabel={t("common.cancel")}
        confirmButtonVariant="destructive"
        onCancel={() => setUninstallTarget(null)}
        onConfirm={() => {
          const target = uninstallTarget;
          setUninstallTarget(null);
          if (!target) return;
          void extensions.uninstallSkill(target.name);
        }}
      />

      <Dialog
        open={Boolean(shareTarget)}
        onOpenChange={(open) => {
          if (!open) closeShareLink();
        }}
      >
        <DialogContent className="flex max-h-[78vh] min-h-0 w-full max-w-md flex-col overflow-hidden sm:max-w-md">
          <DialogHeader>
            <div className="min-w-0 flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle>{t("skills.share_title")}</DialogTitle>
                <span className={tagClass}>{shareTarget?.name}</span>
              </div>
              <DialogDescription>{shareModalSubtitle}</DialogDescription>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-5 pt-2">
              <p className="text-sm leading-relaxed text-dls-secondary">
                {t("skills.share_team_permissions_intro")}
              </p>
              <div className={surfaceCardClass}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={tagClass}>{shareTeamOrgLabel}</span>
                </div>
                {shareTeamError?.trim() ? (
                  <div className={`mt-4 ${modalNoticeErrorClass}`}>
                    {shareTeamError}
                  </div>
                ) : null}
                {shareTeamSuccess?.trim() ? (
                  <div className={`mt-4 ${modalNoticeSuccessClass}`}>
                    {shareTeamSuccess}
                  </div>
                ) : null}
                {shareHubsError?.trim() ? (
                  <div className={`mt-4 ${modalNoticeErrorClass}`}>
                    {shareHubsError}
                  </div>
                ) : null}
                {shareCloudSignedIn && shareTeamDisabledReason?.trim() ? (
                  <div className="mt-4 text-xs text-dls-secondary">
                    {shareTeamDisabledReason}
                  </div>
                ) : null}
                {shareCloudSignedIn ? (
                  <div className="mt-4">
                    <span
                      id="skills-share-hub-label"
                      className="mb-1.5 block text-sm font-medium text-dls-text"
                    >
                      {t("skills.share_team_permissions_label")}
                    </span>
                    <SelectMenu
                      ariaLabelledBy="skills-share-hub-label"
                      options={sharePermissionOptions}
                      value={sharePermissionChoice}
                      onChange={setSharePermissionChoice}
                      disabled={
                        shareTeamBusy || Boolean(shareTeamSuccess?.trim())
                      }
                    />
                  </div>
                ) : null}
                {shareCloudSignedIn && shareHubsLoading ? (
                  <div className="mt-3 flex items-center gap-2 text-xs text-dls-secondary">
                    <LoadingSpinner size="sm" />
                    {t("skills.share_team_hubs_loading")}
                  </div>
                ) : null}
                <Button
                  type="button"
                  onClick={() => {
                    if (!shareCloudSignedIn) {
                      startShareSkillSignIn();
                      return;
                    }
                    void publishSkillToTeam();
                  }}
                  disabled={
                    shareCloudSignedIn
                      ? Boolean(shareTeamDisabledReason) ||
                        shareTeamBusy ||
                        Boolean(shareTeamSuccess?.trim())
                      : false
                  }
                  className="mt-4 w-full"
                >
                  {!shareCloudSignedIn
                    ? t("skills.share_team_sign_in")
                    : shareTeamBusy
                      ? t("skills.share_team_uploading")
                      : t("skills.share_team_upload_and_save")}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              {t("skills.share_done")}
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={customRepoOpen}
        onOpenChange={(open) => {
          if (!open) closeCustomRepoModal();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="w-full max-w-lg overflow-hidden sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>{t("skills.add_custom_repo")}</DialogTitle>
            <DialogDescription>
              {t("skills.github_repo_hint")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <div className={skillTextClass.fieldLabel}>
                  {t("skills.owner_label")}
                </div>
                <Input
                  type="text"
                  value={customRepoOwner}
                  onChange={(event) =>
                    setCustomRepoOwner(event.currentTarget.value)
                  }
                  placeholder={t("skills.owner_placeholder")}
                  className="h-9 rounded-lg bg-dls-hover font-mono text-xs text-dls-text"
                  spellCheck={false}
                />
              </label>
              <label className="space-y-1">
                <div className={skillTextClass.fieldLabel}>
                  {t("skills.repo_label")}
                </div>
                <Input
                  type="text"
                  value={customRepoName}
                  onChange={(event) =>
                    setCustomRepoName(event.currentTarget.value)
                  }
                  placeholder="onmyagent-hub"
                  className="h-9 rounded-lg bg-dls-hover font-mono text-xs text-dls-text"
                  spellCheck={false}
                />
              </label>
            </div>

            <label className="space-y-1">
              <div className={skillTextClass.fieldLabel}>
                {t("skills.ref_label")}
              </div>
              <Input
                type="text"
                value={customRepoRef}
                onChange={(event) =>
                  setCustomRepoRef(event.currentTarget.value)
                }
                placeholder="main"
                className="h-9 rounded-lg bg-dls-hover font-mono text-xs text-dls-text"
                spellCheck={false}
              />
            </label>

            {customRepoError ? (
              <SettingsNotice tone="error">
                {customRepoError}
              </SettingsNotice>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose
              disabled={props.busy}
              render={<Button variant="outline" disabled={props.busy} />}
            >
              {t("common.cancel")}
            </DialogClose>
            <Button
              variant="secondary"
              onClick={saveCustomRepo}
              disabled={props.busy}
            >
              {t("skills.save_and_load")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default SkillsView;
