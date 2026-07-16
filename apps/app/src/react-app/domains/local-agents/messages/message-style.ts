export const localAgentTextClass = {
  debugMeta: "font-mono text-xs text-dls-secondary",
  approvalTitle: "text-xs font-medium",
  artifactTitle: "mb-2 flex items-center gap-1.5 text-xs font-medium text-dls-status-success-fg",
};

export const localAgentLayoutClass = {
  userChatMessage: "max-w-[86%] rounded-2xl bg-dls-chat-user-bg px-4 py-3 text-sm leading-6 text-dls-text",
  assistantChatMessage: "min-w-0 flex-1",
  artifactPanel: "rounded-xl border border-dls-border bg-dls-surface-muted px-3 py-2",
  artifactButton: "min-w-0 max-w-[260px] justify-start rounded-none text-dls-status-success-fg hover:bg-dls-status-success-soft",
  artifactIconButton: "shrink-0 rounded-none text-dls-status-success-fg hover:bg-dls-status-success-soft",
};

export const approvalClass = {
  panel: "space-y-2 rounded-xl border border-dls-status-warning/25 bg-dls-status-warning/12 px-3 py-2 text-dls-status-warning",
  item: "rounded-lg border border-dls-status-warning/25 bg-dls-surface/75 p-2",
  meta: "mt-0.5 text-xs leading-4 text-dls-status-warning/80",
  command: "mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-dls-status-warning/12 px-2 py-1 font-mono text-xs text-dls-status-warning",
  cwd: "mt-1 truncate font-mono text-xs text-dls-status-warning/80",
};
