"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { Mail, Plus, RefreshCw, TriangleAlert, Users, Wallet } from "lucide-react";

import { useNetwork } from "@/components/providers/network-provider";
import { WalletButton } from "@/components/shell/wallet-button";
import { EmptyState, TokenAmount } from "@/components/ui/primitives";
import { useNow } from "@/hooks/use-now";
import { useProgramStatus, useWalletCircles } from "@/hooks/use-ringio";
import { formatTokenAmount } from "@/lib/ringio/amounts";
import type { CircleSnapshot } from "@/lib/ringio/fetch";
import { planActions, type ActionId } from "@/lib/ringio/lifecycle";
import { assetSymbol } from "@/lib/ringio/view";
import { CircleCard, CircleCardSkeleton } from "./circle-card";

const CALLOUTS: Partial<Record<ActionId, string>> = {
  invite: "Invite members",
  join: "Invitation waiting",
  reveal: "Reveal your secret",
  finalize: "Ready to draw order",
  "post-collateral": "Post protection",
  activate: "Ready to start",
  contribute: "Contribution due",
  settle: "Ready to pay out",
  "cover-default": "Missed payment",
  "abort-round": "Missed payment",
  "refund-failed-round": "Refunds available",
  "refund-collateral": "Withdraw protection",
};

