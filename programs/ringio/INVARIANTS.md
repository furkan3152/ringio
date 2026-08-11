# Ringio on-chain invariants

Scope: `programs/ringio` MVP, Anchor 0.32.1, standard SPL Token accounts only.
Amounts are raw mint units. `N = Group.member_count`, `c =
Group.contribution_amount`, `r = Member.payout_rank`, and `q =
Group.current_round`.

This file is an audit checklist, not an audit report. The host tests exercise the
pure arithmetic and ordering properties described below. SBF execution,
transaction-level CPI behavior, compute limits, account-rent behavior, and a
deployed cluster were not tested in this implementation pass.

## State and identity

| ID | Invariant | Enforcement |
| --- | --- | --- |
| S-1 | Every `Group` used by an instruction is the canonical PDA `PDA("group", creator, id)`. | All non-init contexts validate the stored creator, immutable `Group.id`, and bump as PDA seeds. No instruction mutates `creator` or `id`. |
| S-2 | A `Member` is unique per `(group, wallet)`. | Member PDA seeds are `("member", group, wallet)`, and the fixed roster rejects duplicate wallets. |
| S-3 | Joining is invitation-only. | `join_group` requires the canonical unused `Invite` PDA for the signing wallet, then marks it used. |
| S-4 | Terms and roster are immutable once formed. | No update instruction exists for mint, contribution, durations, target member count, roster, or order. |
| S-5 | Legal lifecycle transitions are `Forming -> Revealing -> Collateralizing -> Active -> Completed`, with pre-activation termination to `Cancelled` and uncovered active default to `Defaulted`. | Every handler checks its source `GroupStatus`; terminal states have only refund paths. |
| S-6 | The first global config initializer cannot be an arbitrary first caller. | `initialize_config` verifies the executable program's `ProgramData` account and requires its current upgrade authority to sign. Initialize before revoking upgrade authority. |

`Group.id` intentionally contains no private or AI metadata. It is the stable
on-chain input from which the client can derive a checksummed short display code.
Search descriptions and AI-matching features belong in separately signed,
off-chain public metadata.

## Ordering

| ID | Invariant | Enforcement |
| --- | --- | --- |
| O-1 | A reveal is bound to exactly one group and wallet. | `commitment = SHA256(domain, group, wallet, secret)` and the canonical Member PDA must sign the reveal. |
| O-2 | No caller supplies or overrides the payout permutation. | Once every member reveals, `finalize_order` derives scores from domain-separated aggregate entropy, the group key, and each frozen roster wallet. |
| O-3 | The finalized order contains every member exactly once. | The fixed roster is duplicate-free; `derive_payout_order` rejects zero/duplicate entries and sorts only the first `N` entries with a pubkey tie-break. |
| O-4 | Missing reveals fail closed before custody begins. | Collateralization cannot start until `revealed_count == joined_count == N`; after timeout the group can only cancel. |

Commit-reveal still has abort bias: the last revealer can refuse to reveal after
seeing the prospective entropy. They cannot select a different valid order for
the same frozen commitments, but they can grief this pre-custody group. This MVP
does not claim verifiable randomness. The program rejects an all-zero reveal but
cannot measure entropy; clients must generate a fresh 32-byte secret with an
operating-system CSPRNG and persist it safely until reveal.

## Collateral and round accounting

| ID | Invariant | Formula / enforcement |
| --- | --- | --- |
| V-1 | Rank-aware collateral exactly covers obligations after a member receives the pot. | `locked(r) = c * (N - r - 1)`. All operations are checked; activation requires every member to acknowledge/post and tracked total `c * N * (N - 1) / 2`. |
| V-2 | A round obligation resolves at most once. | `Member.last_contributed_round != q` before direct contribution or collateral coverage; either path then sets it to `q`. |
| V-3 | A round pays only after exactly `N` obligations resolve. | `settle_round` requires `round_contributions == N` and transfers exactly `N * c` to `payout_order[q]`. |
| V-4 | Only already-paid members can have a missed obligation covered. | At round `q`, `cover_default` requires `payout_rank < q`, `payout_received`, and `collateral_locked >= c`. |
| V-5 | Direct post-payout payment and default coverage consume one collateral obligation identically. | Direct: wallet sends `c` to pot and receives `c` from collateral atomically. Default: collateral sends `c` to pot. Both decrement member and group collateral ledgers by `c`. |
| V-6 | A future recipient's uncovered default cannot produce a short payout. | After grace, `abort_uncovered_round` moves the group to `Defaulted`; it cannot settle a partial pot. Current-round direct contributions are refunded, collateral-derived resolutions are restored, then remaining collateral can be refunded. |
| V-7 | Failed-round value is reversed exactly once. | `last_refunded_round` prevents replay. Group `round_contributions` must reach zero before any defaulted-group collateral refund. |
| V-8 | Vault debits have no privileged destination. | Pot debits go only to the fixed round recipient or failed-round member/restoration vault. Collateral debits go only to the contributing/refunding member or the pot for eligible coverage. There is no admin sweep/withdraw instruction. |

