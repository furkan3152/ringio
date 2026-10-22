"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { ArrowRight, Clock3, Info, TriangleAlert, UserPlus } from "lucide-react";

import { useNetwork } from "@/components/providers/network-provider";
import { Dialog } from "@/components/ui/dialog";
import { Address, shortAddress, TokenAmount } from "@/components/ui/primitives";
import { useCommitSecret } from "@/hooks/use-commit-secret";
import { useProgramId, useWalletBalances } from "@/hooks/use-ringio";
import { RingioTxError, useRingioTx, type TxStep } from "@/hooks/use-ringio-tx";
import { formatTokenAmount } from "@/lib/ringio/amounts";
import type { CircleSnapshot } from "@/lib/ringio/fetch";
import {
  abortUncoveredRoundIx,
  activateGroupIx,
  cancelGroupIx,
  contributeIx,
  coverDefaultIx,
  createAtaIdempotentIx,
  finalizeOrderIx,
  inviteMemberIx,
  joinGroupIx,
  postCollateralIx,
  refundCollateralIx,
  refundFailedRoundIx,
  revealSecretIx,
  settleRoundIx,
} from "@/lib/ringio/instructions";
import type { ActionId, ActionPlan, CircleAction } from "@/lib/ringio/lifecycle";
import { assetSymbol } from "@/lib/ringio/view";

type Copy = { title: string; body: string; button: string };

function actionCopy(action: CircleAction, symbol: string, decimals: number): Copy {
  const amount = (raw?: bigint) => (raw === undefined ? "" : `${formatTokenAmount(raw, decimals)} ${symbol}`);
  const copies: Record<ActionId, Copy> = {
    invite: {
      title: "Invite members",
      body: "Paste the wallet addresses of the people you want in this circle. Only invited wallets can join.",
      button: "Send invitations",
    },
    join: {
      title: "You're invited",
      body: "Accept to take a seat. You'll sign a free message that creates your secret for the fair payout draw, then the join transaction.",
      button: "Accept invitation",
    },
    reveal: {
      title: "Reveal your secret",
      body: "The circle is full. Reveal the secret you committed when joining so the payout order can be drawn.",
      button: "Reveal secret",
    },
    finalize: {
      title: "Draw the payout order",
      body: "Every secret is revealed. Anyone can now ask the program to derive the final payout order.",
      button: "Draw payout order",
    },
    "post-collateral": {
      title: action.amount && action.amount > BigInt(0) ? "Post your protection" : "Confirm your seat",
      body:
        action.amount && action.amount > BigInt(0)
          ? "Lock collateral for the turns you will still owe after your payout. One slice returns each time you contribute after being paid."
          : "You are paid last, so no collateral is needed. Confirm to mark your seat ready.",
      button: action.amount && action.amount > BigInt(0) ? `Lock ${amount(action.amount)}` : "Confirm seat",
    },
    activate: {
      title: "Start the first turn",
      body: "Every member has posted protection. Anyone can start the circle now.",
      button: "Start circle",
    },
    contribute: {
      title: "Your contribution is due",
      body:
        action.release && action.release > BigInt(0)
          ? `Pay this turn's contribution. Because you were already paid out, ${amount(action.release)} of your protection is returned in the same transaction.`
          : "Pay this turn's contribution into the circle's pot vault.",
      button: `Contribute ${amount(action.amount)}`,
    },
    settle: {
      title: "Pay out this turn",
      body: "Every contribution is in. Anyone can send the pot to this turn's recipient — the program checks the order.",
      button: "Pay out turn",
    },
    "cover-default": {
      title: "Cover a missed payment",
      body: "A member who was already paid missed this turn. Their locked protection can now cover it.",
      button: "Cover from protection",
    },
    "abort-round": {
      title: "Stop this turn",
      body: "A member who has not been paid yet missed this turn. The turn is stopped and every contribution becomes refundable.",
      button: "Stop turn",
    },
    cancel: {
      title: action.audience === "creator" ? "Cancel circle" : "Close expired circle",
      body:
        action.audience === "creator"
          ? "Cancel before the circle fills. No funds are held yet."
          : "A setup deadline passed. Anyone can close the circle so posted protection can be withdrawn.",
      button: "Cancel circle",
    },
    "refund-failed-round": {
      title: "Refund the failed turn",
      body: "Return this turn's contributions to the members who paid. Anyone can run this.",
      button: "Process refunds",
    },
    "refund-collateral": {
      title: "Withdraw your protection",
      body: "Your locked protection is no longer needed. Withdraw it back to your wallet.",
      button: `Withdraw ${amount(action.release)}`,
    },
  };
  return copies[action.id];
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function parseWallets(input: string): { valid: string[]; invalid: string[] } {
  const parts = input.split(/[\s,;]+/).map((part) => part.trim()).filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of parts) {
    try {
      const key = new PublicKey(part);
      if (!PublicKey.isOnCurve(key.toBytes())) throw new Error("off-curve");
      if (!valid.includes(key.toBase58())) valid.push(key.toBase58());
    } catch {
      invalid.push(part);
    }
  }
  return { valid, invalid };
}

