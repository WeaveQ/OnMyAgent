import { QueryClient } from "@tanstack/react-query";

type QueryClientGlobal = typeof globalThis & {
  __owReactQueryClient?: QueryClient;
};

export function getReactQueryClient(): QueryClient {
  const target = globalThis as QueryClientGlobal;
  if (target.__owReactQueryClient) return target.__owReactQueryClient;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Prefer cache for non-hot paths; session stream still writes via setQueryData.
        staleTime: 5_000,
        gcTime: 60_000,
        refetchOnWindowFocus: false,
      },
    },
  });

  // Hot session caches: shorter GC so switching sessions does not pin memory,
  // but keep a small stale window so tab focus does not thrash.
  for (const queryKey of [
    ["react-session-transcript"],
    ["react-session-status"],
    ["react-session-todos"],
    ["react-session-permissions"],
  ] as const) {
    queryClient.setQueryDefaults(queryKey, {
      staleTime: 2_000,
      gcTime: 15_000,
      refetchOnWindowFocus: false,
    });
  }

  // Conversation history / catalog-style keys: longer stale, focus refresh ok.
  queryClient.setQueryDefaults(["conversation-history-snapshot"], {
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  target.__owReactQueryClient = queryClient;
  return target.__owReactQueryClient;
}
