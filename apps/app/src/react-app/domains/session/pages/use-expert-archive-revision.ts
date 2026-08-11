import { useEffect, useState } from "react";
import { assistantArchivedTasksChangedEvent } from "../../shared";

export function useExpertArchiveRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const onArchived = () => setRevision((value) => value + 1);
    window.addEventListener(assistantArchivedTasksChangedEvent, onArchived);
    return () =>
      window.removeEventListener(assistantArchivedTasksChangedEvent, onArchived);
  }, []);
  return revision;
}
