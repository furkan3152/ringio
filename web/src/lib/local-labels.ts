"use client";

import { useSyncExternalStore } from "react";

/**
 * Circle names are not stored on-chain. Creators can keep a private nickname
 * in this browser; everyone else sees the public circle code.
 */

const PREFIX = "ringio:label:v1:";
const listeners = new Set<() => void>();

function key(cluster: string, address: string): string {
  return `${PREFIX}${cluster}:${address}`;
}

export function getCircleLabel(cluster: string, address: string): string | null {
  try {
    return window.localStorage.getItem(key(cluster, address));
  } catch {
    return null;
  }
}

export function setCircleLabel(cluster: string, address: string, label: string): void {
  try {
    const trimmed = label.trim().slice(0, 48);
    if (trimmed) window.localStorage.setItem(key(cluster, address), trimmed);
    else window.localStorage.removeItem(key(cluster, address));
  } catch {
    // Labels are a convenience only.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCircleLabel(cluster: string, address: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => getCircleLabel(cluster, address),
    () => null,
  );
}
