# Ringio project context

Ringio is a Pinocchio (Anchor-compatible interface) + Next.js Solana dApp for rotating USDC savings circles. Treat every value-moving path as security-critical.

## Commands

- `npm --prefix web ci` installs the pinned browser package from the lockfile.
- `npm run dev` starts the web app.
- `npm run check` runs the safe local validation suite.
- `npm --prefix web run test:svm` runs the UI instruction builders against the local build (or the deployed devnet bytecode) in LiteSVM, plus the Anchor-equivalence differential suite when `target/deploy/ringio.so` exists.
- `npm --prefix web run network:status` reports program/config readiness on mainnet-beta, devnet, and testnet.
- `cargo test -p ringio` runs pure Rust program tests.
- `cargo build-sbf --manifest-path programs/ringio/Cargo.toml` builds the program (Agave CLI 2.3.x); `npm --prefix web run program:cost` prints the SOL needed to deploy it.
- The program's instruction/account/event discriminators, Borsh layouts, account order, and error codes must stay identical to the original Anchor program; the differential suite enforces this.

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
