# Ringio web

Next.js 16 + React 19 client for the Ringio savings-circle program on Solana.

- **Routes:** `/` (discover, how it works, protection, guide), `/circles` (your circles and invitations), `/circles/[address]` (live circle with the next action for your wallet), `/create` (new circle).
- **Networks:** mainnet-beta, devnet, and testnet, configured in `src/lib/solana/networks.ts` from `NEXT_PUBLIC_*` variables (see the root `.env.example`).
- **Transactions:** `src/lib/ringio/instructions.ts` hand-encodes every program instruction (Anchor-compatible discriminators and Borsh arguments); `src/hooks/use-ringio-tx.ts` simulates, budgets, signs, and confirms them; `src/lib/ringio/lifecycle.ts` decides which actions a wallet can take.
- **Reads:** confirmed RPC reads only (`src/lib/ringio/fetch.ts`); nothing is mocked or stored on a server.
- **API:** `/api/groups?cluster=…`, `/api/ai/match?cluster=…`, `/api/agent/manifest` (read-only).

## Run

```bash
nvm use                 # Node 20.19.4
npm --prefix web ci
npm run dev
```

## Verify

```bash
npm --prefix web run lint
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run test:svm     # fetches devnet bytecode, runs LiteSVM lifecycle
npm --prefix web run build
npm --prefix web run network:status
```
