# Ringio Devnet Runbook

This runbook separates five claims:

1. **Frontend layer:** the UI renders decoded Group/Member/Invite/vault state for the selected cluster, fails empty/error rather than substituting mock rows, and builds, simulates, and wallet-signs every Ringio instruction (`npm --prefix web run test:svm` runs those builders against the deployed bytecode). Mainnet-beta and testnet deployment is covered in `docs/mainnet-deployment.md`.
2. **Rust unit verification:** pure state/math tests pass; this does not execute token CPIs.
3. **Local integration verification:** Anchor tests pass against a local validator and exercise real account constraints/CPIs.
4. **Devnet integration:** the UI reads a deployed program and submitted transactions are explorer-verifiable.
5. **AI discovery:** deterministic catalog matching can pass locally without proving that an OpenRouter request succeeded; live model mode requires a server-side key and a response labelled `openrouter`.

Passing one layer does not prove the next one.

Current repository boundary: Rust 1.89 formatting, 16/16 unit tests, clippy with warnings denied, generated IDL, and SBF build pass. Program ID `JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy` is synchronized and deployed on devnet; downloaded bytecode exactly matches the local artifact hash. The canonical config is initialized. On 2026-08-12, a two-member Group completed a funded two-round Circle-devnet-USDC lifecycle with an independent keeper, one collateral-covered default, zero terminal vault balances, and participant-balance conservation. Node 20.19.4 frontend lint/typecheck/build, 17/17 duration/matcher/privacy/binary-decoder tests, dependency audit with zero reported vulnerabilities, and real Group/API/AI HTTP smoke checks pass. Exhaustive LiteSVM/malicious-account coverage and a live OpenRouter response remain open.

## 1. Prerequisites

Use the repository-pinned Node.js `20.19.4` and Rust `1.89.0`, plus Anchor CLI `0.32.1`, a compatible Solana CLI, and SPL Token CLI. Do not silently upgrade the framework/toolchain in a release run.

```bash
rustc --version
cargo --version
solana --version
anchor --version
node --version
npm --version
spl-token --version
```

Use a dedicated devnet deployer outside the repository. Never commit its seed phrase or JSON keypair. Prefer explicit `--keypair` and `--url` arguments over changing a personal global Solana configuration. Confirm the active address and cluster before every deploy:

```bash
solana address
solana config get
solana balance --url devnet
```

Fund only devnet fees:

```bash
solana airdrop 2 "$(solana address)" --url devnet
solana balance --url devnet
```

Devnet airdrops are rate-limited and unreliable. A failed airdrop is not a program failure.

## 2. Repository preflight

From the Ringio workspace root:

```bash
git status --short
find . -maxdepth 3 -type f \( -name Anchor.toml -o -name Cargo.toml -o -name package.json -o -name .env.example \) -print
```

Record the commit used for evidence:

```bash
git rev-parse HEAD
```

If the workspace root is not a Git repository in a copied/demo environment, record the commit from the actual repository directory and disclose which files it covers. Do not fabricate a repository-wide commit.

## 3. Verify locally first

Program checks, when the Anchor workspace is present:

```bash
cargo test -p ringio
anchor build
anchor keys list
anchor test
```

Frontend checks:

```bash
npm --prefix web ci
npm --prefix web run lint
npm --prefix web run typecheck
npm --prefix web run test
npm --prefix web run build
```

Record exact output in the release notes. Expected minimum test scenarios:

