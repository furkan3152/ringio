# Ringio security policy

Ringio is pre-audit MVP software. Do not use it with assets you cannot afford to lose.

## Supported environment

Only Solana devnet is supported until all of the following are complete:

- an independent program review;
- adversarial LiteSVM or Mollusk integration coverage;
- prolonged state-machine fuzzing;
- verified SBF builds and reproducible deployment artifacts;
- upgrade, pause, and emergency authorities transferred to a multisig;
- a public bug-bounty and disclosure channel.

## Reporting

Do not open a public issue containing an exploitable vulnerability. Use the repository's private vulnerability-reporting form under the GitHub **Security** tab. Include a minimal reproduction, the affected instruction/accounts, and expected impact; never include a funded private key or seed phrase.

## Trust boundary

The program can move tokens only through the circle PDA-controlled pot and
collateral vaults. Payouts and refunds are constrained to the expected member's
classic SPL token account for the circle mint. There is no admin sweep or
privileged vault-withdraw instruction.

The pause authority can stop progression and termination paths but cannot
redirect custody. Failed-round and collateral refunds stay available while
paused. Completed pause intervals extend each active deadline by exactly the
time the protocol was paused; pausing after an already-expired deadline cannot
revive it. A pause remains a centralized liveness control, not a recovery key;
production authorities must be separate multisigs.

The AI matcher is outside the custody boundary. It receives only the current
sanitized preference message and eligible public demo listings. Wallet
addresses, contact details, seed/private-key phrases, and secret invite data are
rejected before an optional OpenRouter request. Model output is restricted to
allowlisted group codes, bounded fields, and no financial guarantees; any
provider error or invalid output falls back to the deterministic matcher. A
public group code never authorizes membership.

## Known limitations

- The catalog decodes devnet Group accounts directly, but descriptive metadata
  is still limited to on-chain economic fields. Production metadata needs
  signed/versioned records and durable collision handling for display codes.
- The AI rate limiter is in-memory and best effort. A public paid-key deployment
  needs a durable distributed limiter, budget alerts, and key rotation.
- Host Rust tests do not execute Token Program CPIs. One funded devnet-USDC
  lifecycle completed with terminal conservation assertions, but exhaustive
  LiteSVM/local-validator adversarial coverage and maximum-roster compute
  profiling remain open.
- Browser financial controls are explicitly non-signing previews until reviewed
  Wallet Adapter transaction builders are wired; the E2E harness is not a
  substitute for end-user signing UX.
- Commit-reveal prevents caller-selected ordering, but the last revealer can
  still abort the pre-custody group.
- Pre-payout default is not collateral-covered. It terminates and unwinds the
  failed round, so invite-only membership remains an economic trust boundary.
- The repository intentionally resolves browser-only Wallet Adapter peers
  without auto-installing the unused React Native/Metro toolchain. Dependency
  audit and Node 20 compatibility checks are part of CI/release verification.
