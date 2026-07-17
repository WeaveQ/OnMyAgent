import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent } from "react";
import { ArrowLeft, ArrowRight, Bot, Globe, Plus, RotateCw, X } from "lucide-react";
import { useDragControls } from "motion/react";
import { isElectronRuntime } from "@/app/utils";
import { PanelTab, PanelTabClose, PanelTabItem, PanelTabList } from "@/components/panel-tabs";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getActiveTab,
  type BrowserStatePayload,
  type BrowserTabInfo,
  useBrowserState,
} from "./use-browser-state";
import { filterTabsForSession } from "./session-browser-tabs";

type BrowserPanelProps = {
  onClose: () => void;
  /** Chat session id — scopes page tabs so A/B sessions do not share tabs. */
  sessionId?: string | null;
};
type EmbeddedBrowserViewportProps = {
  url?: string;
  announcePanelOpen?: boolean;
  className?: string;
};

function getTabLabel(tab: BrowserTabInfo) {
  if (tab.title) {
    return tab.title;
  }

  if (tab.url && tab.url !== "about:blank") {
    return tab.url;
  }

  return t("session.browser_new_tab");
}

function getNativeMenuPoint(
  el: HTMLElement | null,
  point?: { clientX: number; clientY: number },
) {
  const zoom = window.__ONMYAGENT_ZOOM_FACTOR__ ?? 1;

  if (point) {
    return {
      x: Math.round(point.clientX * zoom),
      y: Math.round(point.clientY * zoom),
    };
  }

  if (!el) {
    return undefined;
  }

  const rect = el.getBoundingClientRect();

  return {
    x: Math.round((rect.left + 8) * zoom),
    y: Math.round((rect.bottom + 4) * zoom),
  };
}

function getElectronBrowser() {
  if (!isElectronRuntime()) {
    return null;
  }

  return window.__ONMYAGENT_ELECTRON__?.browser ?? null;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    getElectronBrowser()?.hide?.();
  });
}

function computeBounds(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const zoom = window.__ONMYAGENT_ZOOM_FACTOR__ ?? 1;

  // WebContentsView bounds use the BrowserWindow contentView coordinate space.
  // Renderer client rects are reported in zoomed CSS pixels, so convert back to
  // contentView coordinates by applying the desktop zoom factor. Dividing by the
  // zoom factor shifts the native browser into the transcript.
  return {
    x: Math.round(rect.x * zoom),
    y: Math.round(rect.y * zoom),
    width: Math.round(rect.width * zoom),
    height: Math.round(rect.height * zoom),
  };
}

function sameBounds(
  left: { x: number; y: number; width: number; height: number } | null,
  right: { x: number; y: number; width: number; height: number },
) {
  return Boolean(
    left &&
      left.x === right.x &&
      left.y === right.y &&
      left.width === right.width &&
      left.height === right.height,
  );
}

function hasNativeBrowserOccluder() {
  const overlays = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
  for (const overlay of overlays) {
    if (!(overlay instanceof HTMLElement)) continue;
    if (overlay.offsetParent !== null || overlay.getClientRects().length > 0) return true;
  }
  return false;
}

type BrowserTabProps = {
  tab: BrowserTabInfo;
};

function BrowserTab({ tab }: BrowserTabProps) {
  const dragControls = useDragControls();
  const tabRef = useRef<HTMLDivElement>(null);
  const label = getTabLabel(tab);

  const selectTab = () => {
    getElectronBrowser()?.selectTab?.(tab.tabId);
  };

  const closeTab = () => {
    getElectronBrowser()?.closeTab?.(tab.tabId);
  };

  const showTabContextMenu = (point?: { clientX: number; clientY: number }) => {
    void getElectronBrowser()?.showTabContextMenu?.(
      tab.tabId,
      getNativeMenuPoint(tabRef.current, point),
    );
  };

  return (
    <PanelTabItem
      value={tab.tabId}
      id={tab.tabId}
      dragControls={dragControls}
      onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        showTabContextMenu({ clientX: event.clientX, clientY: event.clientY });
      }}
    >
      <div ref={tabRef} className="relative">
        <PanelTab
          active={tab.isActive}
          onClick={selectTab}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }

            dragControls.start(event);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
              return;
            }

            event.preventDefault();
            showTabContextMenu();
          }}
          title={label}
          aria-label={t("session.browser_select_tab", { label })}
        >
          {tab.favicon ? (
            <img src={tab.favicon} alt="" className="size-3.5 shrink-0 rounded-xs" />
          ) : tab.isLoading ? (
            <LoadingSpinner size="default" />
          ) : (
            tab.owner === "agent" || tab.owner === "claimed" ? <Bot /> : <Globe />
          )}
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        </PanelTab>
        {tab.owner === "user" || !tab.owner ? (
          <PanelTabClose active={tab.isActive} label={label} onClose={closeTab} />
        ) : null}
      </div>
    </PanelTabItem>
  );
}

