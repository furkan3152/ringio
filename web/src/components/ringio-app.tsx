"use client";

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  type CustomPeriodUnit,
  customPeriodSeconds,
  periodLabel,
  presetPeriodSeconds,
} from "@/lib/duration";
import { formatPercent, formatUsdc } from "@/lib/format";
import type { OnchainGroup } from "@/lib/groups/onchain";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Copy,
  ExternalLink,
  Fingerprint,
  Info,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  Plus,
  RefreshCcw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Users,
  WalletCards,
  X,
  Zap,
} from "lucide-react";

type PaymentState = "paid" | "due";
type ViewState = "ready" | "loading" | "empty" | "error";
type TxStage = "idle" | "simulating" | "complete";
type MatchState = "idle" | "loading" | "success" | "empty" | "error";
type MainView = "discover" | "circles" | "safety";

type Member = {
  address: string;
  name: string;
  initials: string;
  wallet: string;
  state: PaymentState;
  paidAt?: string;
  onTime: string;
  isCurrentWallet: boolean;
  payoutReceived: boolean;
};

type Circle = {
  id: string;
  code: string;
  potVault: string;
  name: string;
  cadence: string;
  contribution: number;
  round: number;
  rounds: number;
  dueLabel: string;
  pot: number;
  potTarget: number;
  recipient: string;
  recipientInitials: string;
  collateral: number;
  postPayoutCoverage: number;
  status: OnchainGroup["status"];
  members: Member[];
  payoutOrder: Member[];
};

function shortAddress(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function circleFromGroup(group: OnchainGroup, currentWallet: string): Circle {
  const memberByWallet = new Map(group.members.map((member) => [member.wallet, member]));
  const members = group.members.map((member) => ({
    address: member.wallet,
    name: `Member ${member.joinedIndex + 1}`,
    initials: `M${member.joinedIndex + 1}`,
    wallet: shortAddress(member.wallet),
    state: member.lastContributedRound === group.currentRound ? "paid" as const : "due" as const,
    onTime: member.defaults === 0 ? "No on-chain defaults" : `${member.defaults} on-chain default${member.defaults === 1 ? "" : "s"}`,
    isCurrentWallet: member.wallet === currentWallet,
    payoutReceived: member.payoutReceived,
  }));
  const recipientWallet = group.payoutOrder[group.currentRound];
  const recipientMember = recipientWallet ? memberByWallet.get(recipientWallet) : undefined;
  const coverage = group.totalCollateralLockedUsdc > 0
    ? Math.min(100, (group.collateralVaultBalanceUsdc / group.totalCollateralLockedUsdc) * 100)
    : 0;

  return {
    id: group.accountAddress,
    code: group.code,
    potVault: group.potVault,
    name: group.name,
    cadence: periodLabel(group.periodSeconds),
    contribution: group.contributionUsdc,
    round: Math.min(group.currentRound + 1, group.memberSlots.total),
    rounds: group.memberSlots.total,
    dueLabel: `${group.status} · confirmed devnet account`,
    pot: group.potBalanceUsdc,
    potTarget: group.contributionUsdc * group.memberSlots.total,
    recipient: recipientMember ? `Member ${recipientMember.joinedIndex + 1}` : "Order pending",
    recipientInitials: recipientMember ? `M${recipientMember.joinedIndex + 1}` : "—",
    collateral: group.collateralVaultBalanceUsdc,
    postPayoutCoverage: coverage,
    status: group.status,
    members,
    payoutOrder: group.payoutOrder
      .map((wallet) => members.find((member) => member.address === wallet))
      .filter((member): member is Member => member !== undefined),
  };
}


type MatchCard = {
  groupCode: string;
  name?: string;
  circleName?: string;
  reasons?: string[];
  tradeoffs?: string[];
  contributionUsdc?: number;
  cadence?: string;
  seatsAvailable?: number;
};

type MatchResponse = {
  answer: string;
  mode: string;
  matches: MatchCard[];
};

type ChatEntry = {
  role: "user" | "assistant";
  content: string;
};

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-lockup">
      <svg
        className="brand-mark"
        viewBox="0 0 40 40"
        role="img"
        aria-label="Ringio"
      >
        <circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" strokeWidth="4" />
        <path
          d="M20 6a14 14 0 0 1 12.12 7"
          fill="none"
          stroke="var(--color-primary)"
          strokeLinecap="round"
          strokeWidth="4"
        />
        <circle cx="32.1" cy="13" r="2.4" fill="var(--color-primary)" />
      </svg>
      {!compact && <span>Ringio</span>}
    </span>
  );
}

function StatusDot({ state }: { state: PaymentState }) {
  return (
    <span className={`payment-status payment-status-${state}`}>
      {state === "paid" ? (
        <Check size={13} strokeWidth={2.5} aria-hidden="true" />
      ) : (
        <Clock3 size={13} strokeWidth={2.25} aria-hidden="true" />
      )}
      {state === "paid" ? "Paid" : "Due"}
    </span>
  );
}

