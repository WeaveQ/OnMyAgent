/** @jsxImportSource react */
import { Component, type ErrorInfo, type ReactNode } from "react";

import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";

type Props = {
  children: ReactNode;
  /** Mode label for logs only (assistant | expert). */
  mode: string;
};

type State = {
  error: Error | null;
};

/**
 * Catches render/lifecycle throws inside Session pages so a single bad
 * expert/assistant surface cannot unmount the whole app (full white window).
 */
export class SessionPageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[session-page] ${this.props.mode} surface crashed`,
      error,
      info.componentStack,
    );
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error.message?.trim() || String(this.state.error);
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-dls-background px-6 py-16 text-dls-text">
        <NoticeBox className="mx-auto max-w-lg text-left" size="comfortable" tone="error">
          <div className="font-medium">
            {t("session.surface_crash_title")}
          </div>
          <p className="mt-2 whitespace-pre-wrap wrap-anywhere leading-6 text-dls-secondary">
            {t("session.surface_crash_body")}
          </p>
          {import.meta.env.DEV ? (
            <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-dls-hover px-3 py-2 text-xs text-dls-secondary">
              {message}
            </pre>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={this.handleRetry}>
              {t("session.surface_crash_retry")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={this.handleReload}>
              {t("session.surface_crash_reload")}
            </Button>
          </div>
        </NoticeBox>
      </div>
    );
  }
}
