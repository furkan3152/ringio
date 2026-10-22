"use client";

import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Compass,
  Info,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Users,
} from "lucide-react";

import { CircleCard, CircleCardSkeleton } from "@/components/circles/circle-card";
import { useNetwork } from "@/components/providers/network-provider";
import { EmptyState } from "@/components/ui/primitives";
import { RingDial, type RingNode } from "@/components/ui/ring-dial";
import { useNow } from "@/hooks/use-now";
import { useOpenCircles, useProgramStatus } from "@/hooks/use-ringio";
import { circleDeadlines } from "@/lib/ringio/lifecycle";
import { Guide } from "./guide";

const EXAMPLE_NODES: RingNode[] = [
  { key: "1", label: "01", state: "received", title: "Turn 1 · paid out" },
  { key: "2", label: "02", state: "received", title: "Turn 2 · paid out" },
  { key: "3", label: "03", state: "recipient", title: "Turn 3 · receiving now" },
  { key: "4", label: "04", state: "paid", title: "Turn 4 · contributed" },
  { key: "5", label: "05", state: "paid", title: "Turn 5 · contributed" },
  { key: "6", label: "06", state: "due", title: "Turn 6 · contribution due" },
];

function Hero() {
  const { network } = useNetwork();
  return (
    <section className="page hero" aria-labelledby="hero-title">
      <div>
        <span className="eyebrow">
          <Sparkles size={14} aria-hidden="true" /> Altın günü, on-chain
        </span>
        <h1 id="hero-title">
          Save together.
          <br />
          <span className="accent">Get paid in turns.</span>
        </h1>
        <p className="hero-lead">
          Ringio turns the savings circle you already trust into a transparent Solana program. Everyone contributes the
          same {network.asset?.symbol ?? "stablecoin"} amount each turn, one member receives the pot, and early
          recipients stay protected by collateral until they have paid every turn.
        </p>
        <div className="hero-actions">
          <Link className="btn btn-primary btn-lg" href="/create">
            Start a circle <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link className="btn btn-secondary btn-lg" href="/circles">
            My circles
          </Link>
        </div>
        <div className="hero-proof">
          <span>
            <CheckCircle2 size={15} aria-hidden="true" /> Funds held by program vaults, not people
          </span>
          <span>
            <CheckCircle2 size={15} aria-hidden="true" /> Fair, verifiable payout order
          </span>
          <span>
            <CheckCircle2 size={15} aria-hidden="true" /> Mainnet, devnet & testnet
          </span>
        </div>
      </div>

      <div className="hero-visual">
        <div className="card card-highlight hero-visual-card">
          <div className="hero-visual-meta">
            <span>Example circle · 6 members</span>
            <span className="mono">100 USDC / week</span>
          </div>
          <RingDial
            nodes={EXAMPLE_NODES}
            progress={2 / 6}
            label="Example six-member circle on its third turn"
            center={
              <>
                <span>Turn 3 pot</span>
                <strong className="amount">600</strong>
                <small>USDC to member 03</small>
              </>
            }
          />
          <div className="hero-visual-foot">
            <div className="mini-stat">
              <span>Paid out</span>
              <strong>2 of 6</strong>
            </div>
            <div className="mini-stat">
              <span>This turn</span>
              <strong>5/6 in</strong>
            </div>
            <div className="mini-stat">
              <span>Protection</span>
              <strong>Locked</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    title: "Invite people you know",
    body: "Pick the amount, the turn length, and the size of the circle. Only wallets you invite can join.",
  },
  {
    title: "Draw a fair order",
    body: "Every member commits a secret when joining. Once all are revealed, the program derives the payout order — nobody can rig it.",
  },
  {
    title: "Lock protection",
    body: "Members who receive early lock collateral for the turns they still owe. Later recipients lock less; the last locks nothing.",
  },
  {
    title: "Contribute & get paid",
    body: "Each turn everyone pays in, and anyone can trigger the payout to the next member. Protection is returned as you keep paying.",
  },
];

