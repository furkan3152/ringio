# Ringio project context

Ringio is an Anchor + Next.js Solana dApp for rotating USDC savings circles. Treat every value-moving path as security-critical.

## Commands

- `npm --prefix web ci` installs the pinned browser package from the lockfile.
- `npm run dev` starts the web app.
- `npm run check` runs the safe local validation suite.
- `npm --prefix web run test:svm` runs the UI instruction builders against the deployed devnet bytecode in LiteSVM.
- `npm --prefix web run network:status` reports program/config readiness on mainnet-beta, devnet, and testnet.
- `cargo test -p ringio` runs pure Rust program tests.
- `anchor build` and `anchor test` require the toolchain in `docs/devnet-runbook.md`.

## Invariants

- A circle's mint and contribution amount never change after creation.
- Only the invited wallet can accept or mutate its Member PDA.
- Each member contributes at most once per round.
- A round pays exactly one ranked recipient, exactly once.
- Custody moves only through PDA-signed SPL transfers.
- Checked arithmetic is mandatory on every amount and deadline calculation.
- Pause authority cannot redirect or withdraw funds.
- UI simulation/demo state must never be presented as confirmed on-chain state.

## Product language

Use “circle,” “turn,” “contribution,” “payout,” and “protection.” Avoid claiming guaranteed yield, creditworthiness, or total safety. Display the active network (mainnet-beta, devnet, or testnet) and the asset mint near every signing flow.