export function EmbeddedBrowserViewport({
  url,
  announcePanelOpen = true,
  className,
}: EmbeddedBrowserViewportProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef(false);
  const boundsFrameRef = useRef<number | null>(null);
  const lastBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const browser = getElectronBrowser();
    if (!browser || !url) return;
    void browser.navigate?.(url, { announcePanelOpen });
  }, [announcePanelOpen, url]);

  useLayoutEffect(() => {
    const browser = getElectronBrowser();
    const content = contentRef.current;
    if (!browser || !content) return;
    const bounds = computeBounds(content);
    if (bounds.width < 1 || bounds.height < 1) return;
    browser.setBounds?.(bounds);
    lastBoundsRef.current = bounds;
  });

  useLayoutEffect(() => {
    const browser = getElectronBrowser();

    if (!browser || !contentRef.current) {
      return;
    }

    const content = contentRef.current;
    let disposed = false;

    const resetNativeView = async () => {
      await browser.hide?.();
      if (disposed) return;
      shownRef.current = false;
      lastBoundsRef.current = null;
      boundsFrameRef.current = window.requestAnimationFrame(watchBounds);
    };

    const syncBounds = () => {
      const bounds = computeBounds(content);

      if (bounds.width < 1 || bounds.height < 1 || hasNativeBrowserOccluder()) {
        if (shownRef.current) {
          browser.hide?.();
          shownRef.current = false;
          lastBoundsRef.current = null;
        }
        return;
      }

      if (!shownRef.current) {
        browser.show?.(bounds);
        shownRef.current = true;
        lastBoundsRef.current = bounds;
        return;
      }

      if (!sameBounds(lastBoundsRef.current, bounds)) {
        browser.setBounds?.(bounds);
        lastBoundsRef.current = bounds;
      }
    };

    const watchBounds = () => {
      syncBounds();
      boundsFrameRef.current = window.requestAnimationFrame(watchBounds);
    };

    void resetNativeView();

    const observer = new ResizeObserver(scheduleSyncBounds);

    function scheduleSyncBounds() {
      syncBounds();
    }

    observer.observe(content);

    window.addEventListener("resize", scheduleSyncBounds);
    window.addEventListener("scroll", scheduleSyncBounds, true);

    return () => {
      disposed = true;
      observer.disconnect();

      window.removeEventListener("resize", scheduleSyncBounds);
      window.removeEventListener("scroll", scheduleSyncBounds, true);

      if (boundsFrameRef.current != null) {
        window.cancelAnimationFrame(boundsFrameRef.current);
        boundsFrameRef.current = null;
      }

      browser.hide?.();
      shownRef.current = false;
      lastBoundsRef.current = null;
    };
  }, []);

  return <div ref={contentRef} className={className ?? "min-h-0 flex-1 overflow-hidden"} />;
}