export function MyCircles() {
  const { publicKey } = useWallet();
  const { network } = useNetwork();
  const status = useProgramStatus();
  const query = useWalletCircles();
  const now = useNow();
  const wallet = publicKey?.toBase58() ?? null;

  if (!wallet) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <span className="eyebrow">My circles</span>
            <h1>Your savings circles</h1>
          </div>
        </div>
        <EmptyState icon={<Wallet size={24} aria-hidden="true" />} title="Connect your wallet" action={<WalletButton size="lg" />}>
          Ringio reads your circles, invitations, and what is due directly from {network.label}. Nothing is stored on a server.
        </EmptyState>
      </div>
    );
  }

  const circles = query.data?.circles ?? [];
  const inviteGroups = new Set((query.data?.pendingInvites ?? []).map((invite) => invite.group));
  const invited = circles.filter(
    (snapshot) =>
      snapshot.group.status === "forming" &&
      inviteGroups.has(snapshot.group.address) &&
      !snapshot.members.some((member) => member.wallet === wallet),
  );
  const mine = circles.filter((snapshot) => snapshot.members.some((member) => member.wallet === wallet));

  const planFor = (snapshot: CircleSnapshot) =>
    status.config
      ? planActions({
          group: snapshot.group,
          members: snapshot.members,
          config: status.config,
          wallet,
          invite: query.data?.pendingInvites.find((invite) => invite.group === snapshot.group.address) ?? null,
          now: now || snapshot.group.createdAt,
        })
      : null;

  const active = mine.filter((snapshot) => snapshot.group.status === "active");
  const dueByMint = new Map<string, { raw: bigint; decimals: number; mint: string }>();
  let lockedRaw = BigInt(0);
  let lockedDecimals = 6;
  for (const snapshot of mine) {
    const me = snapshot.members.find((member) => member.wallet === wallet);
    if (!me) continue;
    if (snapshot.group.status === "active" && me.lastContributedRound !== snapshot.group.currentRound) {
      const entry = dueByMint.get(snapshot.group.mint) ?? { raw: BigInt(0), decimals: snapshot.decimals, mint: snapshot.group.mint };
      entry.raw += snapshot.group.contributionAmount;
      dueByMint.set(snapshot.group.mint, entry);
    }
    if (snapshot.group.mint === network.asset?.mint) {
      lockedRaw += me.collateralLocked;
      lockedDecimals = snapshot.decimals;
    }
  }
  const due = network.asset ? dueByMint.get(network.asset.mint) : undefined;
  const received = mine.filter((snapshot) => snapshot.members.find((member) => member.wallet === wallet)?.payoutReceived).length;
  const symbol = network.asset?.symbol ?? "tokens";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">My circles · {network.label}</span>
          <h1>Your savings circles</h1>
          <p>Everything here is read live from the chain for the connected wallet.</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-secondary" type="button" onClick={() => query.refresh()} disabled={query.refreshing || !status.ready}>
            <RefreshCw size={15} className={query.refreshing && !query.loading ? "spin" : undefined} aria-hidden="true" /> Refresh
          </button>
          <Link className="btn btn-primary" href="/create">
            <Plus size={16} aria-hidden="true" /> New circle
          </Link>
        </div>
      </div>

      {status.data && status.data.state !== "ready" ? (
        <EmptyState icon={<TriangleAlert size={24} aria-hidden="true" />} title={`Ringio is not live on ${network.label}`}>
          Switch to a network where the program is deployed to see your circles.
        </EmptyState>
      ) : (
        <>
          <div className="stat-grid" aria-label="Summary">
            <div className="card stat">
              <span>Active circles</span>
              <strong>{query.loading ? "…" : active.length}</strong>
              <small>{mine.length} total</small>
            </div>
            <div className="card stat">
              <span>Due this turn</span>
              <strong className="amount">{query.loading ? "…" : due ? formatTokenAmount(due.raw, due.decimals) : "0.00"}</strong>
              <small>{symbol} across active circles</small>
            </div>
            <div className="card stat">
              <span>Protection locked</span>
              <strong className="amount">
                {query.loading ? "…" : <TokenAmount raw={lockedRaw} decimals={lockedDecimals} />}
              </strong>
              <small>{symbol} in program vaults</small>
            </div>
            <div className="card stat">
              <span>Payouts received</span>
              <strong>{query.loading ? "…" : received}</strong>
              <small>turns paid to you</small>
            </div>
          </div>

          {invited.length > 0 && (
            <section className="section" style={{ marginTop: 40 }} aria-labelledby="invites-title">
              <div className="section-head" style={{ marginBottom: 16 }}>
                <div>
                  <span className="eyebrow">
                    <Mail size={14} aria-hidden="true" /> Invitations
                  </span>
                  <h2 id="invites-title" style={{ fontSize: 24 }}>
                    You&apos;ve been invited
                  </h2>
                </div>
              </div>
              <div className="circle-grid">
                {invited.map((snapshot) => (
                  <CircleCard key={snapshot.group.address} snapshot={snapshot} callout="Review & accept" />
                ))}
              </div>
            </section>
          )}

          <section className="section" style={{ marginTop: 40 }} aria-labelledby="mine-title">
            <div className="section-head" style={{ marginBottom: 16 }}>
              <div>
                <span className="eyebrow eyebrow-muted">Circles</span>
                <h2 id="mine-title" style={{ fontSize: 24 }}>
                  Your circles
                </h2>
              </div>
            </div>
            {query.loading || status.loading ? (
              <div className="circle-grid">
                <CircleCardSkeleton />
                <CircleCardSkeleton />
                <CircleCardSkeleton />
              </div>
            ) : query.error && !query.data ? (
              <EmptyState
                icon={<TriangleAlert size={24} aria-hidden="true" />}
                title="Couldn't load your circles"
                action={
                  <button className="btn btn-secondary" type="button" onClick={() => query.refresh()}>
                    Try again
                  </button>
                }
              >
                The {network.label} RPC endpoint did not respond. Nothing is shown rather than guessed.
              </EmptyState>
            ) : mine.length === 0 ? (
              <EmptyState
                icon={<Users size={24} aria-hidden="true" />}
                title="No circles yet"
                action={
                  <Link className="btn btn-primary" href="/create">
                    <Plus size={16} aria-hidden="true" /> Start a circle
                  </Link>
                }
              >
                Start a circle and invite the people you already save with, or share your wallet address with an organizer.
              </EmptyState>
            ) : (
              <div className="circle-grid">
                {mine.map((snapshot) => {
                  const plan = planFor(snapshot);
                  const action = plan?.primary && plan.primary.enabled && plan.primary.audience !== "anyone" ? plan.primary : null;
                  const crank = plan?.primary?.audience === "anyone" && plan.primary.enabled ? plan.primary : null;
                  const callout = action ? CALLOUTS[action.id] : crank ? CALLOUTS[crank.id] : null;
                  const symbolFor = assetSymbol(snapshot.group.mint, network);
                  return (
                    <CircleCard
                      key={snapshot.group.address}
                      snapshot={snapshot}
                      callout={
                        callout && action?.id === "contribute" && action.amount
                          ? `${callout}: ${formatTokenAmount(action.amount, snapshot.decimals)} ${symbolFor}`
                          : callout
                      }
                      calloutTone={action ? "gold" : "info"}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