function Modal({
  open,
  onClose,
  label,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      className={`modal-shell${wide ? " modal-shell-wide" : ""}`}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

function OrbitPreview() {
  const positions = ["01", "02", "03", "04", "05", "06"];
  return (
    <div className="orbit-card" aria-label="Six-member collateral formula illustration">
      <div className="orbit-topline">
        <span className="live-label">
          <span className="live-dot" aria-hidden="true" /> Protocol model
        </span>
        <span className="mono-note">6 members × 100 USDC</span>
      </div>
      <div className="orbit-visual">
        <div className="orbit-track" aria-hidden="true" />
        {positions.map((position, index) => (
          <span
            key={position}
            className={`orbit-avatar orbit-avatar-${index + 1}${index === 0 ? " orbit-avatar-current" : ""}`}
          >
            {position}
          </span>
        ))}
        <div className="orbit-pot">
          <span>Round pot</span>
          <strong>{formatUsdc(600)}</strong>
          <small>USDC</small>
        </div>
      </div>
      <div className="orbit-footer">
        <div>
          <span>First-position collateral</span>
          <strong>500 USDC</strong>
        </div>
        <div className="shield-stamp">
          <ShieldCheck size={18} aria-hidden="true" />
          Formula, not live account data
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-grid" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading circle data</span>
      <div className="skeleton skeleton-main" />
      <div className="dashboard-side">
        <div className="skeleton skeleton-side" />
        <div className="skeleton skeleton-side skeleton-side-short" />
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="state-panel" aria-labelledby="empty-title">
      <div className="state-icon" aria-hidden="true">
        <Users size={24} />
      </div>
      <h3 id="empty-title">Your first circle starts here</h3>
      <p>
        Create an invite-only group, set the USDC contribution, and share the
        invitation with people you trust.
      </p>
      <button className="button button-primary" type="button" onClick={onCreate}>
        <Plus size={17} aria-hidden="true" />
        Create a circle
      </button>
    </section>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="state-panel state-panel-error" aria-labelledby="error-title">
      <div className="state-icon state-icon-error" aria-hidden="true">
        <TriangleAlert size={24} />
      </div>
      <h3 id="error-title">Couldn&apos;t load circle accounts</h3>
      <p>
        Devnet RPC can be noisy. Retry the account read when the connection
        settles.
      </p>
      <button className="button button-secondary" type="button" onClick={onRetry}>
        <RefreshCcw size={16} aria-hidden="true" />
        Retry account read
      </button>
    </section>
  );
}

function CircleDashboard({
  circle,
  onContribute,
}: {
  circle: Circle;
  onContribute: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const paid = circle.members.filter((member) => member.state === "paid").length;
  const isFunded = circle.pot === circle.potTarget;

  return (
    <div className="dashboard-grid">
      <div className="dashboard-main">
        <section className="panel round-panel" aria-labelledby="round-heading">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Current round</span>
              <h3 id="round-heading">
                Round {circle.round} of {circle.rounds}
              </h3>
            </div>
            <span className={`round-state${isFunded ? " round-state-funded" : ""}`}>
              <span aria-hidden="true" />
              {isFunded ? "Ready to settle" : "Collecting"}
            </span>
          </div>

          <div className="round-progress" aria-label={`Round ${circle.round} of ${circle.rounds}`}>
            {Array.from({ length: circle.rounds }).map((_, index) => {
              const number = index + 1;
              const state =
                number < circle.round
                  ? "done"
                  : number === circle.round
                    ? "current"
                    : "future";
              return (
                <span key={number} className={`round-step round-step-${state}`}>
                  <span>{state === "done" ? <Check size={13} aria-hidden="true" /> : number}</span>
                </span>
              );
            })}
          </div>

          <div className="money-grid">
            <div className="money-block">
              <span>Pot collected</span>
              <strong>{formatUsdc(circle.pot)} <small>USDC</small></strong>
              <div className="meter" aria-label={`${Math.round((circle.pot / circle.potTarget) * 100)} percent funded`}>
                <span style={{ width: `${(circle.pot / circle.potTarget) * 100}%` }} />
              </div>
              <small>{paid} of {circle.members.length} contributions confirmed</small>
            </div>
            <div className="recipient-block">
              <span className="avatar avatar-recipient">{circle.recipientInitials}</span>
              <div>
                <span>This round&apos;s recipient</span>
                <strong>{circle.recipient}</strong>
                <small>Payout unlocks when every contribution lands.</small>
              </div>
              <BadgeCheck size={21} aria-label="Invited member" />
            </div>
          </div>

          <div className="due-strip">
            <div className="due-copy">
              <span className="due-icon" aria-hidden="true">
                {isFunded ? <CheckCircle2 size={20} /> : <CalendarDays size={20} />}
              </span>
              <div>
                <strong>{isFunded ? "All contributions are in" : `${formatUsdc(circle.contribution)} USDC due`}</strong>
                <span>{circle.dueLabel}</span>
              </div>
            </div>
            <button
              className="button button-primary"
              type="button"
              onClick={onContribute}
              disabled={isFunded}
            >
              {isFunded ? "Round funded" : "Review contribution"}
              {!isFunded && <ArrowRight size={16} aria-hidden="true" />}
            </button>
          </div>
        </section>

        <button
          className="detail-disclosure"
          type="button"
          aria-expanded={showDetails}
          aria-controls="round-details"
          onClick={() => setShowDetails((current) => !current)}
        >
          <span>
            <strong>{showDetails ? "Hide round details" : "Show round details"}</strong>
            <small>Decoded Member accounts and committed payout order</small>
          </span>
          <ArrowRight className={showDetails ? "detail-arrow-open" : ""} size={18} aria-hidden="true" />
        </button>

        {showDetails && <section className="panel members-panel" id="round-details" aria-labelledby="members-heading">
          <div className="panel-heading members-heading-row">
            <div>
              <span className="eyebrow">Live contribution ledger</span>
              <h3 id="members-heading">Members</h3>
            </div>
            <span className="member-count">{paid}/{circle.members.length} paid</span>
          </div>
          <div className="member-list" role="list">
            {circle.members.map((member) => (
              <div className="member-row" role="listitem" key={`${circle.id}-${member.wallet}`}>
                <span className={`avatar${member.name === circle.recipient ? " avatar-current" : ""}`}>
                  {member.initials}
                </span>
                <div className="member-identity">
                  <strong>
                    {member.name}
                    {member.name === circle.recipient && <span className="recipient-label">Receiving</span>}
                  </strong>
                  <span className="mono-note">{member.wallet}</span>
                </div>
                <div className="member-proof">
                  <span>{member.onTime}</span>
                  <small>{member.payoutReceived ? "Payout received" : member.state === "paid" ? "Current round confirmed" : "Action needed"}</small>
                </div>
                <StatusDot state={member.state} />
              </div>
            ))}
          </div>
        </section>}
      </div>

      <aside className="dashboard-side" aria-label="Circle protection and activity">
        <section className="shield-card" aria-labelledby="shield-heading">
          <div className="shield-card-top">
            <span className="shield-icon" aria-hidden="true">
              <ShieldCheck size={23} />
            </span>
            <span className="verified-chip"><BadgeCheck size={12} aria-hidden="true" /> SPL vault balance</span>
          </div>
          <span className="eyebrow eyebrow-dark">Commitment Shield</span>
          <h3 id="shield-heading">Post-payout obligations stay covered.</h3>
          <p>
            Members who receive early keep their remaining scheduled obligation
            locked in the circle vault. This cover does not remove program or token risk.
          </p>
          <div className="shield-metric">
            <div>
              <span>Protection reserve</span>
              <strong>{formatUsdc(circle.collateral)} <small>USDC</small></strong>
            </div>
            <span className="coverage-ring">{formatPercent(circle.postPayoutCoverage)}</span>
          </div>
          <a className="text-button text-button-dark" href="/api/agent/manifest" target="_blank" rel="noreferrer">
            View protection scope <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </section>

        {showDetails && <section className="panel compact-panel" aria-labelledby="order-heading">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Verifiable order</span>
              <h3 id="order-heading">Payout queue</h3>
            </div>
            <Fingerprint size={21} aria-label="On-chain payout order" />
          </div>
          <ol className="payout-list">
            {circle.payoutOrder.slice(0, 5).map((member, index) => (
              <li key={`order-${member.wallet}`} className={index + 1 === circle.round ? "payout-current" : ""}>
                <span className="payout-index">{index + 1}</span>
                <span className="avatar avatar-small">{member.initials}</span>
                <span>
                  <strong>{member.name}</strong>
                  <small>
                    {index + 1 < circle.round
                      ? "Settled"
                      : index + 1 === circle.round
                        ? "Current recipient"
                        : `Round ${index + 1}`}
                  </small>
                </span>
                {index + 1 < circle.round && <CheckCircle2 size={17} aria-label="Settled" />}
              </li>
            ))}
          </ol>
        </section>}

        {showDetails && <section className="panel compact-panel" aria-labelledby="activity-heading">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Explorer boundary</span>
              <h3 id="activity-heading">Transaction history</h3>
            </div>
            <a
              className="icon-button"
              href={`https://explorer.solana.com/address/${circle.id}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              aria-label="Open Solana Explorer on devnet"
            >
              <ExternalLink size={17} aria-hidden="true" />
            </a>
          </div>
          <p className="demo-disclaimer">
            <Info size={14} aria-hidden="true" /> No activity is invented. Open the Group account in Explorer; a signature index will be added before production.
          </p>
        </section>}
      </aside>
    </div>
  );
}

const MATCH_PROMPTS = [
  "Weekly, maximum 200 USDC",
  "Monthly circle with 6–8 members",
  "Biweekly, under 250 USDC",
];

function Matchmaker() {
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const [state, setState] = useState<MatchState>("idle");
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [lastMessage, setLastMessage] = useState("");
  const [fieldError, setFieldError] = useState("");

  async function requestMatch(nextMessage: string) {
    const cleanMessage = nextMessage.trim();
    if (!cleanMessage) {
      setFieldError("Describe the cadence, amount, or payout timing you prefer.");
      return;
    }

    setFieldError("");
    setLastMessage(cleanMessage);
    setState("loading");
    setResult(null);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch("/api/ai/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: cleanMessage, history }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Match service returned ${response.status}`);
      }

      const payload = (await response.json()) as Partial<MatchResponse>;
      const normalized: MatchResponse = {
        answer:
          typeof payload.answer === "string"
            ? payload.answer
            : "No explanation was returned.",
        mode: typeof payload.mode === "string" ? payload.mode : "catalog",
        matches: Array.isArray(payload.matches) ? payload.matches : [],
      };

      setResult(normalized);
      setHistory((current) => [
        ...current,
        { role: "user", content: cleanMessage },
        { role: "assistant", content: normalized.answer },
      ]);
      setMessage("");
      setState(normalized.matches.length ? "success" : "empty");
    } catch {
      setState("error");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void requestMatch(message);
  }

  return (
    <section className="matchmaker-section" aria-labelledby="matchmaker-heading">
      <div className="matchmaker-copy">
        <span className="section-index" aria-hidden="true">01—A</span>
        <span className="eyebrow">AI circle matchmaker</span>
        <h2 id="matchmaker-heading">Find a circle that fits your rhythm.</h2>
        <p>
          Describe how often you want to save, your comfortable USDC amount,
          and preferred member count. Ringio compares only decoded, eligible
          Solana devnet Group accounts and never fills missing metadata with invented facts.
        </p>
        <div className="matchmaker-boundary">
          <ShieldCheck size={19} aria-hidden="true" />
          <p>
            <strong>Privacy boundary</strong>
            <span>Do not enter wallet addresses, phone numbers, seed phrases, or private information.</span>
          </p>
        </div>
      </div>

      <div className="matchmaker-console">
        <div className="console-header">
          <div>
            <span className="console-mark" aria-hidden="true"><MessageCircle size={18} /></span>
            <div><strong>Ringio Guide</strong><span>On-chain match · not financial advice</span></div>
          </div>
          <span className="console-status"><span aria-hidden="true" /> Online</span>
        </div>

        <div className="prompt-chips" aria-label="Sample match prompts">
          {MATCH_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => {
                setMessage(prompt);
                setFieldError("");
              }}
              disabled={state === "loading"}
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="match-output" aria-live="polite" aria-busy={state === "loading"}>
          {state === "idle" && (
            <div className="match-idle">
              <SlidersHorizontal size={24} aria-hidden="true" />
              <p><strong>Start with your constraints</strong><span>Try a sample above or write your own in plain English.</span></p>
            </div>
          )}

          {state === "loading" && (
            <div className="match-loading">
              <div className="match-thinking"><LoaderCircle className="spin" size={17} aria-hidden="true" /> Comparing transparent circle rules…</div>
              <div className="match-card-skeleton" />
              <div className="match-card-skeleton match-card-skeleton-short" />
            </div>
          )}

          {state === "error" && (
            <div className="match-error" role="alert">
              <TriangleAlert size={22} aria-hidden="true" />
              <div><strong>Matchmaker is unavailable</strong><span>Your prompt was not saved. Retry, or adjust it and send again.</span></div>
              <button className="button button-secondary" type="button" onClick={() => void requestMatch(lastMessage)}>
                <RefreshCcw size={16} aria-hidden="true" /> Retry
              </button>
            </div>
          )}

          {state === "empty" && result && (
            <div className="match-empty">
              <Info size={22} aria-hidden="true" />
              <div><span className="mode-badge">Mode · {result.mode}</span><strong>No responsible match yet</strong><p>{result.answer || "No eligible on-chain circle meets those constraints."}</p></div>
              <button className="text-button" type="button" onClick={() => { setState("idle"); setResult(null); setMessage(""); }}>
                Clear constraints <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          )}

          {state === "success" && result && (
            <div className="match-success">
              <div className="match-answer">
                <span className="mode-badge">Mode · {result.mode}</span>
                <p>{result.answer}</p>
              </div>
              <div className="match-grid" role="list" aria-label="Suggested savings circles">
                {result.matches.map((match, index) => (
                  <article className="match-card" role="listitem" key={`${match.groupCode}-${index}`}>
                    <div className="match-card-head">
                      <div><span>Solana devnet · Match {String(index + 1).padStart(2, "0")}</span><h3>{match.name ?? match.circleName ?? "Savings circle"}</h3></div>
                      <div className="group-code-wrap"><span className="group-code">{match.groupCode}</span><small>Public discovery ID · not an invite</small></div>
                    </div>
                    {(match.contributionUsdc != null || match.cadence || match.seatsAvailable != null) && (
                      <div className="match-facts">
                        {match.contributionUsdc != null && <span><strong>{formatUsdc(match.contributionUsdc)}</strong> USDC</span>}
                        {match.cadence && <span>{match.cadence}</span>}
                        {match.seatsAvailable != null && <span>{match.seatsAvailable} seats open</span>}
                      </div>
                    )}
                    <div className="match-reason-grid">
                      <div><strong>Why it fits</strong><ul>{(match.reasons ?? ["Rules align with the stated constraints."]).map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
                      <div><strong>Tradeoffs</strong><ul>{(match.tradeoffs ?? ["Review every circle rule before joining."]).map((tradeoff) => <li key={tradeoff}>{tradeoff}</li>)}</ul></div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>

        <form className="match-form" onSubmit={handleSubmit}>
          <label htmlFor="match-message">What should your savings circle look like?</label>
          <div className="match-input-row">
            <textarea
              id="match-message"
              name="message"
              rows={3}
              maxLength={280}
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                setFieldError("");
              }}
              placeholder="Example: Weekly, around 150 USDC, Turkish speakers, and 6–8 members."
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? "match-error" : "match-hint"}
              disabled={state === "loading"}
            />
            <button className="send-button" type="submit" disabled={state === "loading"} aria-label="Send match request">
              {state === "loading" ? <LoaderCircle className="spin" size={19} aria-hidden="true" /> : <Send size={19} aria-hidden="true" />}
            </button>
          </div>
          <div className="match-form-meta">
            <span id={fieldError ? "match-error" : "match-hint"} className={fieldError ? "field-error" : "field-hint"}>
              {fieldError || "Catalog suggestions only. You decide whether to join."}
            </span>
            <span className="character-count">{message.length} / 280</span>
          </div>
        </form>
      </div>
    </section>
  );
}

type CreateFormState = {
  name: string;
  members: string;
  contribution: string;
  cadence: "weekly" | "monthly" | "custom";
  durationValue: string;
  durationUnit: CustomPeriodUnit;
  startDate: string;
  access: "invite" | "public";
};

function CreateCircleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<CreateFormState>({
    name: "",
    members: "",
    contribution: "",
    cadence: "weekly",
    durationValue: "",
    durationUnit: "days",
    startDate: "",
    access: "invite",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof CreateFormState, string>>>({});
  const [submitNotice, setSubmitNotice] = useState("");

  const memberCount = Number(form.members) || 0;
  const contribution = Number(form.contribution) || 0;
  const pot = memberCount * contribution;
  const maxCollateral = Math.max(0, (memberCount - 1) * contribution);
  const periodSeconds = form.cadence === "custom"
    ? customPeriodSeconds(form.durationValue, form.durationUnit)
    : presetPeriodSeconds(form.cadence);
  const cadenceLabel = periodSeconds ? periodLabel(periodSeconds) : "custom interval";

  function update<Key extends keyof CreateFormState>(key: Key, value: CreateFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Partial<Record<keyof CreateFormState, string>> = {};
    if (form.name.trim().length < 3) nextErrors.name = "Use at least 3 characters.";
    if (memberCount < 3 || memberCount > 12) nextErrors.members = "Choose between 3 and 12 members.";
    if (contribution < 10 || contribution > 10000) nextErrors.contribution = "Choose an amount from 10 to 10,000 USDC.";
    if (form.cadence === "custom" && periodSeconds === null) {
      nextErrors.durationValue = "Enter a whole-number duration up to 366 days.";
    }
    if (!form.startDate) nextErrors.startDate = "Choose a start date.";

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      const firstKey = Object.keys(nextErrors)[0];
      const firstField = event.currentTarget.elements.namedItem(firstKey);
      if (firstField instanceof HTMLElement) firstField.focus();
      return;
    }

    setSubmitNotice("Terms validated locally. No account was created: the wallet transaction builder is the next implementation step.");
  }

  function closeAndReset() {
    onClose();
    setSubmitNotice("");
  }

  return (
    <Modal open={open} onClose={closeAndReset} label="Create a savings circle" wide>
      <div className="modal-card create-modal">
        <div className="modal-header">
          <div>
            <span className="eyebrow">Invite-only by default</span>
            <h2>Create a savings circle</h2>
            <p>Set the shared rules once. Ringio makes every contribution and payout visible.</p>
          </div>
          <button className="icon-button" type="button" onClick={closeAndReset} aria-label="Close create circle dialog">
            <X size={19} aria-hidden="true" />
          </button>
        </div>

        <form className="create-form" onSubmit={handleSubmit} noValidate>
            <div className="form-columns">
              <div className="form-fields">
                <div className="field-group">
                  <label htmlFor="name">Circle name <span>(required)</span></label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    autoComplete="off"
                    spellCheck="true"
                    value={form.name}
                    onChange={(event) => update("name", event.target.value)}
                    aria-invalid={Boolean(errors.name)}
                    aria-describedby={errors.name ? "name-error" : "name-hint"}
                  />
                  <p id={errors.name ? "name-error" : "name-hint"} className={errors.name ? "field-error" : "field-hint"}>
                    {errors.name ?? "A familiar name your group will recognize."}
                  </p>
                </div>

                <div className="field-pair">
                  <div className="field-group">
                    <label htmlFor="members">Members <span>(required)</span></label>
                    <input
                      id="members"
                      name="members"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      spellCheck="false"
                      value={form.members}
                      onChange={(event) => update("members", event.target.value)}
                      aria-invalid={Boolean(errors.members)}
                      aria-describedby={errors.members ? "members-error" : "members-hint"}
                    />
                    <p id={errors.members ? "members-error" : "members-hint"} className={errors.members ? "field-error" : "field-hint"}>
                      {errors.members ?? "3–12 people"}
                    </p>
                  </div>
                  <div className="field-group">
                    <label htmlFor="contribution">Contribution <span>(USDC)</span></label>
                    <div className="input-suffix">
                      <input
                        id="contribution"
                        name="contribution"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck="false"
                        value={form.contribution}
                        onChange={(event) => update("contribution", event.target.value)}
                        aria-invalid={Boolean(errors.contribution)}
                        aria-describedby={errors.contribution ? "contribution-error" : "contribution-hint"}
                      />
                      <span>USDC</span>
                    </div>
                    <p id={errors.contribution ? "contribution-error" : "contribution-hint"} className={errors.contribution ? "field-error" : "field-hint"}>
                      {errors.contribution ?? "Fixed for every round"}
                    </p>
                  </div>
                </div>

                <fieldset className="field-group">
                  <legend>Cadence</legend>
                  <div className="radio-grid">
                    <label className="radio-card">
                      <input
                        type="radio"
                        name="cadence"
                        value="weekly"
                        checked={form.cadence === "weekly"}
                        onChange={() => update("cadence", "weekly")}
                      />
                      <span><CalendarDays size={18} aria-hidden="true" /><strong>Weekly</strong><small>Fast, familiar rhythm</small></span>
                    </label>
                    <label className="radio-card">
                      <input
                        type="radio"
                        name="cadence"
                        value="monthly"
                        checked={form.cadence === "monthly"}
                        onChange={() => update("cadence", "monthly")}
                      />
                      <span><CalendarDays size={18} aria-hidden="true" /><strong>Monthly</strong><small>Lower-frequency saving</small></span>
                    </label>
                    <label className="radio-card">
                      <input
                        type="radio"
                        name="cadence"
                        value="custom"
                        checked={form.cadence === "custom"}
                        onChange={() => update("cadence", "custom")}
                      />
                      <span><SlidersHorizontal size={18} aria-hidden="true" /><strong>Custom</strong><small>Choose an exact interval</small></span>
                    </label>
                  </div>
                  {form.cadence === "custom" && (
                    <div className="custom-duration-row">
                      <div>
                        <label htmlFor="durationValue">Interval <span>(required)</span></label>
                        <input
                          id="durationValue"
                          name="durationValue"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete="off"
                          spellCheck="false"
                          value={form.durationValue}
                          onChange={(event) => update("durationValue", event.target.value)}
                          aria-invalid={Boolean(errors.durationValue)}
                          aria-describedby={errors.durationValue ? "duration-error" : "duration-hint"}
                        />
                      </div>
                      <div>
                        <label htmlFor="durationUnit">Unit</label>
                        <select
                          id="durationUnit"
                          name="durationUnit"
                          value={form.durationUnit}
                          onChange={(event) => update("durationUnit", event.target.value as CustomPeriodUnit)}
                        >
                          <option value="minutes">Minutes</option>
                          <option value="hours">Hours</option>
                          <option value="days">Days</option>
                          <option value="weeks">Weeks</option>
                        </select>
                      </div>
                      <p id={errors.durationValue ? "duration-error" : "duration-hint"} className={errors.durationValue ? "field-error" : "field-hint"}>
                        {errors.durationValue ?? "Stored on-chain as exact seconds · maximum 366 days"}
                      </p>
                    </div>
                  )}
                </fieldset>

                <div className="field-group">
                  <label htmlFor="startDate">First contribution date <span>(required)</span></label>
                  <input
                    id="startDate"
                    name="startDate"
                    type="date"
                    autoComplete="off"
                    value={form.startDate}
                    onChange={(event) => update("startDate", event.target.value)}
                    aria-invalid={Boolean(errors.startDate)}
                    aria-describedby={errors.startDate ? "date-error" : "date-hint"}
                  />
                  <p id={errors.startDate ? "date-error" : "date-hint"} className={errors.startDate ? "field-error" : "field-hint"}>
                    {errors.startDate ?? "Members can fund collateral after accepting their invite."}
                  </p>
                </div>
              </div>

              <aside className="form-summary" aria-label="Circle economics preview">
                <span className="form-summary-icon" aria-hidden="true"><CircleDollarSign size={23} /></span>
                <span className="eyebrow">Circle economics</span>
                <h3>{formatUsdc(pot)} <small>USDC</small></h3>
                <p>Expected payout every {cadenceLabel}</p>
                <dl>
                  <div><dt>Members</dt><dd>{memberCount || "—"}</dd></div>
                  <div><dt>Total rounds</dt><dd>{memberCount || "—"}</dd></div>
                  <div><dt>Exact period</dt><dd>{periodSeconds ? `${periodSeconds.toLocaleString("en-US")} sec` : "—"}</dd></div>
                  <div><dt>Max early-recipient collateral</dt><dd>{formatUsdc(maxCollateral)} USDC</dd></div>
                  <div><dt>Access</dt><dd>Invite only</dd></div>
                </dl>
                <div className="protection-note">
                  <ShieldCheck size={18} aria-hidden="true" />
                  <p><strong>Post-payout obligation protection</strong><span>Required collateral decreases as future contributions are paid.</span></p>
                </div>
                <p className="demo-disclaimer"><Info size={14} aria-hidden="true" /> Economics preview only; no chain data is fabricated.</p>
              </aside>
            </div>
            <div className="form-actions">
              <button className="button button-ghost" type="button" onClick={closeAndReset}>Cancel</button>
              <button className="button button-primary" type="submit">
                <Plus size={17} aria-hidden="true" /> Preview on-chain terms
              </button>
            </div>
            {submitNotice && <p className="demo-disclaimer" role="status"><Info size={14} aria-hidden="true" /> {submitNotice}</p>}
          </form>
      </div>
    </Modal>
  );
}

function TransactionModal({
  open,
  onClose,
  circle,
}: {
  open: boolean;
  onClose: () => void;
  circle: Circle;
}) {
  const { connected, publicKey } = useWallet();
  const [stage, setStage] = useState<TxStage>("idle");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (stage !== "simulating") return;
    const timer = window.setTimeout(() => setStage("complete"), 1400);
    return () => window.clearTimeout(timer);
  }, [stage]);

  function closeAndReset() {
    onClose();
    window.setTimeout(() => setStage("idle"), 200);
  }

  async function copyVault() {
    await navigator.clipboard.writeText(circle.potVault);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const sender = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : "Connect a wallet to resolve";

  return (
    <Modal open={open} onClose={closeAndReset} label="Contribution transaction preview">
      <div className="modal-card transaction-modal">
        <div className="modal-header">
          <div>
            <span className="eyebrow">Demo preview · no RPC simulation</span>
            <h2>Contribution preview</h2>
            <p>Review every effect before a wallet signature is ever requested.</p>
          </div>
          <button className="icon-button" type="button" onClick={closeAndReset} aria-label="Close transaction preview">
            <X size={19} aria-hidden="true" />
          </button>
        </div>

        <div className="transaction-amount">
          <span>You contribute</span>
          <strong>{formatUsdc(circle.contribution)} <small>USDC</small></strong>
          <span>to {circle.name}</span>
        </div>

        <dl className="transaction-breakdown">
          <div><dt>From</dt><dd className="mono-note">{sender}</dd></div>
          <div>
            <dt>On-chain pot vault</dt>
            <dd>
              <span className="mono-note">{shortAddress(circle.potVault)}</span>
              <button className="copy-button" type="button" onClick={copyVault} aria-label="Copy full vault address">
                {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </dd>
          </div>
          <div><dt>Indicative network fee</dt><dd className="mono-note">~0.000005 SOL</dd></div>
          <div><dt>Priority fee</dt><dd>None</dd></div>
          <div className="transaction-total"><dt>Total debit</dt><dd>{formatUsdc(circle.contribution)} USDC + network fee</dd></div>
        </dl>

        <div className="simulation-result">
          <Sparkles size={19} aria-hidden="true" />
          <p><strong>Expected result</strong><span>Your contribution fills the round to {circle.members.length}/{circle.members.length}; the round becomes eligible for permissionless settlement.</span></p>
        </div>

        {stage !== "idle" && (
          <ol className="tx-timeline" aria-live="polite">
            <li className="tx-done"><span><Check size={13} aria-hidden="true" /></span><p><strong>Demo fields prepared</strong><small>Intended effects: USDC transfer + contribution record</small></p></li>
            <li className={stage === "complete" ? "tx-done" : "tx-active"}>
              <span>{stage === "complete" ? <Check size={13} aria-hidden="true" /> : <LoaderCircle className="spin" size={13} aria-hidden="true" />}</span>
              <p><strong>Preview checks</strong><small>{stage === "complete" ? "Demo preview complete · no RPC simulation was run" : "Checking the local demo inputs…"}</small></p>
            </li>
            <li className="tx-muted"><span>3</span><p><strong>Wallet signature</strong><small>Not requested in this product demo</small></p></li>
          </ol>
        )}

        {!connected && (
          <div className="wallet-callout">
            <WalletCards size={19} aria-hidden="true" />
            <div><strong>Connect to resolve your sender account</strong><span>No transaction will be sent from this preview.</span></div>
            <WalletMultiButton className="wallet-button wallet-button-modal" />
          </div>
        )}

        <div className="modal-actions">
          <button className="button button-ghost" type="button" onClick={closeAndReset}>Cancel</button>
          {stage === "complete" ? (
            <button className="button button-success" type="button" onClick={closeAndReset}>
              <CheckCircle2 size={17} aria-hidden="true" /> Preview checks complete
            </button>
          ) : (
            <button className="button button-primary" type="button" onClick={() => setStage("simulating")} disabled={stage === "simulating"} aria-busy={stage === "simulating"}>
              {stage === "simulating" ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Zap size={17} aria-hidden="true" />}
              {stage === "simulating" ? "Checking preview…" : "Run demo preview"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ProtectionView({ onOpenCircles }: { onOpenCircles: () => void }) {
  return (
    <section className="safety-view" id="safety" aria-labelledby="safety-heading">
      <div className="safety-intro">
        <div>
          <span className="eyebrow">Default protection, without wallet promises</span>
          <h1 id="safety-heading">Wallet balance is not collateral.</h1>
          <p>
            A member can move wallet funds or revoke an allowance. Ringio only
            counts USDC already transferred into a program-controlled vault.
          </p>
        </div>
        <span className="demo-badge"><Info size={13} aria-hidden="true" /> Example explains the program formula · dashboard data comes only from devnet</span>
      </div>

      <div className="fund-flow" aria-label="How Ringio protects a six member circle">
        <article className="fund-state fund-state-wallet">
          <span className="fund-state-icon"><WalletCards size={22} aria-hidden="true" /></span>
          <span className="eyebrow">Personal wallet</span>
          <strong>Movable at any time</strong>
          <p>Visible balance is useful context, but it cannot guarantee a future payment.</p>
          <small>Not counted as protection</small>
        </article>
        <ArrowRight className="fund-flow-arrow" size={24} aria-hidden="true" />
        <article className="fund-state fund-state-vault">
          <span className="fund-state-icon"><LockKeyhole size={22} aria-hidden="true" /></span>
          <span className="eyebrow">Ringio PDA vault</span>
          <strong>500 USDC locked</strong>
          <p>First recipient in a 6-person, 100 USDC circle locks five future payments.</p>
          <small>Controlled by program rules</small>
        </article>
        <ArrowRight className="fund-flow-arrow" size={24} aria-hidden="true" />
        <article className="fund-state fund-state-covered">
          <span className="fund-state-icon"><ShieldCheck size={22} aria-hidden="true" /></span>
          <span className="eyebrow">Missed after payout</span>
          <strong>100 USDC covered</strong>
          <p>The missed installment moves from locked collateral into the round pot.</p>
          <small>No debit from the empty wallet</small>
        </article>
      </div>

      <div className="protection-example">
        <div className="example-copy">
          <span className="section-index" aria-hidden="true">06 × 100</span>
          <span className="eyebrow">Concrete example</span>
          <h2>Receive 600 now. Keep 500 committed.</h2>
          <p>
            Before receiving the first 600 USDC pot, that recipient has paid the
            current 100 USDC contribution and locked another 500 USDC. Each later
            direct contribution returns one 100 USDC collateral slice atomically.
          </p>
          <button className="button button-primary" type="button" onClick={onOpenCircles}>
            See the round overview <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
        <dl className="risk-boundaries">
          <div>
            <dt><CheckCircle2 size={17} aria-hidden="true" /> Covered</dt>
            <dd>An early recipient stops paying after receiving the pot.</dd>
          </div>
          <div>
            <dt><TriangleAlert size={17} aria-hidden="true" /> Fails closed</dt>
            <dd>A member who has not received a payout refuses to pay. The short pot is never paid; the round defaults and refundable funds remain claimable.</dd>
          </div>
          <div>
            <dt><Info size={17} aria-hidden="true" /> Honest tradeoff</dt>
            <dd>Guaranteeing every member regardless of timing requires pre-funding every future installment, which removes most of the credit benefit.</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

export function RingioApp() {
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58() ?? null;
  const [mainView, setMainView] = useState<MainView>("discover");
  const [circles, setCircles] = useState<Circle[]>([]);
  const [loadedWallet, setLoadedWallet] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewState, setViewState] = useState<ViewState>("empty");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [transactionOpen, setTransactionOpen] = useState(false);

  const displayedCircles = loadedWallet === walletAddress ? circles : [];
  const effectiveViewState: ViewState = !walletAddress
    ? "empty"
    : loadedWallet === walletAddress
      ? viewState
      : "loading";
  const selectedCircle =
    displayedCircles.find((circle) => circle.id === selectedId) ?? displayedCircles[0] ?? null;

  const activeCircles = displayedCircles.filter((circle) => circle.status === "active");
  const dueAmount = activeCircles.reduce(
    (total, circle) => total + (circle.members.some((member) => member.isCurrentWallet && member.state === "due") ? circle.contribution : 0),
    0,
  );
  const lockedCollateral = displayedCircles.reduce((total, circle) => total + circle.collateral, 0);

  useEffect(() => {
    function syncViewFromHash() {
      const hash = window.location.hash.slice(1);
      if (hash === "discover" || hash === "circles" || hash === "safety") {
        setMainView(hash);
      }
    }

    syncViewFromHash();
    window.addEventListener("hashchange", syncViewFromHash);
    return () => window.removeEventListener("hashchange", syncViewFromHash);
  }, []);

  useEffect(() => {
    if (!walletAddress) {
      return;
    }

    const controller = new AbortController();
    fetch(`/api/groups?wallet=${encodeURIComponent(walletAddress)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Group RPC returned ${response.status}`);
        return response.json() as Promise<{ groups: OnchainGroup[] }>;
      })
      .then(({ groups }) => {
        const next = groups.map((group) => circleFromGroup(group, walletAddress));
        setCircles(next);
        setLoadedWallet(walletAddress);
        setSelectedId((current) => next.some((circle) => circle.id === current) ? current : next[0]?.id ?? null);
        setViewState(next.length > 0 ? "ready" : "empty");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCircles([]);
        setLoadedWallet(walletAddress);
        setSelectedId(null);
        setViewState("error");
      });

    return () => controller.abort();
  }, [walletAddress, reloadNonce]);

  function retry() {
    setReloadNonce((current) => current + 1);
  }

  function openView(view: MainView) {
    setMainView(view);
    window.history.replaceState(null, "", `#${view}`);
    window.requestAnimationFrame(() => {
      document.getElementById("app-view")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <button className="logo-link" type="button" aria-label="Open Ringio discovery" onClick={() => openView("discover")}><Logo /></button>
        <nav className="primary-nav" aria-label="Primary navigation">
          <button type="button" aria-pressed={mainView === "discover"} onClick={() => openView("discover")}>Find a circle</button>
          <button type="button" aria-pressed={mainView === "circles"} onClick={() => openView("circles")}>My circles</button>
          <button type="button" aria-pressed={mainView === "safety"} onClick={() => openView("safety")}>Funds protection</button>
        </nav>
        <div className="header-actions">
          <a
            className="network-pill"
            href="https://explorer.solana.com/?cluster=devnet"
            target="_blank"
            rel="noreferrer"
            aria-label="View Solana devnet explorer"
          >
            <span aria-hidden="true" /> Devnet
          </a>
          <WalletMultiButton className="wallet-button" />
        </div>
      </header>

      <main id="app-view">
        {mainView === "discover" && <>
        <section className="hero-section" aria-labelledby="hero-heading">
          <div className="hero-copy">
            <div className="hero-kicker"><Sparkles size={15} aria-hidden="true" /> Community finance, legible by design</div>
            <h1 id="hero-heading">Save in turns.<br /><span>Settle in public.</span></h1>
            <p>
              Ringio brings the familiar savings circle on-chain. Pool USDC with
              people you know, follow every round, and keep early payouts
              collateral-backed after payout.
            </p>
            <div className="hero-actions">
              <button className="button button-primary button-large" type="button" onClick={() => openView("circles")}>
                Open my circles <ArrowRight size={17} aria-hidden="true" />
              </button>
              <button className="button button-secondary button-large" type="button" onClick={() => setCreateOpen(true)}>
                <Plus size={17} aria-hidden="true" /> Create a circle
              </button>
            </div>
            <div className="hero-proof" role="list" aria-label="Ringio benefits">
              <span role="listitem"><CheckCircle2 size={16} aria-hidden="true" /> USDC-native</span>
              <span role="listitem"><CheckCircle2 size={16} aria-hidden="true" /> Invite-only groups</span>
              <span role="listitem"><CheckCircle2 size={16} aria-hidden="true" /> Transparent rounds</span>
            </div>
          </div>
          <div className="hero-visual"><OrbitPreview /></div>
        </section>

        <section className="trust-strip" id="how-it-works" aria-label="How Ringio works">
          <div><span>01</span><p><strong>Agree once</strong><small>Members accept the amount, cadence, and commit–reveal payout order.</small></p></div>
          <div><span>02</span><p><strong>Contribute each round</strong><small>USDC lands in a program-controlled vault, visible to everyone.</small></p></div>
          <div><span>03</span><p><strong>Narrow the post-payout gap</strong><small>Early recipients remain collateralized until their scheduled obligations are paid.</small></p></div>
        </section>

        <Matchmaker />
        </>}

        {mainView === "circles" && <section className="dashboard-section" id="circles" aria-labelledby="dashboard-heading">
          <div className="dashboard-intro">
            <div>
              <span className="eyebrow">Personal command center</span>
              <h2 id="dashboard-heading">Your savings circles</h2>
              <p>Track contributions, protection, and upcoming payouts in one place.</p>
              <span className="demo-badge"><BadgeCheck size={13} aria-hidden="true" /> Verified Solana devnet account reads · no mock fallback</span>
            </div>
            <div className="dashboard-actions">
              <button className="button button-primary" type="button" onClick={() => setCreateOpen(true)}>
                <Plus size={17} aria-hidden="true" /> New circle
              </button>
            </div>
          </div>

          <div className="summary-grid" aria-label="Savings summary">
            <div><span>Active circles</span><strong>{activeCircles.length}</strong><small>Decoded for the connected wallet</small></div>
            <div><span>Current-round amount due</span><strong>{formatUsdc(dueAmount)} <small>USDC</small></strong><small>Computed from Member accounts</small></div>
            <div><span>Locked in collateral vaults</span><strong>{formatUsdc(lockedCollateral)} <small>USDC</small></strong><small><ShieldCheck size={14} aria-hidden="true" /> Read from SPL Token vault balances</small></div>
          </div>

          <div className="circle-switcher" role="group" aria-label="Active savings circles">
            {displayedCircles.map((circle) => (
              <button
                key={circle.id}
                className={selectedId === circle.id ? "circle-tab circle-tab-active" : "circle-tab"}
                type="button"
                aria-pressed={selectedId === circle.id}
                onClick={() => {
                  setSelectedId(circle.id);
                }}
              >
                <span className="circle-tab-icon"><Users size={17} aria-hidden="true" /></span>
                <span><strong>{circle.name}</strong><small>{circle.members.length} members · {circle.cadence}</small></span>
                <span className="circle-tab-round">R{circle.round}/{circle.rounds}</span>
              </button>
            ))}
          </div>

          {effectiveViewState === "loading" && <DashboardSkeleton />}
          {effectiveViewState === "empty" && <EmptyState onCreate={() => setCreateOpen(true)} />}
          {effectiveViewState === "error" && <ErrorState onRetry={retry} />}
          {effectiveViewState === "ready" && selectedCircle && (
            <CircleDashboard circle={selectedCircle} onContribute={() => setTransactionOpen(true)} />
          )}
        </section>}

        {mainView === "safety" && <ProtectionView onOpenCircles={() => openView("circles")} />}
      </main>

      <footer className="site-footer">
        <Logo />
        <p>Community savings infrastructure on Solana.</p>
        <div>
          <span className="network-pill"><span aria-hidden="true" /> Devnet MVP</span>
          <a href="https://explorer.solana.com/?cluster=devnet" target="_blank" rel="noreferrer">Explorer <ExternalLink size={14} aria-hidden="true" /></a>
        </div>
      </footer>

      <CreateCircleModal open={createOpen} onClose={() => setCreateOpen(false)} />
      {selectedCircle && <TransactionModal open={transactionOpen} onClose={() => setTransactionOpen(false)} circle={selectedCircle} />}
    </div>
  );
}
