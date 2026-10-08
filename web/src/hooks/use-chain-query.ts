"use client";

import { useEffect, useRef, useState } from "react";

import { useDataVersion } from "@/components/providers/data-version";

type QueryState<T> = {
  /** Identity of the request that produced this state. */
  key: string | null;
  /** Logical key (without refresh counters) the data belongs to. */
  baseKey: string | null;
  data?: T;
  error?: unknown;
};

/** De-duplicates identical in-flight reads across components (for example program status). */
const inflight = new Map<string, Promise<unknown>>();

function shared<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = run().finally(() => {
    window.setTimeout(() => inflight.delete(key), 3_000);
  });
  inflight.set(key, promise);
  return promise;
}

export type ChainQuery<T> = {
  data: T | undefined;
  error: unknown;
  /** True until the first response for this key arrives. */
  loading: boolean;
  /** True while any refetch for this key is in flight. */
  refreshing: boolean;
  refresh(): void;
};

/**
 * Minimal async query hook for RPC reads. Keeps the last good value while a
 * refetch for the same key is in flight and refetches whenever a transaction
 * bumps the shared data version.
 */
export function useChainQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: { pollMs?: number } = {},
): ChainQuery<T> {
  const { version } = useDataVersion();
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<QueryState<T>>({ key: null, baseKey: null });
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const requestKey = key ? `${key}#${version}#${nonce}` : null;
  const sharedKey = key ? `${key}#${version}` : null;

  useEffect(() => {
    if (!requestKey || !key) return;
    let cancelled = false;
    const request = nonce === 0 && sharedKey ? shared(sharedKey, () => fetcherRef.current()) : fetcherRef.current();
    request.then(
      (data) => {
        if (!cancelled) setState({ key: requestKey, baseKey: key, data });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState((previous) => ({
            key: requestKey,
            baseKey: key,
            data: previous.baseKey === key ? previous.data : undefined,
            error,
          }));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [requestKey, key, sharedKey, nonce]);

  useEffect(() => {
    if (!options.pollMs || !key) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setNonce((value) => value + 1);
    }, options.pollMs);
    return () => window.clearInterval(id);
  }, [options.pollMs, key]);

  const sameKey = state.baseKey === key && key !== null;
  return {
    data: sameKey ? state.data : undefined,
    error: sameKey && state.key === requestKey ? state.error : undefined,
    loading: key !== null && !sameKey,
    refreshing: key !== null && state.key !== requestKey,
    refresh: () => setNonce((value) => value + 1),
  };
}
