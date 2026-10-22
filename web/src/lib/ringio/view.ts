import type { RingNode } from "@/components/ui/ring-dial";
import { groupCodeFromAddress } from "@/lib/groups/catalog";
import type { NetworkConfig } from "@/lib/solana/networks";

import type { ConfigAccount } from "./accounts";
import type { GroupStatus } from "./constants";
import type { CircleSnapshot } from "./fetch";
import { circleDeadlines } from "./lifecycle";

/** Presentation helpers shared by circle cards and the detail page. */

/** Public discovery code (RNG- + 12 hex chars), shared with the guide API. */
export function circleCode(address: string): string {
  return groupCodeFromAddress(address);
}

export function circleTitle(address: string, label?: string | null): string {
  return label?.trim() ? label.trim() : `Circle ${circleCode(address)}`;
}

export const STATUS_META: Record<GroupStatus, { label: string; tone: "gold" | "info" | "success" | "danger" | "neutral" }> = {
  forming: { label: "Forming", tone: "info" },
  revealing: { label: "Drawing order", tone: "info" },
  collateralizing: { label: "Posting protection", tone: "info" },
  active: { label: "Active", tone: "gold" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  defaulted: { label: "Turn failed", tone: "danger" },
};

export function statusBadgeClass(status: GroupStatus): string {
  const tone = STATUS_META[status].tone;
  return tone === "neutral" ? "badge badge-dot" : `badge badge-dot badge-${tone}`;
}

export function assetSymbol(mint: string, network: NetworkConfig): string {
  return network.asset && network.asset.mint === mint ? network.asset.symbol : "tokens";
}

export function isCanonicalAsset(mint: string, network: NetworkConfig): boolean {
  return Boolean(network.asset?.canonical && network.asset.mint === mint);
}

export function periodText(seconds: number): string {
  const units: [number, string][] = [
    [7 * 86_400, "week"],
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    if (seconds >= size && seconds % size === 0) {
      const value = seconds / size;
      return value === 1 ? `1 ${name}` : `${value} ${name}s`;
    }
  }
  return `${seconds} seconds`;
}

export function cadenceText(seconds: number): string {
  if (seconds === 7 * 86_400) return "Weekly";
  if (seconds === 14 * 86_400) return "Every 2 weeks";
  if (seconds === 30 * 86_400) return "Monthly";
  return `Every ${periodText(seconds)}`;
}

export function ringNodes(snapshot: CircleSnapshot, wallet: string | null): RingNode[] {
  const { group, members } = snapshot;
  const byWallet = new Map(members.map((member) => [member.wallet, member]));
  const ordered = group.payoutOrder.length > 0 ? group.payoutOrder : group.members;
  const nodes: RingNode[] = ordered.map((address, index) => {
    const member = byWallet.get(address);
    const you = address === wallet;
    const label = you ? "You" : String(index + 1).padStart(2, "0");
    let state: RingNode["state"] = "due";
    if (group.payoutOrder.length > 0) {
      if (member?.payoutReceived) state = "received";
      else if (group.status === "active" && index === group.currentRound) state = "recipient";
      else if (group.status === "active" && member?.lastContributedRound === group.currentRound) state = "paid";
      else if (group.status === "defaulted" && member && member.lastContributedRound !== group.failedRound) state = "missed";
    }
    const position = group.payoutOrder.length > 0 ? `turn ${index + 1}` : `joined #${index + 1}`;
    return { key: address, label, state, title: `${you ? "You" : address} · ${position}` };
  });
  for (let seat = ordered.length; seat < group.memberCount; seat += 1) {
    nodes.push({ key: `empty-${seat}`, label: "", state: "empty", title: "Open seat" });
  }
  return nodes;
}

export function payoutProgress(snapshot: CircleSnapshot): number {
  const { group } = snapshot;
  if (group.status === "completed") return 1;
  if (group.status !== "active" && group.status !== "defaulted") return 0;
  return group.currentRound / group.memberCount;
}

export type DeadlineInfo = { label: string; at: number };

export function nextDeadline(
  snapshot: CircleSnapshot,
  config: Pick<ConfigAccount, "totalPausedSeconds">,
  now: number,
): DeadlineInfo | null {
  const { group } = snapshot;
  const deadlines = circleDeadlines(group, config);
  switch (group.status) {
    case "forming":
      return { label: "Invitations close", at: deadlines.join };
    case "revealing":
      return { label: "Reveal window closes", at: deadlines.reveal };
    case "collateralizing":
      return { label: "Protection window closes", at: deadlines.collateral };
    case "active":
      if (now > deadlines.roundDue && group.roundContributions < group.memberCount) {
        return { label: "Grace period ends", at: deadlines.graceEnds };
      }
      return { label: `Turn ${group.currentRound + 1} contributions due`, at: deadlines.roundDue };
    default:
      return null;
  }
}
