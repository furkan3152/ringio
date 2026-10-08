"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { useNetwork } from "@/components/providers/network-provider";
import { formatTokenAmount } from "@/lib/ringio/amounts";
import { explorerUrl } from "@/lib/solana/networks";

export function Logo({ withWord = true }: { withWord?: boolean }) {
  return (
    <span className="brand">
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="ringio-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffd97a" />
            <stop offset="1" stopColor="#c8952a" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="11" fill="none" stroke="rgba(148,163,184,0.28)" strokeWidth="3.5" />
        <path d="M16 5a11 11 0 0 1 10.6 8" fill="none" stroke="url(#ringio-gold)" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="26.6" cy="13" r="2.6" fill="#ffd97a" />
      </svg>
      {withWord && <span>Ringio</span>}
    </span>
  );
}

export function shortAddress(value: string, size = 4): string {
  return value.length <= size * 2 + 1 ? value : `${value.slice(0, size)}…${value.slice(-size)}`;
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_400);
        } catch {
          // Clipboard can be blocked; the value is still visible on hover.
        }
      }}
    >
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
    </button>
  );
}

export function Address({ value, size = 4, explorer = true }: { value: string; size?: number; explorer?: boolean }) {
  const { cluster } = useNetwork();
  return (
    <span className="address">
      <span className="mono" title={value}>
        {shortAddress(value, size)}
      </span>
      <span className="address-actions">
        <CopyButton value={value} label="Copy address" />
        {explorer && (
          <a href={explorerUrl(cluster, "address", value)} target="_blank" rel="noreferrer" aria-label="Open in Solana Explorer">
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
      </span>
    </span>
  );
}

export function TokenAmount({
  raw,
  decimals,
  symbol,
  className,
}: {
  raw: bigint;
  decimals: number;
  symbol?: string;
  className?: string;
}) {
  return (
    <span className={className}>
      <span className="amount">{formatTokenAmount(raw, decimals)}</span>
      {symbol && <span className="subtle"> {symbol}</span>}
    </span>
  );
}

const AVATAR_COLORS = ["#f2c14e", "#7aa7ff", "#3ddc97", "#ff9b6b", "#c49bff", "#5ad1e6", "#ff7aa8", "#b5e36b"];

export function Avatar({ seed, label }: { seed: string; label: string }) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (
    <span className="avatar" style={{ background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }} aria-hidden="true">
      {label}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card empty">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function formatDate(unix: number): string {
  if (!unix) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(unix * 1_000));
}
