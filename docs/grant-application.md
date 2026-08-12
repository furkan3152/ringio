# Ringio — Agentic Engineering Grant Evidence

Submission page: <https://superteam.fun/earn/grants/agentic-engineering>

Verified against the public listing on 2026-08-12: the grant is open globally
for 200 USDG, with 50% paid after approval/KYC and 50% after a working Solana
product ships. The current custom question asks applicants to run the specified
prompt in a solana.new Claude/Codex session and provide the response files
through a Drive link. This public document contains project evidence and the
planned grant scope; personal form fields are intentionally not repeated here.

## One-line description

> Ringio brings Türkiye's Altın Günü savings tradition to Solana with USDC, position-aware collateral, auditable payouts and AI group matching.

## Problem and proposed solution

Rotating savings and credit associations—known in Türkiye as “Altın Günü”—let a
trusted group contribute a fixed amount each period while one member receives
the combined pot. Their hardest failure mode appears after payout: a member who
receives an early pot can stop funding later rounds. Informal ledgers provide
little verifiable evidence of payment state, payout order, or remaining
obligations.

Ringio is an invite-only Solana protocol that represents the roster, terms,
contributions, payout order, collateral, and settlements on-chain. Each member
posts position-aware collateral equal to the contributions they will still owe
after receiving the pot. If an already-paid recipient misses a later
contribution after the grace period, any keeper can replace exactly one due
contribution from that member's collateral ledger into the round pot. The
program fixes the amount and recipient, so the keeper cannot redirect funds.

Commit-reveal ordering prevents one participant from unilaterally choosing the
payout sequence, but Ringio does not claim that contracts remove every social
or credit risk. A member can withhold a reveal and force the documented
abort/refund path. Before receiving a payout, a member cannot extract the pot
but can still stall progress. The MVP contains this liveness risk through
invite-only rosters, explicit acceptance, grace periods, abort/refund paths,
and visible disclosure. Replacement membership and portable reputation remain
post-grant roadmap items.

The Next.js application exposes live devnet Group, Member, mint, and vault state
with no mock fallback. It shows the current recipient, pot, paid/unpaid members,
and a Protection Ratio that separates covered post-payout obligations from
collection health. Ringio Guide retrieves eligible public groups from decoded
on-chain facts and applies deterministic budget and eligibility filters. GPT-4o
through a server-only OpenRouter adapter may rerank or explain the bounded
candidates, but it cannot invite users, decide eligibility, sign transactions,
access private group data, or move funds.

## How AI tools are used

Codex is used as an agentic engineering partner across architecture review,
Anchor invariant design, Rust and TypeScript implementation, test generation,
security checks, devnet runbooks, frontend iteration, and grant evidence
preparation. AI output is not treated as proof: value-flow claims are checked
against explicit invariants, tests, builds, decoded accounts, and
explorer-verifiable transactions.

The grant-funded scope is to complete browser-signable transaction builders,
multi-wallet adversarial testing, hosted deployment, and the public evidence
package by August 18, 2026. The optional OpenRouter model is also bounded by
deterministic filters and authoritative on-chain data.

## Why Solana

Savings circles require frequent, low-value, time-sensitive transfers and a
shared source of truth. Solana's account model and low fees make per-circle and
per-member state plus program-controlled SPL-token vaults practical.
Deterministic permissionless instructions let any participant or keeper advance
eligible state without a custodial operator, while the program enforces exact
amounts, recipients, mint, timing, and account relationships.

## Current execution proof

- Complete source: <https://github.com/furkan3152/ringio>
- Devnet program: <https://explorer.solana.com/address/JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy?cluster=devnet>
- Completed on-chain Group: <https://explorer.solana.com/address/CZBHgjn1N8Qdqtzi8toJBu3P6XtsCoHW8jegrekaiftt?cluster=devnet>
- First payout: <https://explorer.solana.com/tx/3fjhfBsRspqf9SRsjZJ6hGkh678FLASoYDrbLCTj2QtmE11EmsH8L37DTXCdZ58BArXGN6KdX8Bw99F4AC4Y8kuD?cluster=devnet>
- Post-grace collateral coverage: <https://explorer.solana.com/tx/5UttRn74AHRqjtgkRzW5VAeyjcp6dUzisKBnDNgGqfs97rto4q8EdSXHHSpxsM35VUEdbKwLqw7aFuWzsWBX2dZq?cluster=devnet>
- Final payout: <https://explorer.solana.com/tx/ed22DsgoAPDWEZ1EvMvxYzUpAL6WVsvhDMrqpGpRJYavQwWK6ifwnvwaP4eeyHKY5WYKwPbYYR6BdNXjcEjfJvk?cluster=devnet>
- Pinned public CI: <https://github.com/furkan3152/ringio/actions/runs/31541567323>

