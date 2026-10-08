"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { CalendarClock, Check, CheckCircle2, ExternalLink, Link2, PartyPopper, RefreshCw, SearchX, TriangleAlert } from "lucide-react";

import { useNetwork } from "@/components/providers/network-provider";
import { Address, Avatar, EmptyState, formatDate, formatDuration, shortAddress, TokenAmount } from "@/components/ui/primitives";
import { RingDial } from "@/components/ui/ring-dial";
import { useNow } from "@/hooks/use-now";
import { useCircle, useProgramStatus } from "@/hooks/use-ringio";
import { useCircleLabel } from "@/lib/local-labels";
import { formatTokenAmount } from "@/lib/ringio/amounts";
import type { CircleSnapshot } from "@/lib/ringio/fetch";
import { circleDeadlines, planActions, roundPayout } from "@/lib/ringio/lifecycle";
import { UNSET_ROUND } from "@/lib/ringio/constants";
import {
  assetSymbol,
  cadenceText,
  circleCode,
  circleTitle,
  isCanonicalAsset,
  nextDeadline,
  payoutProgress,
  periodText,
  ringNodes,
  STATUS_META,
  statusBadgeClass,
} from "@/lib/ringio/view";
import { explorerUrl } from "@/lib/solana/networks";
import { ActionPanel } from "./action-panel";

const STAGES = [
  { key: "forming", label: "Invite", hint: "Members join" },
  { key: "revealing", label: "Draw", hint: "Fair order" },
  { key: "collateralizing", label: "Protect", hint: "Lock collateral" },
  { key: "active", label: "Turns", hint: "Contribute & pay out" },
  { key: "completed", label: "Done", hint: "All paid" },
] as const;

function Stepper({ snapshot }: { snapshot: CircleSnapshot }) {
  const status = snapshot.group.status;
  const terminalFailure = status === "cancelled" || status === "defaulted";
  const reached = (() => {
    if (status === "completed") return 5;
    if (terminalFailure) {
      if (snapshot.group.payoutOrder.length === 0) return snapshot.group.joinedCount === snapshot.group.memberCount ? 1 : 0;
      return status === "defaulted" ? 3 : snapshot.group.collateralizedCount === snapshot.group.memberCount ? 3 : 2;
    }
    return STAGES.findIndex((stage) => stage.key === status);
  })();
  return (
    <div className="card stepper" aria-label="Circle stage">
      {STAGES.map((stage, index) => {
        const state =
          index < reached ? "done" : index === reached ? (terminalFailure ? "failed" : status === "completed" ? "done" : "current") : "";
        return (
          <div key={stage.key} className={`stepper-item ${state}`} aria-current={state === "current" ? "step" : undefined}>
            <strong>{stage.label}</strong>
            <small>{stage.hint}</small>
          </div>
        );
      })}
    </div>
  );
}

function CopyInviteLink({ address }: { address: string }) {
  const { cluster } = useNetwork();
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-secondary"
      type="button"
      onClick={async () => {
        const url = `${window.location.origin}/circles/${address}?network=${cluster}`;
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_600);
        } catch {
          window.prompt("Copy this link", url);
        }
      }}
    >
      {copied ? <Check size={15} aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}
      {copied ? "Link copied" : "Copy circle link"}
    </button>
  );
}