- create, invite, join/commit, reveal, and finalize a group;
- require the executable Ringio program, canonical ProgramData, and current upgrade-authority signer for `initialize_config`;
- reject duplicate member and duplicate reveal;
- reject an all-zero reveal and verify commitments are bound to both Group and wallet;
- reject economic-term mutation and any roster addition after the fixed roster is full;
- require exact rank-aware collateral before activation;
- reject wrong mint, authority, PDA, amount, round, and recipient accounts;
- accept one contribution per member per round and reject a duplicate;
- reject early `cover_default` and coverage for an ineligible pre-payout member;
- cover one eligible missed contribution from the aggregate vault while debiting only that member's collateral ledger;
- reject early/incomplete settlement and prevent double payout;
- complete all rounds with zero unexplained pot/collateral balance, and refund only amounts eligible in terminal failure/cancel states;
- verify pause blocks progression, settlement, default handling, and cancellation while both refund instructions remain callable;
- verify `total_paused_seconds` increases by exactly each completed real paused interval and repeated same-state calls add zero;
- verify each Forming/Revealing/Collateralizing/Active/new-round start records `phase_pause_snapshot`, and each effective boundary is its base deadline plus only the cumulative paused-time delta since that snapshot;
- verify a pause begun after an expired boundary leaves it expired, while multiple valid pauses extend a live boundary by exactly the sum of actual paused durations;
- exercise pre-activation cancel, active default/failed-round refund, and collateral-refund boundaries.

Do not deploy until `anchor build` generates an IDL from this source and that IDL is reconciled with the architecture, client, and tests at the same commit.

## 4. Program identity and deployment

Generate or select the intended program keypair once. Then synchronize declarations before a public deployment:

```bash
anchor keys list
anchor keys sync
anchor build
```

`anchor keys sync` changes source/configured IDs. Review the exact diff. Ringio's current generated program identity is `JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy`.

Review the resulting program ID in all of these places:

- `declare_id!` in the program;
- `[programs.devnet]` in `Anchor.toml`;
- generated IDL/client address;
- frontend environment;
- demo and grant evidence.

Deploy explicitly to devnet:

```bash
anchor deploy --provider.cluster devnet
```

Verify the executable account and note the upgrade authority:

```bash
solana program show "[PROGRAM_ID]" --url devnet
```

Save the deploy signature and explorer URL. A successful `anchor deploy` does not initialize `GlobalConfig` and does not prove business instructions work.

Verified 2026-08-11 devnet release:

| Item | Value |
| --- | --- |
| Program | `JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy` |
| ProgramData | `7bR8BT4bLvnMta4ULy5z4rgBVJvLG824LKTQhRD71VPy` |
| Deploy signature | `4maiuv75CBvtT4tSA3TgSbkqsdsgpi1EMmZ1UC9nJ1ygZ1iAi98wZ5tjrhNufaLz4qU7MW8wxqDnsQvqpa4XcKLz` |
| Deploy slot | `483002026` |
| Artifact bytes / SHA-256 | `657488` / `c6a8367a70bab933f61220deb0fc7133229d2b876ee5b6e980530b778a874ee9` |

`solana program dump` produced the same byte count and SHA-256 as `target/deploy/ringio.so`. The authority is deliberately retained for this pre-audit devnet pilot and must be disclosed; this is not an immutable or mainnet deployment.

## 5. Select the devnet settlement mint

The repository currently configures Circle's six-decimal Solana Devnet USDC mint:

```text
4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
```

Verify it against Circle's current contract-address page before each public deployment: <https://developers.circle.com/stablecoins/usdc-contract-addresses>. Devnet USDC has no financial value. Fund test wallets through an official/current faucet flow; do not assume a local wallet can mint it.

For isolated testing, or when the official faucet is unavailable, a dedicated six-decimal self-minted token is acceptable. Label it `self-minted demo token`, never Circle USDC. The example below creates it on devnet; use an explicit localhost URL instead for a local validator:

```bash
spl-token create-token --decimals 6 --url devnet
```

Copy the returned local mint into a task-specific shell variable:

```bash
RINGIO_DEMO_MINT="[MINT_ADDRESS]"
spl-token create-account "$RINGIO_DEMO_MINT" --url devnet
spl-token mint "$RINGIO_DEMO_MINT" 100000 --url devnet
spl-token supply "$RINGIO_DEMO_MINT" --url devnet
```

For each participant, create/fund a correct-mint classic SPL token account through the wallet or SPL CLI. An associated token account is the recommended client convention, but the program authorizes by token-account owner and mint rather than ATA derivation. Verify owner, mint, decimals, and raw balance before using it.

For a self-minted local/test asset only, disabling mint authority makes the test supply fixed:

```bash
spl-token authorize "$RINGIO_DEMO_MINT" mint --disable --url devnet
```

