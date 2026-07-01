import { useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

export function useSettingsEmbeddedRedirect(input: {
  embedded: boolean | undefined;
  redirectPath: string | null;
  setEmbeddedPath: Dispatch<SetStateAction<string>>;
}) {
  const { embedded, redirectPath, setEmbeddedPath } = input;

  useEffect(() => {
    if (!embedded || !redirectPath) return;
    setEmbeddedPath(redirectPath);
  }, [embedded, redirectPath, setEmbeddedPath]);
}

export function useSettingsPathNavigator(input: {
  embedded: boolean | undefined;
  navigatePath: (path: string) => void;
  setEmbeddedPath: Dispatch<SetStateAction<string>>;
}) {
  const { embedded, navigatePath, setEmbeddedPath } = input;

  return useCallback(
    (path: string) => {
      if (embedded) {
        setEmbeddedPath(path);
        return;
      }
      navigatePath(path);
    },
    [embedded, navigatePath, setEmbeddedPath],
  );
}
