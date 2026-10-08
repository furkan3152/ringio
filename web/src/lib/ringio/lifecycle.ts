import type { ConfigAccount, GroupAccount, InviteAccount, MemberAccount } from "./accounts";
import { RESOLUTION_COLLATERAL, RESOLUTION_DIRECT, UNSET_ROUND } from "./constants";

/** Economics, deadlines, and the per-wallet action plan for one circle. */

export function collateralRequired(memberCount: number, rank: number, contribution: bigint): bigint {
  if (rank < 0 || rank >= memberCount) return BigInt(0);
  return contribution * BigInt(memberCount - rank - 1);
}

export function totalCollateralRequired(memberCount: number, contribution: bigint): bigint {
  const n = BigInt(memberCount);
  return ((n * (n - BigInt(1))) / BigInt(2)) * contribution;
}

export function roundPayout(memberCount: number, contribution: bigint): bigint {
  return contribution * BigInt(memberCount);
}

/** Base deadline plus pauses completed since the current phase began. */
export function effectiveDeadline(base: number, config: Pick<ConfigAccount, "totalPausedSeconds">, snapshot: bigint): number {
  const delta = config.totalPausedSeconds >= snapshot ? config.totalPausedSeconds - snapshot : BigInt(0);
  return base + Number(delta);
}

export type CircleDeadlines = {
  join: number;
  reveal: number;
  collateral: number;
  /** End of the contribution period (before grace) for the current round. */
  roundDue: number;
  /** End of the grace period; after this, missed contributions can be resolved. */
  graceEnds: number;
};

export function circleDeadlines(group: GroupAccount, config: Pick<ConfigAccount, "totalPausedSeconds">): CircleDeadlines {
  const shift = (base: number) => effectiveDeadline(base, config, group.phasePauseSnapshot);
  return {
    join: shift(group.joinDeadline),
    reveal: shift(group.revealDeadline),
    collateral: shift(group.collateralDeadline),
    roundDue: shift(group.roundStartedAt + group.periodSeconds),
    graceEnds: shift(group.roundStartedAt + group.periodSeconds + group.graceSeconds),
  };
}

export type ActionId =
  | "invite"
  | "join"
  | "reveal"
  | "finalize"
  | "post-collateral"
  | "activate"
  | "contribute"
  | "settle"
  | "cover-default"
  | "abort-round"
  | "cancel"
  | "refund-failed-round"
  | "refund-collateral";

export type CircleAction = {
  id: ActionId;
  /** Who can run it: the connected wallet only, the creator, or any wallet (permissionless crank). */
  audience: "you" | "creator" | "anyone";
  enabled: boolean;
  /** Explains why a visible action is disabled. */
  blockedReason?: string;
  /** Raw token amount leaving the signer's wallet, when applicable. */
  amount?: bigint;
  /** Raw token amount returned to the signer's wallet, when applicable. */
  release?: bigint;
  /** Target wallets for cranks such as cover-default or refunds. */
  targets?: string[];
};

export type Role = "creator" | "member" | "invitee" | "viewer";

export type ActionPlan = {
  role: Role;
  member: MemberAccount | null;
  /** The action this wallet should take next, if any. */
  primary: CircleAction | null;
  /** Other available actions, including permissionless cranks. */
  secondary: CircleAction[];
  /** Plain-language explanation of what the circle is waiting for. */
  waitingFor: string;
};

export type ActionContext = {
  group: GroupAccount;
  members: readonly MemberAccount[];
  config: Pick<ConfigAccount, "paused" | "totalPausedSeconds">;
  wallet: string | null;
  invite: InviteAccount | null;
  now: number;
};

function unresolvedMembers(group: GroupAccount, members: readonly MemberAccount[]): MemberAccount[] {
  return members.filter((member) => member.lastContributedRound !== group.currentRound);
}

export function isCoverable(member: MemberAccount, group: GroupAccount): boolean {
  return (
    member.payoutRank !== UNSET_ROUND &&
    member.payoutRank < group.currentRound &&
    member.payoutReceived &&
    member.collateralLocked >= group.contributionAmount
  );
}

export function failedRoundRefundTargets(group: GroupAccount, members: readonly MemberAccount[]): string[] {
  if (group.status !== "defaulted") return [];
  return members
    .filter(
      (member) =>
        member.lastContributedRound === group.failedRound &&
        member.lastRefundedRound !== group.failedRound &&
        (member.lastResolutionKind === RESOLUTION_DIRECT || member.lastResolutionKind === RESOLUTION_COLLATERAL),
    )
    .map((member) => member.wallet);
}

