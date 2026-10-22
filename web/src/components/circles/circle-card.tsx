"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { useNetwork } from "@/components/providers/network-provider";
import { formatTokenAmount } from "@/lib/ringio/amounts";
import type { CircleSnapshot } from "@/lib/ringio/fetch";
import { roundPayout } from "@/lib/ringio/lifecycle";
import { assetSymbol, cadenceText, circleCode, circleTitle, STATUS_META, statusBadgeClass } from "@/lib/ringio/view";
import { useCircleLabel } from "@/lib/local-labels";

export function CircleCard({
  snapshot,
  callout,
  calloutTone = "gold",
}: {
  snapshot: CircleSnapshot;
  /** Short wallet-specific hint, e.g. "Your turn to contribute". */
  callout?: string | null;
  calloutTone?: "gold" | "info" | "danger";
}) {
  const { cluster, network } = useNetwork();
  const { group, decimals } = snapshot;
  const label = useCircleLabel(cluster, group.address);
  const symbol = assetSymbol(group.mint, network);
  const filled = group.joinedCount;

  return (
    <Link className="card circle-card" href={`/circles/${group.address}`}>
      <div className="circle-card-head">
        <div>
          <h3>{circleTitle(group.address, label)}</h3>
          <p className="mono">{circleCode(group.address)}</p>
        </div>
        <span className={statusBadgeClass(group.status)}>{STATUS_META[group.status].label}</span>
      </div>

      <div className="circle-card-amount">
        <strong className="amount">{formatTokenAmount(group.contributionAmount, decimals)}</strong>
        <span>
          {symbol} · {cadenceText(group.periodSeconds).toLowerCase()}
        </span>
      </div>

      <div className="circle-card-facts">
        <div className="fact">
          <span>Pot / turn</span>
          <strong className="amount">{formatTokenAmount(roundPayout(group.memberCount, group.contributionAmount), decimals)}</strong>
        </div>
        <div className="fact">
          <span>Members</span>
          <strong>
            {filled}/{group.memberCount}
          </strong>
        </div>
        <div className="fact">
          <span>Turn</span>
          <strong>
            {group.status === "active" ? `${group.currentRound + 1}/${group.memberCount}` : group.status === "completed" ? "Done" : "—"}
          </strong>
        </div>
      </div>

      <div className="seat-dots" aria-label={`${filled} of ${group.memberCount} seats filled`}>
        {Array.from({ length: group.memberCount }, (_, index) => (
          <span key={index} className={index < filled ? "filled" : undefined} />
        ))}
      </div>

      <div className="circle-card-foot">
        {callout ? (
          <span className={`badge badge-${calloutTone}`}>{callout}</span>
        ) : (
          <span className="subtle">View circle</span>
        )}
        <ArrowRight size={16} aria-hidden="true" />
      </div>
    </Link>
  );
}

export function CircleCardSkeleton() {
  return <div className="skeleton" style={{ height: 268 }} aria-hidden="true" />;
}