A real two-member savings group completed two funded rounds using Circle's
devnet USDC mint. The lifecycle included direct contributions, payouts
triggered by an independent keeper, rejection of premature default coverage,
valid post-grace collateral coverage, zero terminal vault balances, and
participant-balance conservation.

The pinned public CI verifies Rust formatting, 16 Rust program unit tests,
Clippy with warnings denied, the IDL feature build, TypeScript, 17 frontend/API
tests, the Next.js production build, and dependency security checks. This is
bounded execution evidence, not an independent audit.

Ringio is currently a devnet, pre-audit MVP. Browser financial actions remain
clearly labelled non-signing previews until reviewed wallet transaction
builders are completed. The optional OpenRouter path has deterministic fallback
and tests but does not yet have final live-provider evidence. Hosted deployment,
a production keeper, multisig authority handoff, and adversarial validator
coverage are not claimed as shipped.

## Previous work

- [Kletia](https://github.com/furkan3152/Kletia): an actively maintained,
  intent-based, AI-supported Web3 infrastructure project with network-aware
  execution paths for Base Mainnet and Arc Testnet.
- [Gençtek Technology Summit](https://ibb.co/FkLqrFck): presentation of
  blockchain work at a major technology event backed by Türkiye's Ministry of
  National Education to senior government and education-technology officials.
- [FledgeHub](https://github.com/furkan3152/FledgeHub): an
  on-chain-gm-style Web3 application.
- [GeniusTest](https://github.com/furkan3152/GeniusTest): an interactive
  application built for the Genius ecosystem.
- [GeniusAi](https://github.com/Ahmetdenizyildiz/GeniusAi): an AI agent
  developed for the TradeGenius ecosystem and published through the builder's
  secondary GitHub account.

## Target and milestones

**Target deadline: August 18, 2026.** Development will continue after this date;
the August 18 deliverable is the public browser-signable devnet MVP and evidence
package.

1. **Browser-signable protocol client — August 14:** wire reviewed Wallet
   Adapter transaction builders for create, invite, join, reveal, collateral,
   contribution, and deterministic permissionless crank operations. Simulate
   before signing and display the exact mint, amounts, accounts, and failure
   states.
2. **Funded multi-wallet lifecycle — August 16:** operate 5–10 isolated devnet
   wallets, complete at least one five-member group through every payout, and
   test duplicate contributions, premature default coverage, eligible
   post-payout default, pre-payout failure/unwind, refunds, wrong-account and
   wrong-mint substitution, and unrelated-keeper execution.
3. **Hosted AI-assisted devnet product — August 17:** deploy the Next.js product
   with a server-only OpenRouter key, dedicated rate-limited RPC, deterministic
   fallback, privacy protections, group-code lookup, and explicit devnet
   labelling.
4. **Public release evidence — August 18:** publish the hosted app, short demo,
   architecture and security boundaries, reproducible runbook, final CI,
   transaction links, authority disclosure, and capped-value pilot checklist.

Primary KPI: by August 18, one explorer-verifiable savings group with at least
five independently funded devnet wallets completes every round through
browser-approved transactions, settles all scheduled pot amounts to their fixed
recipients, covers at least one eligible missed post-payout contribution from
the responsible member's collateral through an unrelated keeper, and ends with
zero unexplained value across both program vaults.

## solana.new response evidence

The Drive package was generated in a separate Codex session from the exact
prompt requested by the current Superteam custom question. It contains the
Codex response, the corresponding credential-pattern-scanned session export, a
README, integrity hashes, and a clearly labelled supplementary Colosseum
landscape report. The Drive package is submission evidence, not a replacement
for the manual form fields.

The custom question does not currently require a Colosseum score. The report is
therefore supplementary and is not described as an endorsement. It found
multiple direct or near-direct ROSCA projects; Ringio is not positioned as the
first ROSCA on Solana. Ringio's differentiation is the exact
remaining-obligation collateral model, member-specific compensatory coverage,
keeper-safe execution, funded devnet conservation proof, and bounded AI
discovery.

For the second tranche, the current listing requires a live product URL, the
GitHub repository, and qualifying AI coding-subscription receipt or receipts
whose displayed total is $200. Ringio will provide those artifacts only when
they exist and will not present devnet evidence as mainnet deployment or
unaudited software as audited.
