"use client";

import { useSyncExternalStore } from "react";

/** A shared one-second clock (unix seconds) that keeps renders pure. */
const listeners = new Set<() => void>();
let current = 0;
let timer: number | null = null;

function tick() {
  current = Math.floor(Date.now() / 1_000);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === null) {
    current = Math.floor(Date.now() / 1_000);
    timer = window.setInterval(tick, 1_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot() {
  if (current === 0) current = Math.floor(Date.now() / 1_000);
  return current;
}

function getServerSnapshot() {
  return 0;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