function HowItWorks() {
  return (
    <section className="page section" id="how-it-works" aria-labelledby="how-title">
      <div className="section-head">
        <div>
          <span className="eyebrow">How it works</span>
          <h2 id="how-title">A circle in four steps</h2>
          <p>The rules are set once at creation and enforced by the Ringio program for every turn.</p>
        </div>
      </div>
      <div className="steps-grid">
        {STEPS.map((step, index) => (
          <article key={step.title} className="card step-card">
            <span className="step-index">{String(index + 1).padStart(2, "0")}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Protection() {
  const rows = [0, 1, 2, 3, 4, 5].map((rank) => ({ turn: rank + 1, locked: (5 - rank) * 100 }));
  return (
    <section className="page section" id="protection" aria-labelledby="protection-title">
      <div className="section-head">
        <div>
          <span className="eyebrow">Protection</span>
          <h2 id="protection-title">Early payouts stay covered</h2>
          <p>
            The real risk in a savings circle is someone taking the pot early and then disappearing. Ringio makes that
            exposure explicit and locks it up front.
          </p>
        </div>
      </div>
      <div className="protection-grid">
        <div className="card card-pad">
          <span className="eyebrow eyebrow-muted">Example · 6 members × 100 USDC</span>
          <table className="protection-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th scope="col">Payout turn</th>
                <th scope="col">Locked as protection</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.turn}>
                  <td>Turn {row.turn}</td>
                  <td style={{ width: "45%" }}>
                    <div className="bar">
                      <span style={{ width: `${(row.locked / 500) * 100}%` }} />
                    </div>
                  </td>
                  <td className="amount">{row.locked} USDC</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="subtle" style={{ marginTop: 14, fontSize: 13 }}>
            Collateral = contribution × turns still owed after your payout. Each later contribution releases one slice.
          </p>
        </div>
        <div className="card card-pad">
          <ul className="risk-list">
            <li>
              <span className="risk-icon risk-icon-success">
                <ShieldCheck size={16} aria-hidden="true" />
              </span>
              <span>
                <strong>Covered</strong>A member who already received the pot stops paying: after the grace period, their
                locked collateral pays the turn instead.
              </span>
            </li>
            <li>
              <span className="risk-icon risk-icon-danger">
                <TriangleAlert size={16} aria-hidden="true" />
              </span>
              <span>
                <strong>Fails safely</strong>A member who has not been paid yet stops paying: the turn is stopped, its
                contributions are refunded, and all remaining protection is returned.
              </span>
            </li>
            <li>
              <span className="risk-icon risk-icon-info">
                <LockKeyhole size={16} aria-hidden="true" />
              </span>
              <span>
                <strong>No admin keys on funds</strong>Vaults are program-derived accounts. The pause authority can halt
                progress but can never move or redirect funds; refunds keep working while paused.
              </span>
            </li>
            <li>
              <span className="risk-icon risk-icon-info">
                <Info size={16} aria-hidden="true" />
              </span>
              <span>
                <strong>Honest limits</strong>Ringio is pre-audit software. Protection does not remove smart-contract,
                stablecoin, or wallet risk.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function OpenCircles() {
  const { network } = useNetwork();
  const status = useProgramStatus();
  const open = useOpenCircles();
  const now = useNow();
  const visible = (open.data ?? []).filter((snapshot) => {
    if (!status.config || now === 0) return true;
    return circleDeadlines(snapshot.group, status.config).join >= now && snapshot.group.joinedCount < snapshot.group.memberCount;
  });

  return (
    <section className="page section" id="open-circles" aria-labelledby="open-title">
      <div className="section-head">
        <div>
          <span className="eyebrow">Live on {network.label}</span>
          <h2 id="open-title">Circles forming now</h2>
          <p>
            These circles are still filling seats. Joining is invite-only: share your wallet address with the organizer
            and they can invite you.
          </p>
        </div>
        {status.ready && (
          <button className="btn btn-secondary" type="button" onClick={() => open.refresh()} disabled={open.refreshing}>
            <RefreshCw size={15} className={open.refreshing ? "spin" : undefined} aria-hidden="true" /> Refresh
          </button>
        )}
      </div>

      {!status.ready && !status.loading ? (
        <EmptyState icon={<Compass size={24} aria-hidden="true" />} title={`Ringio is not live on ${network.label} yet`}>
          Switch networks from the header to browse circles on a network where the program is deployed.
        </EmptyState>
      ) : open.loading || status.loading ? (
        <div className="circle-grid">
          <CircleCardSkeleton />
          <CircleCardSkeleton />
          <CircleCardSkeleton />
        </div>
      ) : open.error && !open.data ? (
        <EmptyState
          icon={<TriangleAlert size={24} aria-hidden="true" />}
          title="Couldn't load circles"
          action={
            <button className="btn btn-secondary" type="button" onClick={() => open.refresh()}>
              Try again
            </button>
          }
        >
          The RPC endpoint did not respond. Public endpoints rate-limit heavy reads; a dedicated RPC URL fixes this.
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Users size={24} aria-hidden="true" />}
          title="No circles are forming right now"
          action={
            <Link className="btn btn-primary" href="/create">
              Start the first one
            </Link>
          }
        >
          Start one and invite the people you already save with.
        </EmptyState>
      ) : (
        <div className="circle-grid">
          {visible.map((snapshot) => (
            <CircleCard
              key={snapshot.group.address}
              snapshot={snapshot}
              callout={`${snapshot.group.memberCount - snapshot.group.joinedCount} seat${snapshot.group.memberCount - snapshot.group.joinedCount === 1 ? "" : "s"} open`}
              calloutTone="info"
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <OpenCircles />
      <Protection />
      <Guide />
    </>
  );
}
