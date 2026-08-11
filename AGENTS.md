# Agent guidance

Keep the on-chain program, generated IDL/client surface, and dashboard copy synchronized. If an instruction is not wired to a real transaction builder, label it as demo or simulation in the UI and documentation.

Before changing value flow, update the invariant tests and `docs/architecture.md`. Never add a privileged vault-withdraw instruction. Never commit keys, RPC secrets, generated deploy keypairs, or user addresses.

The supported local toolchain is Node 20.19.4 and Rust 1.89.0. Next.js 15 is intentionally not supported because its transitive PostCSS and sharp versions were vulnerable at scaffold time.
