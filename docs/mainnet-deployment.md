# Deploying Ringio to mainnet-beta and testnet

The web app already supports **mainnet-beta, devnet, and testnet** from one build: pick the network in the header and every read, simulation, and wallet signature goes to that cluster. A network only becomes usable once the Ringio program is **deployed** there and its **config PDA is initialized**. Until then the UI shows "Ringio is not live on …" and disables signing.

Check any cluster at any time (read-only, no keys):

```bash
npm --prefix web run network:status                      # all clusters
npm --prefix web run network:status -- --cluster mainnet-beta
```

`readyForUi: true` means the program is executable and the config exists. When a local `target/deploy/ringio.so` exists, `matchesLocalArtifact` compares its hash with the deployed bytecode.

> Ringio is pre-audit software. Read `SECURITY.md` and the mainnet exit criteria in `docs/architecture.md` §15 before moving real funds. Start with a capped pilot.

## 1. What it costs

The program is written with [Pinocchio](https://github.com/anza-xyz/pinocchio) (no Anchor runtime, no heap), so the deployed binary is about **92 KB** instead of the former 657 KB Anchor build. Print exact numbers for your build:

```bash
npm --prefix web run program:cost
```

| | Pinocchio build (now) | Former Anchor build |
| --- | --- | --- |
| Binary | ~92 KB | 657 KB |
| Locked while deployed (program + ProgramData rent) | **~0.64 SOL** | ~4.58 SOL |
| Temporary upload buffer (refunded after deploy) | ~0.64 SOL | ~4.58 SOL |
| Deployer wallet needs at deploy time | **~1.3 SOL** + priority fees | ~9.2 SOL |

Rent is a deposit, not a fee: the ProgramData rent stays locked while the program exists (recoverable only by closing the program, which retires its ID for good), and the buffer rent is returned when `solana program deploy` finishes. Keep ~1.5 SOL in the deployer wallet on mainnet to cover priority fees. Testnet SOL is free from the faucet.

Per circle, users pay rent for their own accounts (~0.024 SOL for a new circle, ~0.0016 SOL per invitation, ~0.0022 SOL per joined member) plus normal fees. These amounts are unchanged by the rewrite.

## 2. Toolchain and build

Install the Agave CLI (`2.3.x`, which brings `cargo build-sbf` and platform-tools), then build and test the reviewed commit:

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.13/install)"
git rev-parse HEAD
cargo test -p ringio
cargo build-sbf --manifest-path programs/ringio/Cargo.toml   # -> target/deploy/ringio.so
npm --prefix web run test:svm                                # lifecycle + Anchor-equivalence suites
npm --prefix web run program:cost -- --max-bytes 100000
sha256sum target/deploy/ringio.so
```

For a publicly verifiable build hash use [`solana-verify build`](https://github.com/Ellipsis-Labs/solana-verifiable-build), which runs the same `cargo build-sbf` inside a pinned container.

The external interface is identical to the former Anchor program (instruction and account discriminators, Borsh arguments, account order, account layouts, events, and error codes), so the web app, existing accounts, and indexers work unchanged. `web/svm/differential.svm.test.ts` proves this by running every step against both binaries. The program no longer embeds Anchor's on-chain IDL instructions; the client builders in `web/src/lib/ringio/` are the interface reference.

**Program ID.** Deploying with the same program keypair (kept outside git) gives the same ID on every cluster: `JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy`. If you use a new keypair, update `declare_id!` in `programs/ringio/src/lib.rs`, rebuild, and set `NEXT_PUBLIC_PROGRAM_ID_MAINNET` / `NEXT_PUBLIC_PROGRAM_ID_TESTNET` to the new ID. Never commit keypairs.

## 3. Deploy

Use a dedicated deployer keypair stored outside the repository. Confirm the target before every command.

```bash
# testnet
solana airdrop 2 --url testnet --keypair ~/keys/ringio-deployer.json   # repeat or use faucet.solana.com
solana program deploy target/deploy/ringio.so \
  --program-id ~/keys/ringio-program.json \
  --keypair ~/keys/ringio-deployer.json \
  --url testnet

# mainnet-beta (add a priority fee so buffer writes land)
solana program deploy target/deploy/ringio.so \
  --program-id ~/keys/ringio-program.json \
  --keypair ~/keys/ringio-deployer.json \
  --url https://YOUR-MAINNET-RPC \
  --with-compute-unit-price 50000 \
  --max-sign-attempts 50
```

If a deploy is interrupted, resume or close the leftover buffer with `solana program show --buffers` / `solana program close <BUFFER>` so its SOL is recovered. Do not pass a larger `--max-len`: it only locks more rent. A later, larger upgrade can grow the account with `solana program extend`.

### Upgrading an existing deployment (devnet)

The devnet program was deployed from the Anchor build. Upgrading it in place keeps the program ID, the config, and every existing circle (account layouts are unchanged); it needs the current upgrade authority:

```bash
npm --prefix web run program:fetch          # keeps a copy of the Anchor build for the differential suite
solana program deploy target/deploy/ringio.so \
  --program-id JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy \
  --upgrade-authority ~/keys/ringio-deployer.json \
  --keypair ~/keys/ringio-deployer.json \
  --url devnet
