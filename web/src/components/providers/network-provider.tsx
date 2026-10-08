"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import {
  DEFAULT_CLUSTER,
  ENABLED_CLUSTERS,
  NETWORKS,
  parseClusterId,
  type ClusterId,
  type NetworkConfig,
} from "@/lib/solana/networks";

const STORAGE_KEY = "ringio:cluster";
const listeners = new Set<() => void>();
let urlApplied = false;

function enabled(value: ClusterId | null): ClusterId | null {
  return value && ENABLED_CLUSTERS.includes(value) ? value : null;
}

function readStored(): ClusterId | null {
  try {
    return enabled(parseClusterId(window.localStorage.getItem(STORAGE_KEY)));
  } catch {
    return null;
  }
}

function writeStored(cluster: ClusterId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, cluster);
  } catch {
    // Storage can be unavailable; the in-memory choice still applies below.
  }
}

let memoryChoice: ClusterId | null = null;

/** A `?network=` link wins once on load so shared circle links open on the right cluster. */
function applyUrlOnce(): void {
  if (urlApplied || typeof window === "undefined") return;
  urlApplied = true;
  const fromUrl = enabled(parseClusterId(new URL(window.location.href).searchParams.get("network")));
  if (fromUrl) {
    memoryChoice = fromUrl;
    writeStored(fromUrl);
  }
}

function getSnapshot(): ClusterId {
  applyUrlOnce();
  return memoryChoice ?? readStored() ?? DEFAULT_CLUSTER;
}

function getServerSnapshot(): ClusterId {
  return DEFAULT_CLUSTER;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      memoryChoice = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

type NetworkContextValue = {
  cluster: ClusterId;
  network: NetworkConfig;
  setCluster(cluster: ClusterId): void;
};

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const cluster = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setCluster = useCallback((next: ClusterId) => {
    memoryChoice = next;
    writeStored(next);
    const url = new URL(window.location.href);
    if (url.searchParams.has("network")) {
      url.searchParams.set("network", next);
      window.history.replaceState(window.history.state, "", url);
    }
    listeners.forEach((listener) => listener());
  }, []);

  const value = useMemo(
    () => ({ cluster, network: NETWORKS[cluster], setCluster }),
    [cluster, setCluster],
  );
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
  const value = useContext(NetworkContext);
  if (!value) throw new Error("useNetwork must be used inside NetworkProvider");
  return value;
}
