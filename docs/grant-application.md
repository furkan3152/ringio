# Ringio — Agentic Engineering Grant Draft

Submission page: <https://superteam.fun/earn/grants/agentic-engineering>

Verified from the public listing on 2026-08-12: the grant is open globally for a fixed `200 USDG`, paid 50% after approval/KYC and 50% after a working Solana product ships. The listing asks for a clear, practical scope and Solana integration; the second-tranche review requires the product URL, GitHub repository, and AI subscription receipt(s) totalling $200. Its custom question asks for the Claude/Codex response files via a Drive link. This draft does not invent unpublished scoring criteria.

Every bracketed item is intentionally unverified and must be completed by the applicant. Statements in the “planned” sections are milestones, not shipped traction.

## Step 1 — Basics

**Project title**

> Ringio

**One-line description**

> Ringio brings invite-only savings circles to Solana with transparent USDC rounds, rank-aware default protection, and privacy-bounded AI group discovery.

**Telegram username**

> [t.me/akdogancoin](https://t.me/akdogancoin)

**Solana wallet address**

> `D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm`

## Step 2 — Details

**Project details**

> Rotating savings and credit associations are widely understood: a trusted group contributes a fixed amount each period and one member receives the combined pot. Their hardest failure mode is also simple: a member who receives an early pot can stop paying into later rounds. Informal ledgers make payment status, payout order, and accountability difficult to verify.
>
> Ringio is an invite-only Solana MVP that makes the roster, terms, contributions, recipient order, collateral, and settlement state inspectable on-chain. Members use a fixed SPL-token mint, commit and reveal entropy for an auditable payout order, and fund position-aware collateral equal to the contributions they will owe after receiving the pot. If an early recipient misses a later deadline, anyone can move exactly one due contribution from an aggregate collateral vault into the round pot while debiting only that member's on-chain collateral ledger. Settlement is permissionless but the program fixes the amount and recipient, so a keeper cannot redirect funds.
>
> The product deliberately separates solvency from liveness. Its Protection Ratio measures only collateral coverage for members who have already received a pot; the dashboard separately shows who has and has not paid. An invite-only roster contains the unresolved MVP risk that a pre-payout member can stall the circle. This is a narrow, testable design—not a claim that smart contracts remove social or credit risk.
>
> The frontend is a Next.js/Tailwind dashboard with a functional Bauhaus visual system, Solana wallet connection, clearly labelled non-signing transaction previews, circle/round state, payer status, current recipient, pot size, and collateral visibility. Ringio Guide adds retrieval-first group discovery: only open eligibility/capacity and an explicitly stated maximum budget are hard filters; cadence, language, location, timing, group size, and other preferences are scored with visible tradeoffs. An optional server-side GPT-4o call through OpenRouter may rerank and explain the bounded candidates. Unknown group codes, malformed model output, provider failure, and a missing API key fall back to deterministic results. Wallets, contact details, invite secrets, and private group data are rejected; the assistant cannot invite users, move funds, or override on-chain membership.
>
> The program is also designed for permissionless crank actions. The checked-in `/api/agent/manifest` exposes read-only/simulation capability metadata, returns no signable transaction, and does not claim Solana Actions compliance. A transaction-capable manifest and hosted keeper are roadmap; member-funded actions remain wallet-approved. A portable, opt-in proof-of-contribution passport is another roadmap built from raw on-chain evidence, not an unverified credit score.

**Why Solana**

> A savings circle produces frequent, small, time-sensitive transfers and benefits from a shared public state. Solana's low transaction costs and account model make one account per circle/member plus program-controlled token vaults practical, while deterministic permissionless instructions let any participant or keeper advance eligible state without a custodial backend. The MVP does not add an oracle or autonomous signer where deterministic program checks are sufficient.

**Current implementation status — verify immediately before submission**

> The repository contains Anchor source for the invite-only Group lifecycle, one pot vault plus one aggregate collateral vault, per-member collateral ledgers, commit-reveal ordering, contributions, post-payout default coverage, permissionless settlement, cumulative exact-duration pause accounting, and terminal refunds. It also contains a Bauhaus Next.js dashboard, Wallet Adapter integration, direct devnet Group/Member/SPL-vault decoding with no mock fallback, exact preset/custom period entry, PDA-derived public group codes, a deterministic bilingual matcher, privacy/input controls, best-effort local rate limiting, optional strict-schema OpenRouter integration, and a non-signing capability manifest. On 2026-08-12, Rust formatting, 16/16 unit tests, clippy with warnings denied, generated IDL, and SBF build passed. Program `JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy` was deployed on devnet; its dumped bytecode exactly matched the local 657,488-byte artifact SHA-256. Canonical config initialization finalized. A real two-member Group then completed two funded rounds against Circle's devnet USDC mint: direct contributions, independent-keeper payouts, a required pre-grace default-cover rejection, post-grace collateral coverage, terminal zero vaults, and combined participant-balance conservation were asserted. The production server decoded this state through confirmed RPC reads. Node 20.19.4 lint/typecheck/build, 17/17 duration/matcher/privacy/binary-decoder tests, HTTP smoke checks, and dependency audit with zero reported vulnerabilities passed. Refresh these results again at the pinned submission commit. Unwired browser financial actions remain explicitly non-signing previews. Exhaustive adversarial CPI tests, wallet transaction builders, and a live OpenRouter response remain open.

**Public proof of work**

> Repository: [github.com/furkan3152/ringio](https://github.com/furkan3152/ringio). Verify that the final `main` commit is publicly visible before submission.
>
> Submission commit: use the final publicly visible `main` commit SHA after running the pinned verification suite.
>
> Live app: [URL or PENDING]
>
> Solana cluster/program: devnet / [`JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy`](https://explorer.solana.com/address/JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy?cluster=devnet)
>
> Explorer evidence: [deploy transaction](https://explorer.solana.com/tx/4maiuv75CBvtT4tSA3TgSbkqsdsgpi1EMmZ1UC9nJ1ygZ1iAi98wZ5tjrhNufaLz4qU7MW8wxqDnsQvqpa4XcKLz?cluster=devnet), [config initialization](https://explorer.solana.com/tx/7PAh5AiNSw1y5CVc2Z3R6QhRoFKqKXsPyNQS6ourx3ccUsi1h7XRYbaBa4vAmSjfZnjBrN87VHY9zpjDo8HXCgS?cluster=devnet), [completed Group](https://explorer.solana.com/address/CZBHgjn1N8Qdqtzi8toJBu3P6XtsCoHW8jegrekaiftt?cluster=devnet), [first payout](https://explorer.solana.com/tx/3fjhfBsRspqf9SRsjZJ6hGkh678FLASoYDrbLCTj2QtmE11EmsH8L37DTXCdZ58BArXGN6KdX8Bw99F4AC4Y8kuD?cluster=devnet), [default coverage](https://explorer.solana.com/tx/5UttRn74AHRqjtgkRzW5VAeyjcp6dUzisKBnDNgGqfs97rto4q8EdSXHHSpxsM35VUEdbKwLqw7aFuWzsWBX2dZq?cluster=devnet), [final payout](https://explorer.solana.com/tx/ed22DsgoAPDWEZ1EvMvxYzUpAL6WVsvhDMrqpGpRJYavQwWK6ifwnvwaP4eeyHKY5WYKwPbYYR6BdNXjcEjfJvk?cluster=devnet).
>
> Demo video: [URL or PENDING]
>
> Verification: `cargo test -p ringio` — 16/16 passed; `npm --prefix web test` — 17/17 passed; `npm run check` — lint, TypeScript, Next 16 production build, Rust format/tests, and Clippy with warnings denied passed; `npm --prefix web audit --audit-level=moderate` — zero reported vulnerabilities.
>
> AI-assisted development transcript: local ignored file `codex-session.jsonl` (current Ringio Codex session, revoked GitHub credential redacted); upload to a public-view Drive folder and paste that link into the custom question.

Do not submit local-only files, mock transaction hashes, a bare deployment with no initialized state, or test results from a different commit as proof of the integrated product.

**Personal X profile**

> [x.com/akdogancoin](https://x.com/akdogancoin)

**Personal GitHub profile**

> [github.com/furkan3152](https://github.com/furkan3152)

**Target deadline**

> 2026-08-18 — final development continues after the grant deadline, but this is the target for the public, browser-signable devnet MVP and evidence package.

**Builder track record**

> **Kletia — flagship project:** I actively maintain [Kletia](https://github.com/furkan3152/Kletia), a network-aware Web3 intent engine and AI-supported superapp infrastructure spanning Base Mainnet and Arc Testnet. A fresh tracked-file measurement found approximately 73,435 source-code lines and 99,079 code/documentation/configuration lines. Its architecture separates network state, intent routing, transaction targets, and safety allowlists instead of presenting cross-chain behavior as one unsafe generic execution path.
>
> **Gençtek Technology Summit:** At 18, while still a high-school student, I presented my blockchain work at Gençtek, a technology summit backed by Türkiye's Ministry of National Education. I demonstrated the project directly to senior education-technology and government stakeholders. [Event photo](https://ibb.co/FkLqrFck). The claim that it was the event's first blockchain project is my event experience and is not presented as independently verified third-party reporting.
>
> **Additional public work:** [FledgeHub](https://github.com/furkan3152/FledgeHub), an on-chain-gm-style Web3 experiment; [GeniusTest](https://github.com/furkan3152/GeniusTest), an interactive Genius ecosystem testing application; and [GeniusAi](https://github.com/Ahmetdenizyildiz/GeniusAi), an AI-agent ecosystem collaboration hosted under another maintainer's repository.

**Crowdedness / comparable-project evidence, if requested by the live form**

> [PUBLIC LINK TO THE REQUESTED CURRENT EVIDENCE]

Do not invent a score. Generate it from the requested service at submission time and preserve a public screenshot/link.

## Skill alignment and deliverables

The public listing labels these skills; this table maps concrete work to them without implying they are scoring criteria.

| Public skill label | Ringio deliverable | Evidence required |
| --- | --- | --- |
| Frontend | Bauhaus Next.js/Tailwind wallet dashboard, AI chat, paid/unpaid grid, recipient/pot/protection state, transaction preview and error states | public app, build output, recorded wallet and fallback-AI flows |
| Blockchain | Anchor state machine, PDAs, SPL vaults, commit-reveal order, collateral coverage, permissionless settlement | source, IDL, tests, devnet program and transactions |
| Backend | Server-only OpenRouter adapter with retrieval-first allowlist/fallback/privacy bounds; optional event projection and keeper remain non-custodial | matcher/API tests, mode-labelled responses, provider evidence if tested; indexer/keeper otherwise marked planned |
| Content | Architecture/threat model, honest risk disclosure, devnet runbook, and concise demo | public docs and video |

## Step 3 — Proposed goals and milestones

Dates are a proposed execution plan, not claims of completion.

**Milestone 1 — Browser-signable protocol client (target 2026-08-14)**

> Wire reviewed Wallet Adapter transaction builders for create/invite/join/reveal/collateral/contribution and deterministic permissionless cranks. Every flow will simulate first, show exact mint/amount/accounts, require the correct wallet signature, and surface rejection/expiry states without fake success.

**Milestone 2 — Multi-wallet funded lifecycle and adversarial test (target 2026-08-16)**

> Fund and operate 5–10 isolated devnet wallets, complete at least one five-member circle from creation through every payout, and exercise duplicate contribution, premature coverage, eligible post-payout default, pre-payout default/unwind, refund, wrong account/mint, and keeper paths. Reconcile participant balances and both PDA vaults after every terminal state.

**Milestone 3 — AI discovery and hosted devnet product (target 2026-08-17)**

> Deploy the Next.js product with a production server-only OpenRouter key, dedicated/rate-limited RPC, deterministic fallback, privacy guardrails, and public-code lookup. Publish a concise demo covering group discovery, wallet signing, live account state, Protection Ratio, and an explorer-linked default cover.

**Milestone 4 — Public release evidence (target 2026-08-18)**

> Publish the source, live app, architecture/threat model, reproducible runbook, pinned test output, completed-circle transaction links, short demo video, retained-authority disclosure, and a capped-value pilot checklist. Clearly separate the August 18 deliverable from post-grant work such as mainnet review, multisig governance, indexer scale, and the opt-in contribution passport.

**Primary KPI (proposed)**

> By 2026-08-18, one explorer-verifiable circle with at least five independently funded devnet wallets completes every round through browser-approved transactions, with 100% of scheduled pot amounts settled to the fixed recipients, at least one eligible missed post-payout contribution replaced from the correct member's collateral by an unrelated keeper, and zero unexplained terminal balance across both program vaults.

This KPI measures the MVP's core mechanism. It is not user traction. If the form asks for a market KPI, provide a separately evidenced pilot target rather than relabelling this as adoption.

**Roadmap after the grant**

> Run an invite-only capped-value pilot; add liveness-safe member replacement or an explicitly priced participation bond; evaluate verifiable randomness; connect signed public group metadata to a read indexer and notifications; measure bilingual matcher quality and bias; publish a versioned transaction-capable agent manifest; and prototype an opt-in portable contribution passport with transparent, Sybil-aware methodology. Mainnet remains gated on independent security review, upgrade/pause governance, measured account/transaction costs, privacy/AI operations, and legal review.

## Reviewer-ready differentiation

- **Protection Ratio:** exact, explainable coverage of remaining post-payout obligations, displayed separately from liveness.
- **Compensatory collateral:** a missed contribution is replaced in the pot instead of burned or redirected as a fee.
- **Keeper-safe automation:** deterministic cranks are permissionless; keepers cannot pick amounts or recipients.
- **Agentic without unsafe custody:** the current manifest is explicitly non-signing metadata; a future reviewed client may simulate/prepare bounded actions and permissionless cranks while user-funded actions remain wallet-approved.
- **Retrieval-first Ringio Guide:** GPT-4o can improve explanation, but eligible groups, economic facts, and codes come from decoded devnet accounts; deterministic fallback keeps discovery usable without a model key.
- **Public code, private access:** a memorable group code makes discovery conversational while on-chain invitations remain the only membership gate.
- **Portable evidence roadmap:** raw contribution/default events can support an opt-in passport without pretending to prove identity or future creditworthiness.

## Submission checklist

- [ ] Replace every bracketed placeholder.
- [ ] Re-open the live grant form and mirror its current field names and limits.
- [ ] Pin one public commit and run all reported commands on that commit.
- [x] Export the current Codex session to ignored `codex-session.jsonl` and verify credential redaction; upload it to Drive before submission.
- [x] Add real devnet program/config/completed-Group addresses plus contribution, payout, and default-cover signatures.
- [ ] Add the live app and video, with mock/devnet mode visibly distinguished.
- [ ] Disclose upgrade and pause authorities.
- [ ] Do not claim mainnet readiness, an audit, traction, real USDC, or a deployed roadmap feature without evidence.
- [ ] If the live form requests a Colosseum project link, repository, AI subscription receipt, or other final-tranche evidence, attach the actual current artifacts.

Submission page: <https://superteam.fun/earn/grants/agentic-engineering>