export function ActionPanel({ snapshot, plan }: { snapshot: CircleSnapshot; plan: ActionPlan }) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { network } = useNetwork();
  const programId = useProgramId();
  const { run, busy } = useRingioTx();
  const { derive, recover } = useCommitSecret();
  const { group, decimals, invites, members } = snapshot;
  const symbol = assetSymbol(group.mint, network);
  const balances = useWalletBalances(group.mint);
  const [inviteText, setInviteText] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const groupKey = new PublicKey(group.address);
  const mint = new PublicKey(group.mint);

  const invited = new Set([...invites.map((entry) => entry.invitee), ...group.members]);
  const parsedInvites = parseWallets(inviteText);
  const newInvitees = parsedInvites.valid.filter((wallet) => !invited.has(wallet));
  const seatsLeft = group.memberCount - group.joinedCount;

  async function execute(action: CircleAction) {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    const refs = { programId, group: groupKey, mint };
    const keeper = publicKey;
    const label = actionCopy(action, symbol, decimals).title;
    const single = (instructions: TransactionInstruction[]): TxStep[] => [{ label, instructions }];

    switch (action.id) {
      case "invite": {
        if (newInvitees.length === 0) return;
        const signatures = await run(
          "Invite members",
          chunk(newInvitees, 5).map((batch, index, all) => ({
            label: all.length > 1 ? `Invite members (${index + 1}/${all.length})` : "Invite members",
            instructions: batch.map((wallet) =>
              inviteMemberIx({ programId, group: groupKey, creator: publicKey, invitee: new PublicKey(wallet) }),
            ),
          })),
        );
        if (signatures) setInviteText("");
        return;
      }
      case "join":
        await run(label, async () => {
          const { commitment } = await derive(groupKey);
          return single([joinGroupIx({ programId, group: groupKey, participant: publicKey, commitment })]);
        });
        return;
      case "reveal":
        await run(label, async () => {
          const member = members.find((entry) => entry.wallet === publicKey.toBase58());
          if (!member) throw new RingioTxError("This wallet is not a member of the circle.");
          const secret = await recover(groupKey, member.commitment);
          return single([revealSecretIx({ programId, group: groupKey, participant: publicKey, secret })]);
        });
        return;
      case "finalize":
        await run(label, single([finalizeOrderIx({ programId, group: groupKey })]));
        return;
      case "post-collateral":
        await run(label, single([postCollateralIx({ ...refs, participant: publicKey })]));
        return;
      case "activate":
        await run(label, single([activateGroupIx({ programId, group: groupKey })]));
        return;
      case "contribute":
        await run(label, single([contributeIx({ ...refs, participant: publicKey })]));
        return;
      case "settle": {
        const recipient = new PublicKey(action.targets![0]);
        await run(
          label,
          single([createAtaIdempotentIx({ payer: keeper, owner: recipient, mint }), settleRoundIx({ ...refs, recipient, keeper })]),
        );
        return;
      }
      case "cover-default":
        await run(
          label,
          chunk(action.targets ?? [], 4).map((batch) => ({
            label,
            instructions: batch.map((wallet) => coverDefaultIx({ ...refs, memberWallet: new PublicKey(wallet), keeper })),
          })),
        );
        return;
      case "abort-round":
        await run(
          label,
          single([abortUncoveredRoundIx({ programId, group: groupKey, delinquentWallet: new PublicKey(action.targets![0]), keeper })]),
        );
        return;
      case "cancel":
        setConfirmCancel(true);
        return;
      case "refund-failed-round":
        await run(
          label,
          chunk(action.targets ?? [], 3).map((batch) => ({
            label,
            instructions: batch.flatMap((wallet) => {
              const owner = new PublicKey(wallet);
              return [
                createAtaIdempotentIx({ payer: keeper, owner, mint }),
                refundFailedRoundIx({ ...refs, memberWallet: owner, keeper }),
              ];
            }),
          })),
        );
        return;
      case "refund-collateral":
        await run(
          label,
          single([
            createAtaIdempotentIx({ payer: publicKey, owner: publicKey, mint }),
            refundCollateralIx({ ...refs, participant: publicKey }),
          ]),
        );
        return;
    }
  }

  const primary = plan.primary;
  const needsTokens = primary && (primary.id === "contribute" || primary.id === "post-collateral") && primary.amount;
  const insufficient =
    needsTokens && balances.data?.token != null && primary.amount !== undefined && balances.data.token < primary.amount;

  return (
    <section className="card action-card" aria-labelledby="action-title">
      {primary ? (
        <>
          <span className="eyebrow">
            {primary.audience === "anyone" ? "Anyone can do this" : primary.audience === "creator" ? "Organizer" : "Your next step"}
          </span>
          <h2 id="action-title">{actionCopy(primary, symbol, decimals).title}</h2>
          <p>{actionCopy(primary, symbol, decimals).body}</p>

          {(primary.id === "contribute" || (primary.id === "post-collateral" && primary.amount! > BigInt(0))) && primary.amount !== undefined && (
            <div className="action-amount">
              <strong className="amount">{formatTokenAmount(primary.amount, decimals)}</strong>
              <span>{symbol}</span>
            </div>
          )}
          {primary.id === "refund-collateral" && primary.release !== undefined && (
            <div className="action-amount">
              <strong className="amount">{formatTokenAmount(primary.release, decimals)}</strong>
              <span>{symbol}</span>
            </div>
          )}

          {primary.id === "invite" && (
            <div className="field">
              <label htmlFor="invitees">
                Wallet addresses <span className="subtle">({seatsLeft} seat{seatsLeft === 1 ? "" : "s"} left)</span>
              </label>
              <textarea
                id="invitees"
                className="textarea"
                placeholder="One Solana address per line"
                value={inviteText}
                onChange={(event) => setInviteText(event.target.value)}
                aria-invalid={parsedInvites.invalid.length > 0 || undefined}
              />
              {parsedInvites.invalid.length > 0 ? (
                <span className="error">Not a wallet address: {parsedInvites.invalid.slice(0, 2).join(", ")}</span>
              ) : (
                <span className="hint">
                  {newInvitees.length > 0
                    ? `${newInvitees.length} new invitation${newInvitees.length === 1 ? "" : "s"} · ~0.0016 SOL rent each`
                    : "Already-invited wallets are skipped automatically."}
                </span>
              )}
            </div>
          )}

          {(primary.id === "settle" || primary.id === "cover-default" || primary.id === "abort-round") && primary.targets && (
            <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
              {primary.id === "settle" ? "Recipient" : "Member"}: <Address value={primary.targets[0]} />
              {primary.targets.length > 1 && ` +${primary.targets.length - 1} more`}
            </p>
          )}

          <dl className="signing-context">
            <div>
              <dt>Network</dt>
              <dd>
                <span className={`net-dot net-dot-${network.id}`} style={{ marginTop: 0 }} aria-hidden="true" /> {network.label}
              </dd>
            </div>
            <div>
              <dt>Asset mint</dt>
              <dd>
                <Address value={group.mint} />
              </dd>
            </div>
            {publicKey && needsTokens && (
              <div>
                <dt>Your balance</dt>
                <dd>{balances.data?.token != null ? <TokenAmount raw={balances.data.token} decimals={decimals} symbol={symbol} /> : "…"}</dd>
              </div>
            )}
          </dl>

          {insufficient && (
            <div className="callout callout-warning" style={{ marginBottom: 14 }}>
              <TriangleAlert size={16} aria-hidden="true" />
              <span>
                Your wallet needs at least <TokenAmount raw={primary.amount!} decimals={decimals} symbol={symbol} /> on {network.label}
                {network.id === "devnet" ? " — get test USDC from faucet.circle.com." : "."}
              </span>
            </div>
          )}

          {!primary.enabled && primary.blockedReason && (
            <div className="callout callout-warning" style={{ marginBottom: 14 }}>
              <Clock3 size={16} aria-hidden="true" />
              <span>{primary.blockedReason}</span>
            </div>
          )}

          <button
            className={`btn ${primary.id === "cancel" || primary.id === "abort-round" ? "btn-danger" : "btn-primary"} btn-lg btn-block`}
            type="button"
            disabled={Boolean(busy) || !primary.enabled || (primary.id === "invite" && (newInvitees.length === 0 || parsedInvites.invalid.length > 0))}
            onClick={() => void execute(primary)}
          >
            {publicKey ? (
              busy ? (
                "Waiting for wallet…"
              ) : (
                <>
                  {primary.id === "invite" && <UserPlus size={17} aria-hidden="true" />}
                  {actionCopy(primary, symbol, decimals).button}
                  {primary.id !== "invite" && <ArrowRight size={17} aria-hidden="true" />}
                </>
              )
            ) : (
              "Connect wallet"
            )}
          </button>
        </>
      ) : (
        <>
          <span className="eyebrow eyebrow-muted">Status</span>
          <h2 id="action-title">{plan.role === "viewer" ? "Nothing to sign" : "You're all set"}</h2>
          <p>
            {plan.role === "viewer"
              ? "This wallet is not part of the circle. Ask the organizer to invite your wallet address."
              : "There is nothing for you to do right now. This page refreshes automatically."}
          </p>
          {!publicKey && (
            <button className="btn btn-primary btn-block" type="button" onClick={() => setVisible(true)} style={{ marginTop: 16 }}>
              Connect wallet
            </button>
          )}
        </>
      )}

      {plan.waitingFor && (
        <div className="waiting">
          <Info size={15} aria-hidden="true" />
          <span>{plan.waitingFor}</span>
        </div>
      )}

      {plan.secondary.length > 0 && (
        <div className="secondary-actions">
          {plan.secondary.map((action) => {
            const copy = actionCopy(action, symbol, decimals);
            return (
              <div className="secondary-action" key={`${action.id}-${action.audience}`}>
                <span>
                  <strong>{copy.title}</strong>
                  <small>
                    {action.audience === "anyone" ? "Anyone can run this" : action.audience === "creator" ? "Organizer only" : "For you"}
                    {action.targets?.[0] && action.id !== "refund-failed-round" ? ` · ${shortAddress(action.targets[0])}` : ""}
                  </small>
                </span>
                <button
                  className={`btn btn-sm ${action.id === "cancel" || action.id === "abort-round" ? "btn-danger" : "btn-secondary"}`}
                  type="button"
                  disabled={Boolean(busy) || !action.enabled}
                  title={action.blockedReason}
                  onClick={() => void execute(action)}
                >
                  {copy.button}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={confirmCancel} onClose={() => setConfirmCancel(false)} label="Cancel circle">
        <div className="dialog-body">
          <span className="badge badge-danger">Irreversible</span>
          <h2>Cancel this circle?</h2>
          <p>
            The circle stops permanently. Members who already posted protection can withdraw it afterwards. This cannot be
            undone.
          </p>
          <div className="dialog-actions">
            <button className="btn btn-ghost" type="button" onClick={() => setConfirmCancel(false)}>
              Keep circle
            </button>
            <button
              className="btn btn-danger"
              type="button"
              onClick={async () => {
                setConfirmCancel(false);
                if (!publicKey) return;
                await run("Cancel circle", [
                  { label: "Cancel circle", instructions: [cancelGroupIx({ programId, group: groupKey, caller: publicKey })] },
                ]);
              }}
            >
              Cancel circle
            </button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