export function BrowserPanel({ onClose, sessionId = null }: BrowserPanelProps) {
  const [state, dispatch] = useBrowserState();
  const urlFocusedRef = useRef(false);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // Subscribe to state changes from the main process
  useEffect(() => {
    const browser = getElectronBrowser();

    if (!browser) {
      return;
    }

    const unsub = browser.onStateChange?.((s: BrowserStatePayload) => {
      dispatch({
        type: "browserStateChanged",
        browserState: s,
        syncUrlInput: !urlFocusedRef.current,
      });
    });

    browser.getState?.().then((s: BrowserStatePayload | null) => {
      if (s) {
        dispatch({
          type: "browserStateChanged",
          browserState: s,
          syncUrlInput: true,
        });
      }
    });

    return unsub;
  }, []);

  const sessionTabs = filterTabsForSession(state.tabs, sessionId);
  const sessionActiveTab =
    sessionTabs.find((tab) => tab.tabId === state.activeTabId || tab.isActive) ??
    sessionTabs[0] ??
    null;

  // Keep the native selected tab inside this chat session's tab set.
  useEffect(() => {
    if (!sessionId || !sessionActiveTab) return;
    if (sessionActiveTab.tabId === state.activeTabId) return;
    void getElectronBrowser()?.selectTab?.(sessionActiveTab.tabId);
  }, [sessionId, sessionActiveTab?.tabId, state.activeTabId]);

  const navigate = useCallback((url?: string) => {
    getElectronBrowser()?.navigate?.(url ?? state.urlInput);
  }, [state.urlInput]);

  const createTab = useCallback(() => {
    const sid = sessionIdRef.current;
    void getElectronBrowser()?.createTab?.(
      "about:blank",
      sid ? { sessionId: sid } : undefined,
    );
  }, []);

  const reorderTabs = useCallback((tabIds: unknown[]) => {
    const nextTabIds = tabIds.filter((tabId): tabId is string => typeof tabId === "string");
    dispatch({ type: "tabsReordered", tabIds: nextTabIds });
    getElectronBrowser()?.reorderTabs?.(nextTabIds);
  }, []);

  const back = useCallback(() => {
    getElectronBrowser()?.back?.();
  }, []);

  const forward = useCallback(() => {
    getElectronBrowser()?.forward?.();
  }, []);

  const reload = useCallback(() => {
    getElectronBrowser()?.reload?.();
  }, []);

  const handleUrlKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      navigate();
      urlInputRef.current?.blur();
    }
  }, [navigate]);

  const activeTab = sessionActiveTab ?? getActiveTab(state);
  const browser = getElectronBrowser();

  if (!isElectronRuntime() || !browser) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-dls-secondary">
        <p className="text-sm">{t("session.browser_desktop_only")}</p>
      </div>
    );
  }

  return (
    <TooltipProvider delay={1000}>
      <div className="flex h-full flex-col">
        <div
          data-panel-titlebar="true"
          className="shrink-0 border-b border-dls-border bg-dls-background mac:bg-dls-background/80 mac:titlebar-drag mac:backdrop-blur-2xl mac:backdrop-saturate-150"
        >
          <div className="flex h-10 items-center gap-1 border-b border-dls-border/60 px-2">
            <div
              data-panel-titlebar-controls="true"
              className="min-w-0 flex-1 overflow-x-auto mac:titlebar-no-drag"
            >
              <PanelTabList
                values={sessionTabs.map((tab) => tab.tabId)}
                onReorder={reorderTabs}
              >
                {sessionTabs.map((tab) => (
                  <BrowserTab
                    key={tab.tabId}
                    tab={tab}
                  />
                ))}
              </PanelTabList>
            </div>
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Button variant="ghost" size="icon-sm" onClick={createTab} aria-label={t("session.browser_new_tab")}>
                    <Plus />
                  </Button>
                )}
              />
              <TooltipContent>{t("session.browser_new_tab")}</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex h-10 items-center gap-1 px-2">
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Button variant="ghost" size="icon-sm" onClick={back} disabled={!activeTab.canGoBack} aria-label={t("session.browser_back")}>
                    <ArrowLeft />
                  </Button>
                )}
              />
              <TooltipContent>{t("session.browser_back")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Button variant="ghost" size="icon-sm" onClick={forward} disabled={!activeTab.canGoForward} aria-label={t("session.browser_forward")}>
                    <ArrowRight />
                  </Button>
                )}
              />
              <TooltipContent>{t("session.browser_forward")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Button variant="ghost" size="icon-sm" onClick={reload} aria-label={t("session.browser_reload")}>
                    {activeTab.isLoading ? <LoadingSpinner size="default" /> : <RotateCw />}
                  </Button>
                )}
              />
              <TooltipContent>{t("session.browser_reload")}</TooltipContent>
            </Tooltip>
            <InputGroup
              controlSize="xs"
              radius="md"
              className="mx-1 flex-1 mac:titlebar-no-drag"
            >
              <InputGroupInput
                ref={urlInputRef}
                type="text"
                value={state.urlInput}
                onChange={(e) =>
                  dispatch({ type: "urlInputChanged", value: e.target.value })
                }
                onKeyDown={handleUrlKeyDown}
                onFocus={() => { urlFocusedRef.current = true; urlInputRef.current?.select(); }}
                onBlur={() => { urlFocusedRef.current = false; }}
                placeholder={t("session.browser_enter_url")}
                spellCheck={false}
                autoComplete="off"
              />
              <InputGroupAddon align="inline-start" inset="compact">
                <Globe />
              </InputGroupAddon>
            </InputGroup>
            <Button variant="ghost" size="icon-sm" onClick={onClose} title={t("session.browser_close")} aria-label={t("session.browser_close_panel")}>
              <X />
            </Button>
          </div>
        </div>
        {/* WebContentsView renders in this area (managed by Electron main process) */}
        <EmbeddedBrowserViewport />
      </div>
    </TooltipProvider>
  );
}