export function planActions(context: ActionContext): ActionPlan {
  const { group, members, config, wallet, invite, now } = context;
  const deadlines = circleDeadlines(group, config);
  const member = wallet ? members.find((candidate) => candidate.wallet === wallet) ?? null : null;
  const isCreator = wallet !== null && wallet === group.creator;
  const hasOpenInvite = Boolean(wallet && invite && !invite.used && invite.invitee === wallet && invite.group === group.address);
  const role: Role = isCreator ? "creator" : member ? "member" : hasOpenInvite ? "invitee" : "viewer";
  const paused = config.paused;
  const pausedReason = "Ringio is paused; only refunds are available.";

  const own: CircleAction[] = [];
  const cranks: CircleAction[] = [];
  let waitingFor = "";

  const gate = (action: CircleAction, refund = false): CircleAction =>
    paused && !refund && action.enabled ? { ...action, enabled: false, blockedReason: pausedReason } : action;

  switch (group.status) {
    case "forming": {
      const open = now <= deadlines.join && group.joinedCount < group.memberCount;
      const seatsLeft = group.memberCount - group.joinedCount;
      waitingFor = open
        ? `${seatsLeft} more member${seatsLeft === 1 ? "" : "s"} must accept an invitation.`
        : "The join window closed before the circle filled. It can now be cancelled.";
      if (isCreator) {
        own.push(gate({
          id: "invite",
          audience: "creator",
          enabled: open,
          blockedReason: open ? undefined : "The join window has closed.",
        }));
        own.push(gate({ id: "cancel", audience: "creator", enabled: true }));
      } else if (hasOpenInvite && !member) {
        own.push(gate({
          id: "join",
          audience: "you",
          enabled: open,
          blockedReason: open ? undefined : "The join window has closed.",
        }));
      }
      if (!isCreator && now > deadlines.join) {
        cranks.push(gate({ id: "cancel", audience: "anyone", enabled: true }));
      }
      break;
    }
    case "revealing": {
      const open = now <= deadlines.reveal;
      const missing = group.memberCount - group.revealedCount;
      waitingFor =
        missing === 0
          ? "Every secret is revealed. Anyone can now draw the payout order."
          : open
            ? `${missing} member${missing === 1 ? "" : "s"} still need to reveal their secret.`
            : "The reveal window closed with missing reveals. The circle can be cancelled.";
      if (member && !member.revealed) {
        own.push(gate({
          id: "reveal",
          audience: "you",
          enabled: open,
          blockedReason: open ? undefined : "The reveal window has closed.",
        }));
      }
      if (missing === 0) cranks.push(gate({ id: "finalize", audience: "anyone", enabled: true }));
      if (missing > 0 && now > deadlines.reveal) cranks.push(gate({ id: "cancel", audience: "anyone", enabled: true }));
      break;
    }
    case "collateralizing": {
      const open = now <= deadlines.collateral;
      const missing = group.memberCount - group.collateralizedCount;
      waitingFor =
        missing === 0
          ? "Every member posted protection. Anyone can now start the first turn."
          : open
            ? `${missing} member${missing === 1 ? "" : "s"} still need to post protection.`
            : "The protection window closed. The circle can be cancelled and protection refunded.";
      if (member && !member.collateralPosted) {
        const rank = group.payoutOrder.indexOf(member.wallet);
        own.push(gate({
          id: "post-collateral",
          audience: "you",
          enabled: open && rank >= 0,
          blockedReason: open ? undefined : "The protection window has closed.",
          amount: collateralRequired(group.memberCount, rank, group.contributionAmount),
        }));
      }
      if (missing === 0) cranks.push(gate({ id: "activate", audience: "anyone", enabled: true }));
      if (missing > 0 && now > deadlines.collateral) cranks.push(gate({ id: "cancel", audience: "anyone", enabled: true }));
      break;
    }
    case "active": {
      const open = now <= deadlines.graceEnds;
      const unresolved = unresolvedMembers(group, members);
      const recipient = group.payoutOrder[group.currentRound];
      if (group.roundContributions >= group.memberCount) {
        waitingFor = "Every contribution is in. Anyone can now pay out this turn.";
      } else if (open) {
        waitingFor = `${group.memberCount - group.roundContributions} contribution${group.memberCount - group.roundContributions === 1 ? "" : "s"} still due this turn.`;
      } else {
        waitingFor = "The grace period ended with missing contributions. Anyone can resolve them.";
      }
      if (member && member.lastContributedRound !== group.currentRound) {
        const release = member.payoutRank < group.currentRound ? group.contributionAmount : BigInt(0);
        own.push(gate({
          id: "contribute",
          audience: "you",
          enabled: open,
          blockedReason: open ? undefined : "The grace period has ended for this turn.",
          amount: group.contributionAmount,
          release,
        }));
      }
      if (group.roundContributions >= group.memberCount && recipient) {
        cranks.push(gate({ id: "settle", audience: "anyone", enabled: true, targets: [recipient] }));
      }
      if (!open && unresolved.length > 0) {
        const coverable = unresolved.filter((candidate) => isCoverable(candidate, group));
        const uncovered = unresolved.filter((candidate) => !isCoverable(candidate, group));
        if (coverable.length > 0) {
          cranks.push(gate({ id: "cover-default", audience: "anyone", enabled: true, targets: coverable.map((m) => m.wallet) }));
        }
        if (uncovered.length > 0) {
          cranks.push(gate({ id: "abort-round", audience: "anyone", enabled: true, targets: [uncovered[0].wallet] }));
        }
      }
      break;
    }
    case "completed":
    case "cancelled":
    case "defaulted": {
      const refundTargets = failedRoundRefundTargets(group, members);
      const pendingRoundRefunds = group.status === "defaulted" && group.roundContributions > 0;
      waitingFor =
        group.status === "completed"
          ? "Every turn has been paid out. The circle is complete."
          : group.status === "cancelled"
            ? "The circle was cancelled. Any posted protection can be withdrawn."
            : pendingRoundRefunds
              ? "A turn failed. Its contributions must be refunded before protection is released."
              : "A turn failed. Remaining protection can be withdrawn.";
      if (refundTargets.length > 0) {
        cranks.push({ id: "refund-failed-round", audience: "anyone", enabled: true, targets: refundTargets });
      }
      if (member && member.collateralLocked > BigInt(0)) {
        own.push({
          id: "refund-collateral",
          audience: "you",
          enabled: !pendingRoundRefunds,
          blockedReason: pendingRoundRefunds ? "Refund the failed turn's contributions first." : undefined,
          release: member.collateralLocked,
        });
      }
      break;
    }
  }

  const primary = own.find((action) => action.enabled) ?? own[0] ?? cranks.find((action) => action.enabled) ?? null;
  const secondary = [...own, ...cranks].filter((action) => action !== primary);
  return { role, member, primary, secondary, waitingFor };
}