The pure exhaustive tests cover `N = 2..32`, multiple contribution magnitudes,
every payout rank, and every feasible count of covered post-payout obligations.
They prove the tested arithmetic identity:

```text
opening_collateral + external_direct_contributions
  = closing_collateral + returned_collateral + round_payout
```

Unsolicited tokens can be transferred directly to an SPL vault without invoking
Ringio. Such excess is deliberately excluded from internal ledgers and remains
stranded; there is no privileged dust sweep because that would create a vault
withdrawal capability. Clients should display tracked amounts separately from
raw vault balances.

## Time and emergency pause

| ID | Invariant | Enforcement |
| --- | --- | --- |
| T-1 | No accepted duration can overflow a later round deadline. | Every individual window is positive and capped at 366 days; creation checks join/reveal/collateral and `now + period + grace` arithmetic before any token custody. |
| T-2 | Contributions are accepted through the period plus grace window. | The direct-contribution cutoff is `round_started_at + period_seconds + grace_seconds`, extended only by the exact paused-time delta below. |
| T-3 | Pause blocks all forward or terminal state changes that could penalize a member who cannot transact. | Create/invite/join/reveal/finalize/post/activate/contribute/cover/settle/abort/cancel all require `paused == false`. |
| T-4 | Refunds remain available while paused. | `refund_failed_round` and `refund_collateral` intentionally do not take `GlobalConfig`. Their destinations and amounts remain deterministic. |
| T-5 | Pausing freezes each in-progress deadline by exactly the completed paused duration, and cannot forgive lateness that existed before the pause. | `GlobalConfig.total_paused_seconds` accumulates only checked `paused_at -> resumed_at` intervals on a real paused-to-unpaused transition. Each Group phase snapshots that cumulative total at phase start. Its effective deadline is `base_deadline + checked_i64(total_paused_seconds - phase_pause_snapshot)`. |
| T-6 | Pause accounting is monotonic and fail-closed. | Repeated `set_paused(true)` and `set_paused(false)` calls are state/timestamp no-ops. A reversed clock, cumulative underflow, `u64 -> i64` conversion failure, or addition overflow rejects the whole instruction. |

The pause authority can delay liveness but cannot redirect custody. For
production it should be a separate Squads multisig with an incident runbook.
Only completed pause intervals enter `total_paused_seconds`; deadline-sensitive
instructions are unavailable during an open interval. `phase_pause_snapshot` is
recorded at group creation and every transition into Revealing,
Collateralizing, Active, and a new active round. Multiple pauses therefore add
only their actual durations. If a deadline was already expired when pause began,
both wall-clock time and the effective deadline advance by the same pause
duration, so it remains expired after resume. The new counters consume reserved
account bytes so the serialized account allocations remain unchanged.

## Token/account boundary

- Vaults are program-created SPL Token accounts whose authority is the canonical
  Group PDA. Every value path validates group, mint, vault address, vault owner,
  member linkage, and destination owner.
- Payouts and refunds may target any classic SPL Token account owned by the
  required recipient/member with the group mint. An associated token account is
  a client convention, not an on-chain requirement.
- Runtime support is classic SPL Token only (`Program<Token>` and
  `Account<Mint/TokenAccount>`). The Cargo feature `token_2022` is enabled only
  because Anchor 0.32.1's token-account `init` derive references its helper
  modules; Token-2022 accounts/program IDs cannot satisfy these contexts.
- The program accepts any classic SPL mint. The official client must restrict
  branded USDC groups to the configured cluster's canonical USDC mint. A mint's
  freeze authority remains an external issuer risk.

## Explicit residual risks and unverified work

- A member who has not received a payout has no guaranteed collateral coverage.
  If that member misses after grace, the circle defaults and unwinds the failed
  round. Invite-only membership is the MVP control for this residual risk.
- No oracle is used because collateral and contributions use the same mint.
- Invite/Member rent is not reclaimed in the MVP; token principal refunds are
  independent of account rent.
- No generated IDL or client was produced here. Any transaction builder and UI
  copy must be reconciled against the generated Anchor 0.32.1 IDL before use.
- QEDGen, Trident, Surfpool, LiteSVM transaction tests, and
  `solana-fender-mcp` were unavailable/not run in this pass. No independent
  audit was performed.
- `cargo test` is a host build only. SBF compilation, validator integration,
  compute-unit profiling, devnet deployment, and live USDC movement remain
  unverified. Do not infer deployment readiness from the host tests.