npm --prefix web run network:status -- --cluster devnet   # matchesLocalArtifact: true
```

An upgrade never shrinks an existing ProgramData account, so the devnet program keeps its original (devnet-SOL) rent locked. Fresh deployments on mainnet-beta and testnet only lock the smaller amount above.

## 4. Initialize the config

`initialize_config` must be signed by the **current upgrade authority** and sets the admin plus the pause authority. The pause authority can halt progress but can never move or redirect funds; refunds keep working while paused. Use a multisig for it on mainnet.

```bash
npm --prefix web run initialize:config -- \
  --cluster testnet \
  --keypair ~/keys/ringio-deployer.json \
  --pause-authority <PAUSE_AUTHORITY_PUBKEY>

npm --prefix web run initialize:config -- \
  --cluster mainnet-beta \
  --rpc https://YOUR-MAINNET-RPC \
  --keypair ~/keys/ringio-deployer.json \
  --pause-authority <SQUADS_MULTISIG_VAULT> \
  --yes-mainnet
```

The script is idempotent: it prints the existing config instead of failing when already initialized.

## 5. Hand off the upgrade authority (mainnet)

After the config is initialized, move the upgrade authority to a multisig (for example a Squads vault) or make the program immutable once it is audited:

```bash
solana program set-upgrade-authority JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy \
  --new-upgrade-authority <SQUADS_MULTISIG_VAULT> \
  --skip-new-upgrade-authority-signer-check \
  --keypair ~/keys/ringio-deployer.json \
  --url https://YOUR-MAINNET-RPC
```

Publish the program ID, upgrade authority, and verified build hash. Re-run `network:status` and confirm `upgradeAuthority` and `readyForUi`.

## 6. Settlement asset per network

| Network | Default mint | Notes |
| --- | --- | --- |
| mainnet-beta | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (Circle USDC) | Shown as "Verified USDC" |
| devnet | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (Circle devnet USDC) | Free from faucet.circle.com |
| testnet | none | Solana testnet has no Circle USDC |

For testnet, create a classic SPL test token and configure it:

```bash
spl-token create-token --decimals 6 --url testnet          # prints the mint
spl-token create-account <MINT> --url testnet
spl-token mint <MINT> 100000 --url testnet
# then: NEXT_PUBLIC_USDC_MINT_TESTNET=<MINT>
```

Without that variable, the create form on testnet asks for a mint address. Token-2022 mints are rejected because the program uses the classic Token program.

## 7. Configure and deploy the web app

Set these in the hosting provider (for example Vercel → Project → Settings → Environment Variables). See `.env.example` for the full list.

```bash
NEXT_PUBLIC_ENABLED_CLUSTERS=mainnet-beta,devnet,testnet
NEXT_PUBLIC_DEFAULT_CLUSTER=devnet          # switch to mainnet-beta after the pilot
NEXT_PUBLIC_RPC_URL_MAINNET=https://YOUR-MAINNET-RPC   # domain-restricted key
NEXT_PUBLIC_RPC_URL_DEVNET=https://api.devnet.solana.com
NEXT_PUBLIC_RPC_URL_TESTNET=https://api.testnet.solana.com
SOLANA_RPC_URL_MAINNET=https://PRIVATE-SERVER-RPC     # optional, server routes only
```

The public `api.mainnet-beta.solana.com` endpoint is heavily rate-limited and restricts `getProgramAccounts`, which the dashboard uses; use a dedicated RPC provider for mainnet. Keep the cluster name in devnet/testnet RPC URLs so wallet adapters detect the right chain.

## 8. Smoke test on the new network

1. Open the app, switch to the network, and confirm the banner no longer says "not live".
2. With two wallets: create a 2-member circle with a short custom turn (for example 5 minutes), invite the second wallet, accept, reveal from both, draw the order, post protection, start, contribute from both, and pay out.
3. Check every signature on the explorer and run `network:status` again.
4. On mainnet, keep circle amounts small until an independent audit is complete.

## How the client is verified

- `npm --prefix web test` — unit tests for discriminators, Borsh layouts, PDAs, commitment hashing, amount parsing, the action planner, and error decoding.
- `npm --prefix web run test:svm` — runs the full lifecycle (create → invite → join → reveal → finalize → protection → activate → contribute → settle → covered default → completion), a cancellation, a pre-payout default with refunds while paused, and pause enforcement — all with the exact instruction builders the UI uses — against the local build (`target/deploy/ringio.so`, or the downloaded devnet bytecode when there is no local build). With a local build it also runs the differential suite, which executes over a hundred normal and adversarial transactions (forged and substituted accounts, wrong signers, replays, foreign mints, prefunded PDAs, malformed instruction data) against both the original Anchor bytecode and the new build and requires identical results, error codes, events, and account bytes.
