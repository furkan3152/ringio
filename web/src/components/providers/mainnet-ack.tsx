"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";

import { Dialog } from "@/components/ui/dialog";

/**
 * Before the first real-value signature, the user must confirm that Ringio is
 * unaudited beta software. The acknowledgement is remembered per browser.
 */

const STORAGE_KEY = "ringio:mainnet-ack:v1";

type AckApi = { request(): Promise<boolean> };
const AckContext = createContext<AckApi | null>(null);

function alreadyAcknowledged(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "yes";
  } catch {
    return false;
  }
}

export function MainnetAckProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    if (value) {
      try {
        window.localStorage.setItem(STORAGE_KEY, "yes");
      } catch {
        // Ask again next time if storage is unavailable.
      }
    }
    resolver.current?.(value);
    resolver.current = null;
    setOpen(false);
    setChecked(false);
  }, []);

  const request = useCallback(() => {
    if (alreadyAcknowledged()) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOpen(true);
    });
  }, []);

  const api = useMemo(() => ({ request }), [request]);

  return (
    <AckContext.Provider value={api}>
      {children}
      <Dialog open={open} onClose={() => settle(false)} label="Mainnet risk acknowledgement">
        <div className="dialog-body">
          <span className="badge badge-warning">
            <ShieldAlert size={13} aria-hidden="true" /> Mainnet · real funds
          </span>
          <h2>Before you sign with real USDC</h2>
          <p>
            Ringio is pre-audit beta software. Contributions and protection move real USDC into program-controlled
            vaults, and transactions cannot be reversed. Protection only covers missed payments by members who were
            already paid out — it does not remove smart-contract, stablecoin, or wallet risk.
          </p>
          <label className="check-row">
            <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
            <span>I understand the risks and only commit amounts I can afford to lose.</span>
          </label>
          <div className="dialog-actions">
            <button className="btn btn-ghost" type="button" onClick={() => settle(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" type="button" disabled={!checked} onClick={() => settle(true)}>
              Continue to wallet
            </button>
          </div>
        </div>
      </Dialog>
    </AckContext.Provider>
  );
}

export function useMainnetAck(): AckApi {
  const value = useContext(AckContext);
  if (!value) throw new Error("useMainnetAck must be used inside MainnetAckProvider");
  return value;
}