function MembersTable({ snapshot, wallet, graceOver }: { snapshot: CircleSnapshot; wallet: string | null; graceOver: boolean }) {
  const { network } = useNetwork();
  const { group, members, invites, decimals } = snapshot;
  const symbol = assetSymbol(group.mint, network);
  const pending = invites.filter((invite) => !invite.used);
  const ordered = [...members].sort((left, right) =>
    group.payoutOrder.length > 0 ? left.payoutRank - right.payoutRank : left.joinedIndex - right.joinedIndex,
  );

  return (
    <section className="card" aria-labelledby="members-title">
      <div className="card-header">
        <div>
          <h3 id="members-title">Members</h3>
          <p>
            {group.joinedCount} of {group.memberCount} seats filled
            {pending.length > 0 && ` · ${pending.length} invitation${pending.length === 1 ? "" : "s"} pending`}
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Member</th>
              <th scope="col">Payout turn</th>
              <th scope="col">{group.status === "active" ? "This turn" : "Setup"}</th>
              <th scope="col" className="num">
                Protection locked
              </th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((member) => {
              const you = member.wallet === wallet;
              const rank = member.payoutRank === UNSET_ROUND ? group.payoutOrder.indexOf(member.wallet) : member.payoutRank;
              const setupState =
                group.status === "forming"
                  ? "Joined"
                  : group.status === "revealing"
                    ? member.revealed
                      ? "Revealed"
                      : "Must reveal"
                    : member.collateralPosted
                      ? "Protection posted"
                      : group.status === "collateralizing"
                        ? "Must post protection"
                        : "—";
              const turnState =
                group.status === "active"
                  ? member.lastContributedRound === group.currentRound
                    ? member.lastResolutionKind === 2
                      ? "Covered"
                      : "Paid"
                    : graceOver
                      ? "Missed"
                      : "Due"
                  : setupState;
              return (
                <tr key={member.wallet} className={you ? "is-you" : undefined}>
                  <td>
                    <div className="who">
                      <Avatar seed={member.wallet} label={String(member.joinedIndex + 1)} />
                      <div>
                        <Address value={member.wallet} />
                        <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                          {you && <span className="badge badge-gold">You</span>}
                          {member.wallet === group.creator && <span className="badge">Organizer</span>}
                          {member.defaults > 0 && <span className="badge badge-danger">{member.defaults} missed</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {rank >= 0 ? (
                      <span>
                        Turn {rank + 1}
                        {member.payoutReceived && (
                          <span className="badge badge-success" style={{ marginLeft: 8 }}>
                            <CheckCircle2 size={12} aria-hidden="true" /> Paid out
                          </span>
                        )}
                        {!member.payoutReceived && group.status === "active" && rank === group.currentRound && (
                          <span className="badge badge-gold" style={{ marginLeft: 8 }}>
                            Receiving
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="subtle">After the draw</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${turnState === "Paid" || turnState === "Revealed" || turnState === "Protection posted" || turnState === "Joined" ? "badge-success" : turnState === "Due" || turnState.startsWith("Must") ? "badge-warning" : turnState === "Covered" ? "badge-info" : turnState === "Missed" ? "badge-danger" : ""}`}
                    >
                      {turnState}
                    </span>
                  </td>
                  <td className="num">
                    <TokenAmount raw={member.collateralLocked} decimals={decimals} symbol={symbol} />
                  </td>
                </tr>
              );
            })}
            {group.status === "forming" &&
              pending.map((invite) => (
                <tr key={invite.invitee}>
                  <td>
                    <div className="who">
                      <Avatar seed={invite.invitee} label="…" />
                      <div>
                        <Address value={invite.invitee} />
                        <div style={{ marginTop: 3 }}>
                          <span className="badge badge-info">Invited</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="subtle">—</td>
                  <td>
                    <span className="badge">Not joined yet</span>
                  </td>
                  <td className="num subtle">—</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function VaultsCard({
  snapshot,
  onRefresh,
  refreshing,
  className,
}: {
  snapshot: CircleSnapshot;
  onRefresh(): void;
  refreshing: boolean;
  className: string;
}) {
  const { network } = useNetwork();
  const { group, decimals } = snapshot;
  const symbol = assetSymbol(group.mint, network);
  return (
    <section className={`card ${className}`} aria-labelledby={`vaults-title-${className}`}>
      <div className="card-header">
        <div>
          <h3 id={`vaults-title-${className}`}>Vaults</h3>
          <p>Program-owned token accounts. No one holds the keys.</p>
        </div>
      </div>
      <div className="card-body">
        <dl className="kv">
          <div>
            <dt>Pot vault</dt>
            <dd>
              <TokenAmount raw={snapshot.potBalance} decimals={decimals} symbol={symbol} />
            </dd>
          </div>
          <div>
            <dt>Protection vault</dt>
            <dd>
              <TokenAmount raw={snapshot.collateralBalance} decimals={decimals} symbol={symbol} />
            </dd>
          </div>
          <div>
            <dt>Protection tracked</dt>
            <dd>
              <TokenAmount raw={group.totalCollateralLocked} decimals={decimals} symbol={symbol} />
            </dd>
          </div>
          <div>
            <dt>Pot address</dt>
            <dd>
              <Address value={group.potVault} />
            </dd>
          </div>
          <div>
            <dt>Protection address</dt>
            <dd>
              <Address value={group.collateralVault} />
            </dd>
          </div>
        </dl>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onRefresh} style={{ marginTop: 12 }}>
          <RefreshCw size={14} className={refreshing ? "spin" : undefined} aria-hidden="true" /> Refresh from chain
        </button>
      </div>
    </section>
  );
}

export function CircleDetail({ address }: { address: string }) {
  const { cluster, network } = useNetwork();
  const { publicKey } = useWallet();
  const searchParams = useSearchParams();
  const status = useProgramStatus();
  const validAddress = useMemo(() => {
    try {
      return new PublicKey(address).toBase58();
    } catch {
      return null;
    }
  }, [address]);
  const circle = useCircle(validAddress);
  const label = useCircleLabel(cluster, address);
  const now = useNow();
  const wallet = publicKey?.toBase58() ?? null;

  if (!validAddress) {
    return (
      <div className="page" style={{ paddingTop: 48 }}>
        <EmptyState icon={<SearchX size={24} aria-hidden="true" />} title="That isn't a circle address" action={<Link className="btn btn-secondary" href="/">Back to discover</Link>} />
      </div>
    );
  }

  if (status.data && status.data.state !== "ready") {
    return (
      <div className="page" style={{ paddingTop: 48 }}>
        <EmptyState icon={<TriangleAlert size={24} aria-hidden="true" />} title={`Ringio is not live on ${network.label}`}>
          This link may belong to another network. Switch networks from the header.
        </EmptyState>
      </div>
    );
  }

  if (circle.loading || status.loading || !status.config) {
    return (
      <div className="page" style={{ paddingTop: 48, display: "grid", gap: 16 }} aria-busy="true">
        <div className="skeleton" style={{ height: 90 }} />
        <div className="detail-grid">
          <div className="skeleton" style={{ height: 420 }} />
          <div className="skeleton" style={{ height: 420 }} />
        </div>
      </div>
    );
  }

  const snapshot = circle.data?.snapshot;
  if (!snapshot) {
    return (
      <div className="page" style={{ paddingTop: 48 }}>
        <EmptyState
          icon={<SearchX size={24} aria-hidden="true" />}
          title={circle.error ? "Couldn't load this circle" : `No circle found on ${network.label}`}
          action={
            <button className="btn btn-secondary" type="button" onClick={() => circle.refresh()}>
              <RefreshCw size={15} aria-hidden="true" /> Try again
            </button>
          }
        >
          {circle.error
            ? "The RPC endpoint did not respond. Try again in a moment."
            : "Check the network in the header — circles only exist on the network where they were created."}
        </EmptyState>
      </div>
    );
  }

  const { group, decimals } = snapshot;
  const config = status.config;
  const plan = planActions({
    group,
    members: snapshot.members,
    config,
    wallet,
    invite: circle.data?.invite ?? null,
    now: now || Math.floor(group.createdAt),
  });
  const symbol = assetSymbol(group.mint, network);
  const pot = roundPayout(group.memberCount, group.contributionAmount);
  const deadline = nextDeadline(snapshot, config, now);
  const deadlines = circleDeadlines(group, config);
  const recipient = group.status === "active" ? group.payoutOrder[group.currentRound] : null;
  const justCreated = searchParams.get("created") === "1";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="breadcrumb">
            <Link href="/circles">My circles</Link> / <span className="mono">{circleCode(group.address)}</span>
          </span>
          <h1>{circleTitle(group.address, label)}</h1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            <span className={statusBadgeClass(group.status)}>{STATUS_META[group.status].label}</span>
            <span className="badge">
              <span className={`net-dot net-dot-${cluster}`} style={{ marginTop: 0 }} aria-hidden="true" /> {network.label}
            </span>
            <span className={isCanonicalAsset(group.mint, network) ? "badge badge-success" : "badge badge-warning"}>
              {isCanonicalAsset(group.mint, network) ? `Verified ${symbol}` : "Unverified token — check the mint"}
            </span>
            {config.paused && <span className="badge badge-danger">Protocol paused</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <CopyInviteLink address={group.address} />
          <a className="btn btn-ghost" href={explorerUrl(cluster, "address", group.address)} target="_blank" rel="noreferrer">
            Explorer <ExternalLink size={15} aria-hidden="true" />
          </a>
        </div>
      </div>

      {justCreated && group.status === "forming" && plan.role === "creator" && (
        <div className="callout callout-gold" style={{ marginBottom: 16 }} role="status">
          <PartyPopper size={16} aria-hidden="true" />
          <span>
            Your circle is live on {network.label}. Invite members with their wallet addresses, then share the circle link so they can
            accept.
          </span>
        </div>
      )}

      <Stepper snapshot={snapshot} />

      <div className="detail-grid" style={{ marginTop: 16 }}>
        <div className="detail-main">
          <section className="card overview" aria-label="Circle overview">
            <RingDial
              nodes={ringNodes(snapshot, wallet)}
              progress={payoutProgress(snapshot)}
              label={`${group.joinedCount} of ${group.memberCount} members; ${group.currentRound} turns paid out`}
              center={
                group.status === "active" ? (
                  <>
                    <span>Turn {group.currentRound + 1} pot</span>
                    <strong className="amount">{formatTokenAmount(snapshot.potBalance, decimals)}</strong>
                    <small>
                      of {formatTokenAmount(pot, decimals)} {symbol}
                    </small>
                  </>
                ) : (
                  <>
                    <span>Pot per turn</span>
                    <strong className="amount">{formatTokenAmount(pot, decimals)}</strong>
                    <small>{symbol}</small>
                  </>
                )
              }
            />
            <div className="overview-stats">
              <div className="fact">
                <span>Contribution</span>
                <strong className="amount">
                  {formatTokenAmount(group.contributionAmount, decimals)} {symbol}
                </strong>
              </div>
              <div className="fact">
                <span>Schedule</span>
                <strong>{cadenceText(group.periodSeconds)}</strong>
              </div>
              <div className="fact">
                <span>Turn</span>
                <strong>
                  {group.status === "completed"
                    ? `${group.memberCount} of ${group.memberCount}`
                    : group.status === "active"
                      ? `${group.currentRound + 1} of ${group.memberCount}`
                      : `— of ${group.memberCount}`}
                </strong>
              </div>
              <div className="fact">
                <span>{group.status === "active" ? "Paid this turn" : "Members"}</span>
                <strong>
                  {group.status === "active" ? `${group.roundContributions}/${group.memberCount}` : `${group.joinedCount}/${group.memberCount}`}
                </strong>
              </div>
              {recipient && (
                <div className="fact" style={{ gridColumn: "1 / -1" }}>
                  <span>This turn&apos;s recipient</span>
                  <strong>{recipient === wallet ? "You 🎉" : <Address value={recipient} />}</strong>
                </div>
              )}
              {deadline && now > 0 && (
                <div className="deadline">
                  <CalendarClock size={18} aria-hidden="true" />
                  <div>
                    <strong>
                      {deadline.label} {deadline.at >= now ? `in ${formatDuration(deadline.at - now)}` : "— passed"}
                    </strong>
                    <small>
                      {formatDate(deadline.at)}
                      {group.status === "active" && ` · grace until ${formatDate(deadlines.graceEnds)}`}
                    </small>
                  </div>
                </div>
              )}
            </div>
          </section>

          <MembersTable snapshot={snapshot} wallet={wallet} graceOver={group.status === "active" && now > deadlines.graceEnds} />

          <section className="card" aria-labelledby="terms-title">
            <div className="card-header">
              <div>
                <h3 id="terms-title">Rules</h3>
                <p>Fixed at creation and enforced by the program.</p>
              </div>
            </div>
            <div className="card-body">
              <dl className="kv">
                <div>
                  <dt>Contribution per turn</dt>
                  <dd className="amount">
                    {formatTokenAmount(group.contributionAmount, decimals)} {symbol}
                  </dd>
                </div>
                <div>
                  <dt>Turn length</dt>
                  <dd>{periodText(group.periodSeconds)}</dd>
                </div>
                <div>
                  <dt>Grace period</dt>
                  <dd>{periodText(group.graceSeconds)}</dd>
                </div>
                <div>
                  <dt>Invitations close</dt>
                  <dd>{formatDate(deadlines.join)}</dd>
                </div>
                <div>
                  <dt>Reveal window</dt>
                  <dd>{periodText(group.revealWindowSeconds)}</dd>
                </div>
                <div>
                  <dt>Protection window</dt>
                  <dd>{periodText(group.collateralWindowSeconds)}</dd>
                </div>
                <div>
                  <dt>Organizer</dt>
                  <dd>
                    <Address value={group.creator} />
                  </dd>
                </div>
                <div>
                  <dt>Asset mint</dt>
                  <dd>
                    <Address value={group.mint} />
                  </dd>
                </div>
                <div>
                  <dt>Circle account</dt>
                  <dd>
                    <Address value={group.address} />
                  </dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(group.createdAt)}</dd>
                </div>
              </dl>
            </div>
          </section>
          <VaultsCard snapshot={snapshot} onRefresh={() => circle.refresh()} refreshing={circle.refreshing} className="only-narrow" />
        </div>

        <div className="detail-side">
          <ActionPanel snapshot={snapshot} plan={plan} />

          <VaultsCard snapshot={snapshot} onRefresh={() => circle.refresh()} refreshing={circle.refreshing} className="only-wide" />

          {plan.role === "viewer" && wallet && (
            <div className="callout callout-info">
              <Link2 size={16} aria-hidden="true" />
              <span>
                Want a seat? Send your wallet address <strong className="mono">{shortAddress(wallet, 6)}</strong> to the organizer so they
                can invite you.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
