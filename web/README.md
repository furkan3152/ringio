# Ringio web

Next.js 16 + React 19 + Tailwind CSS 4 interface for the Ringio Solana savings-circle MVP.

The current web surface includes:

- three responsive functional-Bauhaus views for discovery, circle management, and fund protection;
- Solana Wallet Adapter connection on devnet;
- confirmed devnet Group/Member/mint/vault reads with no mock fallback;
- clearly labelled contribution and create-circle preview states;
- a privacy-gated AI group matcher with deterministic fallback and optional
  server-only OpenRouter GPT-4o reranking;
- read-only group and agent-capability endpoints, exercised against the deployed Ringio program.

No UI control currently builds or signs an Anchor transaction. Keep every
value-moving interaction labelled as preview/simulation until real transaction
builders are connected; read-only dashboard facts are live devnet state.

## Run

Use Node 20.19.4 from the repository root:

```bash
nvm use
npm --prefix web ci
npm run dev
```

Copy `.env.example` to `.env.local` only when local overrides are needed. An
OpenRouter key is optional; without it, matching stays deterministic and local.

## Verify

```bash
npm --prefix web run lint
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run build
```

See the repository [README](../README.md), [AI matching design](../docs/ai-matching.md),
and [security policy](../SECURITY.md) for the complete scope and limitations.