That action is irreversible for the mint. Run it only after confirming the exact address.

## 6. Initialize protocol state

After an upgradeable deployment, use `web/scripts/initialize-config.ts` to call `initialize_config` once with the intended pause authority. The accounts include the executable Ringio program, its canonical ProgramData account, and the current upgrade-authority signer; that signer becomes the stored admin. The mint is not approved by `GlobalConfig`; each `create_group` binds its own immutable mint, and the client is responsible for matching the intended USDC address. Fetch and decode `GlobalConfig`; do not treat a transaction signature alone as proof.

```bash
npm --prefix web run initialize:config -- --keypair /absolute/path/to/devnet-deployer.json --rpc https://api.devnet.solana.com
```

Evidence to record:

| Item | Value |
| --- | --- |
| Cluster | `devnet` |
| Program ID | `JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy` |
| Upgrade authority | dedicated repo-external devnet authority, retained |
| Config PDA | `G4TPLwPbZf8Exwm4zNtHeEngB56SuFXRtbhRTjD5LKis` |
| Config authority | same verified upgrade authority |
| Initialization signature | `7PAh5AiNSw1y5CVc2Z3R6QhRoFKqKXsPyNQS6ourx3ccUsi1h7XRYbaBa4vAmSjfZnjBrN87VHY9zpjDo8HXCgS` |
| IDL/build commit | `[COMMIT]` |

The initializer is deliberately separate from deploy so authority and ProgramData checks can be independently verified. It exits without a second transaction when the config PDA already exists.

## 7. Frontend configuration

Use the exact variable names in the checked-in example environment file. A typical program-connected setup needs values equivalent to:

```dotenv
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_RINGIO_PROGRAM_ID=[PROGRAM_ID]
NEXT_PUBLIC_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU

# Server-only; omit for deterministic matcher fallback.
OPENROUTER_API_KEY=[SERVER_ONLY_KEY]
OPENROUTER_MODEL=openai/gpt-4o
OPENROUTER_SITE_URL=https://your-app.example
OPENROUTER_ZDR=false
```

These are the names in the checked-in root `.env.example`; reconcile code and example together if they change. Public RPC URLs and program IDs are not secrets. Private RPC API keys must not use a `NEXT_PUBLIC_` variable.

Never expose `OPENROUTER_API_KEY` through a `NEXT_PUBLIC_` variable. With the key omitted, `/api/ai/match` must deterministically rank eligible decoded Group accounts or return an honest empty result. With the key present, verify the returned mode instead of inferring model use from natural-sounding text. Do not enter wallet addresses, contact details, invite secrets, seed phrases, or private group text during either test.

Run the client:

```bash
npm --prefix web run dev
```

Verify in the browser:

- wallet network and UI network both say devnet;
- the displayed program ID and mint match the deployed values;
- no placeholder Group, member, payment, or balance appears when RPC data is empty or unavailable;
- every unwired create/contribution action says `Preview` or `Simulation` and clearly states that no RPC simulation/signature occurred;
- decoded Group, Member, mint, pot-vault, and collateral-vault facts come from confirmed devnet reads;
- transaction previews show amount, mint, program, action, scheduled owner, and selected owner-controlled token account where applicable;
- after a real confirmation, the UI refetches finalized/confirmed account state rather than assuming success;
- after real client integration, RPC failure, wallet rejection, simulation failure, blockhash expiry, and program error remain distinguishable.

## 8. End-to-end devnet smoke test

Use four controlled test wallets and the flow below. Generate a separate 32-byte secret per wallet with a CSPRNG, persist it privately until reveal confirms, and keep it outside logs and the repository. The program rejects an all-zero reveal; a wallet address, timestamp, group code, or human password is not acceptable entropy.

