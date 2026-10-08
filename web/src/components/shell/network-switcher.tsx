"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { useNetwork } from "@/components/providers/network-provider";
import { ENABLED_CLUSTERS, NETWORKS } from "@/lib/solana/networks";

export function NetworkSwitcher() {
  const { cluster, network, setCluster } = useNetwork();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (ENABLED_CLUSTERS.length < 2) {
    return (
      <span className="menu-trigger" aria-label={`Network: ${network.label}`}>
        <span className={`net-dot net-dot-${cluster}`} aria-hidden="true" />
        <span className="menu-label">{network.label}</span>
      </span>
    );
  }

  return (
    <div className="menu" ref={ref}>
      <button
        className="menu-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Network: ${network.label}. Change network`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`net-dot net-dot-${cluster}`} aria-hidden="true" />
        <span className="menu-label">{network.label}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="menu-popover" role="menu" aria-label="Solana network">
          {ENABLED_CLUSTERS.map((id) => {
            const option = NETWORKS[id];
            return (
              <button
                key={id}
                className="menu-item"
                type="button"
                role="menuitemradio"
                aria-checked={id === cluster}
                onClick={() => {
                  setCluster(id);
                  setOpen(false);
                }}
              >
                <span className={`net-dot net-dot-${id}`} aria-hidden="true" />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                {id === cluster && <Check className="check" size={16} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
