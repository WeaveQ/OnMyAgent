import { describe, expect, test } from "bun:test";
import { setLocale, t } from "../src/i18n";
import {
  resolveExpertDeleteCopy,
  summarizeExpertDeleteProgress,
  type ExpertDeleteProgress,
} from "../src/react-app/domains/session/pages/use-expert-session-delete";

const target = {
  kind: "expert" as const,
  agentId: "agent-1",
  name: "",
  sessionIds: ["session-1"],
  deletePackage: true,
  operationId: "operation-1",
};

const failedProgress: ExpertDeleteProgress = {
  status: "failed",
  operationId: "operation-1",
  server: {
    operationId: "operation-1",
    workspaceId: "workspace-1",
    agentId: "agent-1",
    packageName: "package-1",
    revision: 2,
    state: "partial",
    steps: [{
      sessionId: "session-1",
      openCode: "completed",
      runtime: "failed",
      tombstone: "pending",
      code: "runtime_delete_failed",
    }],
  },
  desktop: {
    ok: true,
    operationId: "operation-1",
    packageName: "package-1",
    state: "partial",
    steps: [
      { target: "my-experts", state: "completed" },
      { target: "experts", state: "skipped", code: "builtin_protected" },
      { target: "registry", state: "failed", code: "registry_delete_failed" },
      { target: "skills", state: "pending" },
    ],
    removedSkills: [],
  },
};

describe("Expert delete retry copy", () => {
  test("session-only expert delete explicitly keeps the package", () => {
    setLocale("zh");
    const copy = resolveExpertDeleteCopy({
      deleteTarget: { ...target, name: "翻译专家", deletePackage: false },
      sessionActionTitle: "",
      deleteBusy: false,
    });
    expect(copy.message).toContain("专家包会保留");
    expect(copy.message).not.toContain("本机安装的专家包，且不可恢复");
  });

  test("summarizes real failed and pending step codes without paths", () => {
    const summary = summarizeExpertDeleteProgress(failedProgress);
    expect(summary).toContain("server:session-1:runtime:runtime_delete_failed");
    expect(summary).toContain("server:session-1:tombstone:runtime_delete_failed");
    expect(summary).toContain("desktop:registry:registry_delete_failed");
    expect(summary).toContain("desktop:skills:pending");
    expect(summary).not.toContain("/");
  });

  test("uses translated retry copy in all supported locales and reuses operation id", () => {
    for (const locale of ["en", "zh", "zh-TW"] as const) {
      setLocale(locale);
      const copy = resolveExpertDeleteCopy({
        deleteTarget: target,
        sessionActionTitle: "",
        deleteBusy: false,
        deleteProgress: failedProgress,
      });
      expect(copy.confirmLabel).not.toBe("session.delete");
      expect(copy.message).toContain("runtime_delete_failed");
      expect(copy.message).toContain("registry_delete_failed");
    }
    const changedOperation = resolveExpertDeleteCopy({
      deleteTarget: { ...target, operationId: "other-operation" },
      sessionActionTitle: "",
      deleteBusy: false,
      deleteProgress: failedProgress,
    });
    expect(changedOperation.confirmLabel).toBe(t("session.delete"));
  });
});
