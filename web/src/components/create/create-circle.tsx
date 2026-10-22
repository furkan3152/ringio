"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { ChevronDown, CircleDollarSign, Info, Minus, Plus, ShieldCheck, TriangleAlert } from "lucide-react";

import { useNetwork } from "@/components/providers/network-provider";
import { DurationInput, durationSeconds, type DurationValue } from "@/components/ui/duration-input";
import { Address, EmptyState, formatDuration } from "@/components/ui/primitives";
import { useChainQuery } from "@/hooks/use-chain-query";
import { useCommitSecret } from "@/hooks/use-commit-secret";
import { useNow } from "@/hooks/use-now";
import { useProgramId, useProgramStatus, useWalletBalances } from "@/hooks/use-ringio";
import { useRingioTx } from "@/hooks/use-ringio-tx";
import { setCircleLabel } from "@/lib/local-labels";
import { formatTokenAmount, parseTokenAmount } from "@/lib/ringio/amounts";
import { MAX_MEMBERS, MIN_MEMBERS, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@/lib/ringio/constants";
import { createGroupIx, validateCreateGroupParams } from "@/lib/ringio/instructions";
import { collateralRequired, roundPayout } from "@/lib/ringio/lifecycle";
import { groupPda } from "@/lib/ringio/pda";
import { decodeMintDecimals } from "@/lib/ringio/accounts";
import { cadenceText } from "@/lib/ringio/view";

type Cadence = "weekly" | "biweekly" | "monthly" | "custom";

const CADENCE_SECONDS: Record<Exclude<Cadence, "custom">, number> = {
  weekly: 7 * 86_400,
  biweekly: 14 * 86_400,
  monthly: 30 * 86_400,
};

type FormState = {
  label: string;
  members: number;
  amount: string;
  cadence: Cadence;
  customPeriod: DurationValue;
  grace: DurationValue;
  joinWindow: DurationValue;
  revealWindow: DurationValue;
  collateralWindow: DurationValue;
  customMint: string;
};

const INITIAL: FormState = {
  label: "",
  members: 5,
  amount: "50",
  cadence: "weekly",
  customPeriod: { value: "10", unit: "minutes" },
  grace: { value: "1", unit: "days" },
  joinWindow: { value: "7", unit: "days" },
  revealWindow: { value: "2", unit: "days" },
  collateralWindow: { value: "2", unit: "days" },
  customMint: "",
};

type MintInfo = { decimals: number } | { error: string };

function randomGroupId(): bigint {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return new DataView(bytes.buffer).getBigUint64(0, true);
}

function validMintKey(value: string): PublicKey | null {
  try {
    return value.trim() ? new PublicKey(value.trim()) : null;
  } catch {
    return null;
  }
}

export function CreateCircle() {
  const router = useRouter();
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { cluster, network } = useNetwork();
  const programId = useProgramId();
  const status = useProgramStatus();
  const { derive } = useCommitSecret();
  const { run, busy } = useRingioTx();
  const now = useNow();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const mintAddress = network.asset ? network.asset.mint : validMintKey(form.customMint)?.toBase58() ?? null;
  const mintKey = useMemo(() => (mintAddress ? new PublicKey(mintAddress) : null), [mintAddress]);
  const mintQuery = useChainQuery<MintInfo>(mintAddress ? `mint:${cluster}:${mintAddress}` : null, async () => {
    const info = await connection.getAccountInfo(new PublicKey(mintAddress!), "confirmed");
    if (!info) return { error: "This mint does not exist on the selected network." };
    if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return { error: "Token-2022 mints are not supported; use a classic SPL token." };
    if (!info.owner.equals(TOKEN_PROGRAM_ID)) return { error: "This address is not an SPL token mint." };
    return { decimals: decodeMintDecimals(mintAddress!, info.data) };
  });
  const decimals = mintQuery.data && "decimals" in mintQuery.data ? mintQuery.data.decimals : null;
  const balances = useWalletBalances(mintAddress);
  const symbol = network.asset?.symbol ?? "tokens";

  const periodSeconds = form.cadence === "custom" ? durationSeconds(form.customPeriod) : CADENCE_SECONDS[form.cadence];
  const graceSeconds = durationSeconds(form.grace);
  const joinWindowSeconds = durationSeconds(form.joinWindow);
  const revealSeconds = durationSeconds(form.revealWindow);
  const collateralSeconds = durationSeconds(form.collateralWindow);
  const amountRaw = decimals !== null ? parseTokenAmount(form.amount, decimals) : null;

  const errors = useMemo(() => {
    const result: Partial<Record<keyof FormState | "mint", string>> = {};
    if (!network.asset && !mintKey) result.mint = "Enter the SPL token mint this circle will use.";
    if (mintQuery.data && "error" in mintQuery.data) result.mint = mintQuery.data.error;
    if (amountRaw === null || amountRaw <= BigInt(0)) result.amount = `Enter an amount greater than zero (max ${decimals ?? 6} decimals).`;
    if (periodSeconds === null) result.customPeriod = "Enter a whole number.";
    if (graceSeconds === null) result.grace = "Enter a whole number.";
    if (joinWindowSeconds === null) result.joinWindow = "Enter a whole number.";
    if (revealSeconds === null) result.revealWindow = "Enter a whole number.";
    if (collateralSeconds === null) result.collateralWindow = "Enter a whole number.";
    return result;
  }, [amountRaw, collateralSeconds, decimals, graceSeconds, joinWindowSeconds, mintKey, mintQuery.data, network.asset, periodSeconds, revealSeconds]);

  const programError =
    publicKey && mintKey && amountRaw && periodSeconds && graceSeconds && joinWindowSeconds && revealSeconds && collateralSeconds && now > 0
      ? validateCreateGroupParams(
          {
            programId,
            creator: publicKey,
            mint: mintKey,
            groupId: BigInt(1),
            memberCount: form.members,
            contributionAmount: amountRaw,
            periodSeconds,
            graceSeconds,
            joinDeadline: now + joinWindowSeconds,
            revealWindowSeconds: revealSeconds,
            collateralWindowSeconds: collateralSeconds,
            creatorCommitment: new Uint8Array(32).fill(1),
          },
          now,
        )
      : null;

  const hasErrors = Object.keys(errors).length > 0 || programError !== null;
  const pot = amountRaw ? roundPayout(form.members, amountRaw) : null;
  const maxLock = amountRaw ? collateralRequired(form.members, 0, amountRaw) : null;
  const ranks = Array.from({ length: form.members }, (_, rank) => rank);
  const shownRanks = ranks.length <= 8 ? ranks : [...ranks.slice(0, 4), -1, ...ranks.slice(-2)];
  const worstCase = amountRaw && maxLock !== null ? maxLock + amountRaw : null;
  const lowBalance =
    worstCase !== null && balances.data?.token != null && balances.data.token < worstCase && decimals !== null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!publicKey) {
      setVisible(true);
      return;
    }
    if (hasErrors || !mintKey || !amountRaw || !periodSeconds || !graceSeconds || !joinWindowSeconds || !revealSeconds || !collateralSeconds) {
      return;
    }
    const groupId = randomGroupId();
    const group = groupPda(programId, publicKey, groupId);
    const signatures = await run("Create circle", async () => {
      const { commitment } = await derive(group);
      const nowSeconds = Math.floor(Date.now() / 1_000);
      return [
        {
          label: "Create circle",
          instructions: [
            createGroupIx({
              programId,
              creator: publicKey,
              mint: mintKey,
              groupId,
              memberCount: form.members,
              contributionAmount: amountRaw,
              periodSeconds,
              graceSeconds,
              joinDeadline: nowSeconds + joinWindowSeconds,
              revealWindowSeconds: revealSeconds,
              collateralWindowSeconds: collateralSeconds,
              creatorCommitment: commitment,
            }),
          ],
        },
      ];
    });
    if (signatures) {
      if (form.label.trim()) setCircleLabel(cluster, group.toBase58(), form.label);
      router.push(`/circles/${group.toBase58()}?created=1`);
    }
  }

  if (status.data && status.data.state !== "ready") {
    return (
      <div className="page" style={{ paddingTop: 48 }}>
        <EmptyState icon={<TriangleAlert size={24} aria-hidden="true" />} title={`Ringio is not live on ${network.label}`}>
          Circles can only be created where the program is deployed and initialized. Switch networks from the header.
        </EmptyState>
      </div>
    );
  }

  const showError = (key: keyof FormState | "mint") => (submitted || key === "mint" ? errors[key] : undefined);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="breadcrumb">
            <Link href="/circles">My circles</Link> / New circle
          </span>
          <h1>Start a savings circle</h1>
          <p>
            Set the rules once. They are written to {network.label} and can never change. You join automatically as the first
            member, then invite the others.
          </p>
        </div>
      </div>

      <form className="form-layout" onSubmit={onSubmit} noValidate>
        <div className="card">
          <section className="form-section" aria-labelledby="basics">
            <h2 id="basics">Basics</h2>
            <p>Who is in the circle and how much each person contributes every turn.</p>

            <div className="field">
              <label htmlFor="label">Nickname (optional)</label>
              <input
                id="label"
                className="input"
                maxLength={48}
                placeholder="e.g. Family gold day"
                value={form.label}
                onChange={(event) => update("label", event.target.value)}
              />
              <span className="hint">Saved only in this browser. Others see the public circle code.</span>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="members">Members (including you)</label>
                <div className="stepper-input">
                  <button type="button" aria-label="Fewer members" onClick={() => update("members", Math.max(MIN_MEMBERS, form.members - 1))}>
                    <Minus size={16} aria-hidden="true" />
                  </button>
                  <input
                    id="members"
                    className="input"
                    inputMode="numeric"
                    value={form.members}
                    onChange={(event) => {
                      const value = Number(event.target.value.replace(/[^\d]/g, ""));
                      update("members", Math.max(MIN_MEMBERS, Math.min(MAX_MEMBERS, value || MIN_MEMBERS)));
                    }}
                  />
                  <button type="button" aria-label="More members" onClick={() => update("members", Math.min(MAX_MEMBERS, form.members + 1))}>
                    <Plus size={16} aria-hidden="true" />
                  </button>
                </div>
                <span className="hint">
                  {MIN_MEMBERS}–{MAX_MEMBERS} people · {form.members} turns
                </span>
              </div>
              <div className="field">
                <label htmlFor="amount">Contribution per turn</label>
                <div className="input-group">
                  <input
                    id="amount"
                    className="input mono"
                    inputMode="decimal"
                    autoComplete="off"
                    value={form.amount}
                    aria-invalid={Boolean(showError("amount")) || undefined}
                    aria-describedby="amount-hint"
                    onChange={(event) => update("amount", event.target.value)}
                  />
                  <span className="suffix">{symbol}</span>
                </div>
                <span id="amount-hint" className={showError("amount") ? "error" : "hint"}>
                  {showError("amount") ?? "Fixed for every turn."}
                </span>
              </div>
            </div>

            <div className="field">
              <span id="asset-label" className="field-label" style={{ fontSize: 13, fontWeight: 600 }}>
                Asset
              </span>
              {network.asset ? (
                <div className="callout callout-gold" aria-labelledby="asset-label">
                  <CircleDollarSign size={16} aria-hidden="true" />
                  <span>
                    {network.asset.canonical ? `Circle ${network.asset.symbol}` : network.asset.symbol} on {network.label} · mint{" "}
                    <Address value={network.asset.mint} />
                  </span>
                </div>
              ) : (
                <>
                  <input
                    className="input mono"
                    placeholder="SPL token mint address"
                    aria-labelledby="asset-label"
                    aria-invalid={Boolean(errors.mint) || undefined}
                    value={form.customMint}
                    onChange={(event) => update("customMint", event.target.value)}
                  />
                  <span className={errors.mint ? "error" : "hint"}>
                    {errors.mint ?? `${network.label} has no canonical USDC. Use a classic SPL test token you control.`}
                  </span>
                </>
              )}
            </div>
          </section>

          <section className="form-section" aria-labelledby="schedule">
            <h2 id="schedule">Schedule</h2>
            <p>How long each turn lasts and how much extra time members get before a missed payment can be resolved.</p>
            <div className="field">
              <span style={{ fontSize: 13, fontWeight: 600 }} id="cadence-label">
                Turn length
              </span>
              <div className="segmented" role="group" aria-labelledby="cadence-label">
                {(["weekly", "biweekly", "monthly", "custom"] as const).map((cadence) => (
                  <button key={cadence} type="button" aria-pressed={form.cadence === cadence} onClick={() => update("cadence", cadence)}>
                    {cadence === "weekly" ? "Weekly" : cadence === "biweekly" ? "Every 2 weeks" : cadence === "monthly" ? "Monthly" : "Custom"}
                  </button>
                ))}
              </div>
              {form.cadence === "custom" && (
                <>
                  <DurationInput
                    id="custom-period"
                    value={form.customPeriod}
                    onChange={(value) => update("customPeriod", value)}
                    invalid={Boolean(showError("customPeriod"))}
                  />
                  <span className="hint">Short turns (minutes) are handy for trying Ringio on devnet.</span>
                </>
              )}
            </div>
            <div className="field">
              <label htmlFor="grace">Grace period after each turn</label>
              <DurationInput id="grace" value={form.grace} onChange={(value) => update("grace", value)} units={["minutes", "hours", "days"]} />
              <span className="hint">After the turn length plus grace, missed contributions can be covered or the turn stopped.</span>
            </div>

            <button className="disclosure" type="button" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((value) => !value)} style={{ marginTop: 22 }}>
              <span>
                <strong style={{ fontSize: 14 }}>Setup windows</strong>
                <span className="subtle" style={{ display: "block", fontSize: 12 }}>
                  Joining {formatDuration(joinWindowSeconds ?? 0)} · reveal {formatDuration(revealSeconds ?? 0)} · protection{" "}
                  {formatDuration(collateralSeconds ?? 0)}
                </span>
              </span>
              <ChevronDown size={18} aria-hidden="true" style={{ transform: showAdvanced ? "rotate(180deg)" : undefined }} />
            </button>
            {showAdvanced && (
              <>
                <div className="field">
                  <label htmlFor="join-window">Time to accept invitations</label>
                  <DurationInput id="join-window" value={form.joinWindow} onChange={(value) => update("joinWindow", value)} />
                </div>
                <div className="field">
                  <label htmlFor="reveal-window">Time to reveal secrets once full</label>
                  <DurationInput id="reveal-window" value={form.revealWindow} onChange={(value) => update("revealWindow", value)} />
                </div>
                <div className="field">
                  <label htmlFor="collateral-window">Time to post protection after the draw</label>
                  <DurationInput id="collateral-window" value={form.collateralWindow} onChange={(value) => update("collateralWindow", value)} />
                </div>
              </>
            )}
          </section>
        </div>

        <aside className="card card-highlight summary-card" aria-label="Circle summary">
          <span className="eyebrow">Each turn pays out</span>
          <div className="summary-total">
            <strong className="amount">{pot !== null && decimals !== null ? formatTokenAmount(pot, decimals) : "—"}</strong>
            <span>{symbol}</span>
          </div>
          <p className="muted" style={{ fontSize: 14 }}>
            {periodSeconds ? cadenceText(periodSeconds) : "Custom"} · {form.members} turns · about{" "}
            {periodSeconds ? formatDuration(periodSeconds * form.members) : "—"} in total
          </p>

          <table className="protection-table" style={{ marginTop: 18 }}>
            <thead>
              <tr>
                <th scope="col">If you are paid on</th>
                <th scope="col">Protection to lock</th>
              </tr>
            </thead>
            <tbody>
              {shownRanks.map((rank) =>
                rank === -1 ? (
                  <tr key="gap">
                    <td className="subtle">…</td>
                    <td />
                  </tr>
                ) : (
                  <tr key={rank}>
                    <td>Turn {rank + 1}</td>
                    <td className="amount">
                      {amountRaw && decimals !== null ? formatTokenAmount(collateralRequired(form.members, rank, amountRaw), decimals) : "—"} {symbol}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>

          <div className="callout callout-info" style={{ marginTop: 16 }}>
            <ShieldCheck size={16} aria-hidden="true" />
            <span>
              Payout order is drawn fairly after everyone joins. Keep up to{" "}
              <strong className="amount">{worstCase !== null && decimals !== null ? formatTokenAmount(worstCase, decimals) : "—"}</strong> {symbol}{" "}
              available for protection plus your first contribution.
            </span>
          </div>

          {lowBalance && (
            <div className="callout callout-warning" style={{ marginTop: 10 }}>
              <Info size={16} aria-hidden="true" />
              <span>
                Your wallet holds {formatTokenAmount(balances.data!.token!, decimals!)} {symbol}. You can create the circle now and top up
                before the protection step.
              </span>
            </div>
          )}

          {submitted && programError && (
            <div className="callout callout-danger" style={{ marginTop: 10 }} role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              <span>{programError}</span>
            </div>
          )}

          <dl className="signing-context">
            <div>
              <dt>Network</dt>
              <dd>{network.label}</dd>
            </div>
            <div>
              <dt>Asset mint</dt>
              <dd>{mintAddress ? <Address value={mintAddress} /> : "—"}</dd>
            </div>
            <div>
              <dt>You pay now</dt>
              <dd>Account rent (~0.03 SOL) + fee</dd>
            </div>
          </dl>

          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={Boolean(busy) || !status.ready}>
            {publicKey ? (busy ? "Waiting for wallet…" : "Create circle") : "Connect wallet to create"}
          </button>
          <p className="subtle" style={{ marginTop: 10, fontSize: 12, textAlign: "center" }}>
            You will sign a free message (your payout-draw secret) and then the transaction.
          </p>
        </aside>
      </form>
    </div>
  );
}
