"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ExternalLink, LogOut, RefreshCw, Wallet } from "lucide-react";

import { useNetwork } from "@/components/providers/network-provider";
import { Address, shortAddress, TokenAmount } from "@/components/ui/primitives";
import { useWalletBalances } from "@/hooks/use-ringio";
import { explorerUrl } from "@/lib/solana/networks";

export function WalletButton({ size = "md" }: { size?: "md" | "lg" }) {
  const { publicKey, wallet, connecting, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const { cluster, network } = useNetwork();
  const balances = useWalletBalances(network.asset?.mint ?? null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [open]);

  if (!publicKey) {
    return (
      <button
        className={`btn btn-primary${size === "lg" ? " btn-lg" : ""}`}
        type="button"
        onClick={() => setVisible(true)}
        disabled={connecting}
      >
        <Wallet size={16} aria-hidden="true" />
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  const address = publicKey.toBase58();
  return (
    <div className="menu" ref={ref}>
      <button
        className="wallet-chip"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {wallet?.adapter.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={wallet.adapter.icon} alt="" />
        ) : (
          <span className="wallet-avatar" aria-hidden="true" />
        )}
        <span className="wallet-label mono">{shortAddress(address)}</span>
      </button>
      {open && (
        <div className="menu-popover" role="dialog" aria-label="Wallet">
          <div className="wallet-summary">
            <span className="eyebrow eyebrow-muted">{wallet?.adapter.name ?? "Wallet"} · {network.label}</span>
            <div style={{ marginTop: 8 }}>
              <Address value={address} size={6} />
            </div>
            <dl>
              <div>
                <dt>SOL (fees)</dt>
                <dd className="amount">{balances.data ? balances.data.sol.toFixed(4) : "…"}</dd>
              </div>
              {network.asset && (
                <div>
                  <dt>{network.asset.symbol}</dt>
                  <dd>
                    {balances.data?.token != null ? (
                      <TokenAmount raw={balances.data.token} decimals={balances.data.decimals} />
                    ) : (
                      "…"
                    )}
                  </dd>
                </div>
              )}
            </dl>
          </div>
          <div className="menu-divider" />
          <button className="menu-item" type="button" onClick={() => balances.refresh()}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>
              <strong>Refresh balances</strong>
            </span>
          </button>
          <a className="menu-item" href={explorerUrl(cluster, "address", address)} target="_blank" rel="noreferrer">
            <ExternalLink size={16} aria-hidden="true" />
            <span>
              <strong>View on explorer</strong>
            </span>
          </a>
          <button
            className="menu-item"
            type="button"
            onClick={() => {
              setOpen(false);
              void disconnect();
            }}
          >
            <LogOut size={16} aria-hidden="true" />
            <span>
              <strong>Disconnect</strong>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