1. `create_group`: four members, fixed amount, short demo period, verified devnet mint, and the creator's domain-bound commitment.
2. `invite_member`: add each explicit wallet once.
3. `join_group`: consume each invite and submit a domain-bound commitment; the full roster enters Revealing.
4. Confirm economic terms remained immutable from creation and no later member can join.
5. `reveal_secret`: reveal and verify all commitments.
6. `finalize_order`: call from a non-creator wallet; fetch the resulting order.
7. `post_collateral`: fund position requirements `3c`, `2c`, `1c`, `0c`; reconcile member ledgers to the aggregate vault.
8. `activate_group`: verify round zero and its start/deadline.
9. `contribute`: submit exactly `c` from every member; attempt one duplicate and record rejection.
10. `settle_round`: call from an unrelated wallet; verify exactly `4c` reaches a correct-mint token account owned by the scheduled recipient. The account need not be its ATA.
11. In a later round, let that recipient miss the deadline.
12. `cover_default`: call from an unrelated wallet; verify exactly `c` leaves the aggregate collateral vault, only the defaulter's ledger decreases, and the pot increases by `c`.
13. `settle_round`: verify the next recipient still receives `4c`.
14. Complete the remaining rounds and verify terminal refunds/account state.

For every step, save the signature and decode the before/after accounts. Explorer UI is useful evidence but not a substitute for programmatic assertions.

### First live Group checkpoint

The checked-in `smoke:create-group` script created the first real forming Group without logging or committing its CSPRNG reveal secret:

| Item | Value |
| --- | --- |
| Group / public code | `CckMHZ6kys4E5GeP1C1swcD7SrHqsDUvBQ9bp9RHdUd5` / `RNG-AC98E6751838` |
| Settlement mint | Circle devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Terms | 2 members, 1 USDC, weekly, 7-day join window |
| Create signature | `42FQfAriEvPfYWUfxNLPpoKr7gSYKG2VbwTvh2V4AwGoDcG45RJ4GegUEHkBgZUru284836PNGW3y7MRcnf8AHeG` |
| Verified state | `Forming`, 1/2 seats, empty pot and collateral vaults |

This first checkpoint proves deployment, initialization, account creation, direct RPC decoding, and deterministic AI discovery. The later funded checkpoint below proves one bounded lifecycle; neither is an audit.

### Funded two-round E2E checkpoint

`web/scripts/devnet-e2e.ts` requires deployer, participant, keeper, and resumable state files outside the repository. It rejects repository-local key/state paths and never prints reveal secrets. Run `prepare`, fund both official-mint ATAs if required, then run `complete`:

```bash
npm --prefix web run e2e:devnet -- --phase prepare --deployer /absolute/deployer.json --participant /absolute/participant.json --keeper /absolute/keeper.json --state-file /absolute/e2e-state.json
npm --prefix web run e2e:devnet -- --phase complete --deployer /absolute/deployer.json --participant /absolute/participant.json --keeper /absolute/keeper.json --state-file /absolute/e2e-state.json
```

Verified public evidence:

