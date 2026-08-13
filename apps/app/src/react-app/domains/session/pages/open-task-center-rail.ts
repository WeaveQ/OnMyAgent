/** Open the assistant-owned Task Center from any shell host. */
import { workspaceAssistantRoute } from "../../../shell";
import { buildPathWithRailView } from "../navigation/app-location";
import { writeRailView } from "../sidebar/rail-navigation-memory";

export function openTaskCenterRailPath(workspaceId: string): string | null {
  const id = workspaceId.trim();
  if (!id) return null;
  writeRailView("assistant", id, "taskCenter");
  return buildPathWithRailView({
    mode: "assistant",
    pathname: workspaceAssistantRoute(id),
    search: "",
    view: "taskCenter",
  });
}
