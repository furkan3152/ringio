# Agent guidance

Keep the on-chain program, generated IDL/client surface, and dashboard copy synchronized. If an instruction is not wired to a real transaction builder, label it as demo or simulation in the UI and documentation.

Client instruction builders live in `web/src/lib/ringio/instructions.ts` and must mirror the account order and Borsh arguments in `programs/ringio/src/lib.rs`; any program instruction change must update the builders, `web/svm/lifecycle.svm.test.ts`, and the action planner in `web/src/lib/ringio/lifecycle.ts`. Every value-moving transaction must be simulated before the wallet prompt and show the network and asset mint.

Before changing value flow, update the invariant tests and `docs/architecture.md`. Never add a privileged vault-withdraw instruction. Never commit keys, RPC secrets, generated deploy keypairs, or user addresses.

The supported local toolchain is Node 20.19.4 and Rust 1.89.0. Next.js 15 is intentionally not supported because its transitive PostCSS and sharp versions were vulnerable at scaffold time.
