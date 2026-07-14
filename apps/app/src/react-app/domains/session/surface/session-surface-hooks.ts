import { useQuery } from "@tanstack/react-query";

export const waitForControl = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

export function useSharedQueryState<T>(queryKey: readonly unknown[], fallback: T) {
  const query = useQuery<T, Error, T, readonly unknown[]>({
    queryKey,
    queryFn: async () => fallback,
    enabled: false,
  });
  return query.data ?? fallback;
}
