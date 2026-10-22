"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, ExternalLink, LoaderCircle, TriangleAlert, X } from "lucide-react";

export type ToastTone = "pending" | "success" | "error";

export type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
  href?: string;
  hrefLabel?: string;
};

type ToastApi = {
  push(toast: Omit<Toast, "id">): number;
  update(id: number, patch: Partial<Omit<Toast, "id">>): void;
  dismiss(id: number): void;
};

const ToastContext = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const scheduleDismiss = useCallback(
    (id: number, tone: ToastTone) => {
      if (tone === "pending") return;
      window.setTimeout(() => dismiss(id), tone === "error" ? 12_000 : 8_000);
    },
    [dismiss],
  );

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = nextId++;
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      scheduleDismiss(id, toast.tone);
      return id;
    },
    [scheduleDismiss],
  );

  const update = useCallback(
    (id: number, patch: Partial<Omit<Toast, "id">>) => {
      setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, ...patch } : toast)));
      if (patch.tone) scheduleDismiss(id, patch.tone);
    },
    [scheduleDismiss],
  );

  const api = useMemo(() => ({ push, update, dismiss }), [push, update, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
            {toast.tone === "pending" ? (
              <LoaderCircle className="toast-icon spin" size={20} aria-hidden="true" />
            ) : toast.tone === "success" ? (
              <CheckCircle2 className="toast-icon" size={20} aria-hidden="true" />
            ) : (
              <TriangleAlert className="toast-icon" size={20} aria-hidden="true" />
            )}
            <div>
              <strong>{toast.title}</strong>
              {toast.message && <p>{toast.message}</p>}
              {toast.href && (
                <a href={toast.href} target="_blank" rel="noreferrer">
                  {toast.hrefLabel ?? "View on explorer"} <ExternalLink size={13} aria-hidden="true" />
                </a>
              )}
            </div>
            <button className="toast-close" type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}
