"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { CirclePlus, Compass, Info, LayoutGrid, ShieldAlert, TriangleAlert } from "lucide-react";

import { useNetwork } from "@/components/providers/network-provider";
import { Logo } from "@/components/ui/primitives";
import { useProgramStatus } from "@/hooks/use-ringio";
import { ENABLED_CLUSTERS, NETWORKS } from "@/lib/solana/networks";
import { NetworkSwitcher } from "./network-switcher";
import { WalletButton } from "./wallet-button";

const NAV = [
  { href: "/", label: "Discover", icon: Compass },
  { href: "/circles", label: "My circles", icon: LayoutGrid },
  { href: "/create", label: "Create", icon: CirclePlus },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NetworkBanner() {
  const { cluster, network, setCluster } = useNetwork();
  const status = useProgramStatus();
  const fallback = ENABLED_CLUSTERS.find((id) => id !== cluster && id === "devnet") ?? null;

  if (status.data?.state === "not-deployed" || status.data?.state === "not-initialized") {
    return (
      <div className="network-banner network-banner-blocked" role="status">
        <div className="page network-banner-inner">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>
            {status.data.state === "not-deployed"
              ? `Ringio is not deployed on ${network.label} yet. Reads and signing are disabled on this network.`
              : `Ringio is deployed on ${network.label} but its configuration is not initialized yet.`}{" "}
            {fallback && (
              <button className="btn btn-sm btn-secondary" type="button" onClick={() => setCluster(fallback)} style={{ marginLeft: 8 }}>
                Switch to {NETWORKS[fallback].label}
              </button>
            )}
          </span>
        </div>
      </div>
    );
  }

  if (status.error) {
    return (
      <div className="network-banner network-banner-blocked" role="status">
        <div className="page network-banner-inner">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>Could not reach the {network.label} RPC endpoint. Data shown may be incomplete — retry shortly.</span>
        </div>
      </div>
    );
  }

  if (network.realFunds) {
    return (
      <div className="network-banner network-banner-mainnet" role="note">
        <div className="page network-banner-inner">
          <ShieldAlert size={16} aria-hidden="true" />
          <span>
            You are on <strong>Mainnet</strong>: contributions use real USDC. Ringio is unaudited beta software — commit only
            what you can afford to lose.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="network-banner network-banner-test" role="note">
      <div className="page network-banner-inner">
        <Info size={16} aria-hidden="true" />
        <span>
          You are on <strong>{network.label}</strong>. Tokens here have no value
          {cluster === "devnet" ? (
            <>
              {" "}— get test USDC from the{" "}
              <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                Circle faucet
              </a>{" "}
              and SOL from the{" "}
              <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">
                Solana faucet
              </a>
              .
            </>
          ) : (
            "."
          )}
        </span>
      </div>
    </div>
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <a className="sr-only" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="page site-header-inner">
          <Link href="/" aria-label="Ringio home">
            <Logo />
          </Link>
          <nav className="primary-nav" aria-label="Primary">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <NetworkSwitcher />
            <WalletButton />
          </div>
        </div>
      </header>
      <NetworkBanner />
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div className="page site-footer-inner">
          <Logo />
          <span>Rotating savings circles on Solana. Pre-audit beta — not financial advice.</span>
          <nav className="footer-links" aria-label="Footer">
            <Link href="/#how-it-works">How it works</Link>
            <Link href="/#protection">Protection</Link>
            <a href="https://github.com/furkan3152/ringio" target="_blank" rel="noreferrer">
              Source
            </a>
            <a href="/api/agent/manifest" target="_blank" rel="noreferrer">
              Manifest
            </a>
          </nav>
        </div>
      </footer>
      <nav className="mobile-nav" aria-label="Mobile">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
            <item.icon size={20} aria-hidden="true" />
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