| Item | Value |
| --- | --- |
| Completed Group | [`CZBHgjn1N8Qdqtzi8toJBu3P6XtsCoHW8jegrekaiftt`](https://explorer.solana.com/address/CZBHgjn1N8Qdqtzi8toJBu3P6XtsCoHW8jegrekaiftt?cluster=devnet) |
| Terms | 2 members, 1 devnet USDC, 90-second period, 15-second grace |
| Round 0 direct contributions | [`5zdiLv…6ctDS`](https://explorer.solana.com/tx/5zdiLv8YcRtafzHN1ru4EJzLUE8LhWu9F4YxzUuunbugjV8LPVeBuyngXRkCH1jXZAEBKLqKwqC73i8QpND6ctDS?cluster=devnet), [`AWudBp…Cn1fy`](https://explorer.solana.com/tx/AWudBp3E9uQ1G22nrHzo1NXTc8YubJVtNKCprJajGZxb85SB4Uhi8YBHrWvVVZNeQR31GUUgZhLqZcfkR1Cn1fy?cluster=devnet) |
| Round 0 payout | [`3fjhfB…Y8kuD`](https://explorer.solana.com/tx/3fjhfBsRspqf9SRsjZJ6hGkh678FLASoYDrbLCTj2QtmE11EmsH8L37DTXCdZ58BArXGN6KdX8Bw99F4AC4Y8kuD?cluster=devnet) |
| Round 1 direct contribution | [`2YW2f6…H273u`](https://explorer.solana.com/tx/2YW2f62h3GRisUF8kAX12bYbxJzaa1rqHDtewSza638g1hc2sygZWuvKWc6ABm9H3G8q6yib3SjKWeM42aAH273u?cluster=devnet) |
| Post-grace collateral cover | [`5UttRn…X2dZq`](https://explorer.solana.com/tx/5UttRn74AHRqjtgkRzW5VAeyjcp6dUzisKBnDNgGqfs97rto4q8EdSXHHSpxsM35VUEdbKwLqw7aFuWzsWBX2dZq?cluster=devnet) |
| Final payout / status | [`ed22Ds…EjfJvk`](https://explorer.solana.com/tx/ed22DsgoAPDWEZ1EvMvxYzUpAL6WVsvhDMrqpGpRJYavQwWK6ifwnvwaP4eeyHKY5WYKwPbYYR6BdNXjcEjfJvk?cluster=devnet) / `Completed` |
| Programmatic terminal assertions | pot `0`, collateral `0`, combined participant balance `20,000,000` raw units, one recorded default |

The harness first simulates a pre-grace `cover_default` and requires `GracePeriodActive`; it sends the real cover only after the chain clock crosses the grace boundary. A single successful scenario does not replace local-validator rollback and crafted-account tests.

## 9. Permissionless keeper check

The keeper wallet must be unrelated to creator and members and hold only enough SOL for fees. It should be able to submit deterministic crank actions without access to member secrets:

- `finalize_order` after all reveals;
- `activate_group` after all collateral requirements are satisfied;
- `cover_default` only after an eligible deadline;
- `settle_round` only after all obligations are accounted;
- `abort_uncovered_round` only after grace elapses with an unresolved pre-payout member.

Test each instruction both before and after its eligibility condition. A keeper that merely calls at the right time is not a trusted backend. It may supply one of the scheduled wallet's correct-mint token accounts, but cannot change the recipient owner or payout amount.

## 10. Release evidence and rollback

Before sharing the demo, complete:

| Check | Evidence |
| --- | --- |
| Local Anchor tests | command, pass count, commit |
| Frontend lint/build | command, output, commit |
| Deterministic AI matcher | command, pass count, direct-code/PII/fallback cases |
| Live OpenRouter mode | server log/request ID without prompt or key, response mode, model; otherwise `not tested` |
| Program deployment | program ID, deploy signature, upgrade authority |
| Protocol initialization | config PDA and transaction |
| Happy-path round | contribution and settlement signatures |
| Default path | rejected early cover, valid cover, settlement signatures |
| UI integration | screen capture with network/program/mint visible |

If a safety issue appears, use `set_paused` only if the deployed implementation and authority are verified. Pause blocks all lifecycle progression and termination—including settlement, coverage, abort, and cancellation—but does not block `refund_failed_round` or `refund_collateral`. On resume, verify that `total_paused_seconds` increased by only the actual paused interval and that the Group's effective deadline moved by the same delta from its phase snapshot. An already-expired boundary must remain expired. Publish the affected program ID and state; do not redeploy under a new ID without updating the UI and evidence. Upgrade/deploy rollback is not state rollback.

## 11. Current limitations to disclose

- Devnet tokens have no monetary value and devnet can reset or degrade.
- Read-only deployed-account integration is not proof that the unwired wallet transaction previews can move funds.
- The generated IDL and SBF artifact live under ignored `target/`; reproduce them from pinned source and compare dumped deployed bytes before an upgrade.
- A deterministic AI result is not proof that OpenRouter or GPT-4o was called.
- Group codes and availability are derived from direct confirmed-RPC reads; without an indexer, discovery latency and public-RPC availability remain operational risks.
- The MVP's collateral guarantee covers post-payout obligations, not pre-payout liveness.
- Commit-reveal has a last-revealer abort risk.
- Permissionless cranks still require an external transaction and fee payer.
- A deployed upgradeable program retains upgrade-authority risk.
- The pause authority can delay liveness indefinitely while paused, although cumulative paused-time accounting must not grant extra unpaused time or revive expired boundaries.
- Passing repository tests is not an independent security audit or mainnet approval.
