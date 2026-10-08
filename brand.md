# Brand — Ringio

_Status: "gold ring" direction (replaces the earlier functional-Bauhaus exploration)_

Ringio brings trusted savings circles on-chain. The interface should feel like a calm, premium money app that happens to run on Solana: dark ink surfaces, one warm gold accent that nods to _Altın Günü_ ("gold day"), generous spacing, and numbers that are always exact and legible.

## Direction

- Archetype: modern fintech, quietly confident
- Density: spacious on discovery; compact but readable on live circle data
- Surface: near-black ink layers with 1px hairline borders and soft depth; radius 12–18px
- Signature element: the **ring dial** — one node per seat in payout order, a gold arc for turns already paid out
- Motion: short and causal, `cubic-bezier(0.23, 1, 0.32, 1)`; respect `prefers-reduced-motion`

## Palette (dark)

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#07090D` | Page |
| `--surface` / `--surface-2` / `--surface-3` | `#10141C` / `#151A24` / `#1B2230` | Cards, inputs, hover |
| `--text` / `--text-2` / `--text-3` | `#EEF2F7` / `#A9B3C2` / `#6D788A` | Copy hierarchy |
| `--gold` / `--gold-2` / `--gold-deep` | `#F2C14E` / `#FFD97A` / `#C8952A` | Primary action, current turn, brand |
| `--success` | `#3DDC97` | Paid, verified, completed |
| `--danger` | `#FF6B6B` | Missed, failed, destructive |
| `--info` | `#7AA7FF` | Test networks, guide, neutral notices |
| `--warning` | `#FFB547` | Mainnet notice, low balance, unverified token |

Gold is the only brand color. Success, danger, info, and warning are functional and always paired with text or an icon.

## Typography

- UI and headings: Geist Sans; large headings use tight tracking (−0.03 to −0.045em)
- Amounts, addresses, circle codes: Geist Mono with tabular numerals
- Eyebrows: 12px uppercase, 0.08em tracking, gold (or muted)

## Components

- Primary button: gold gradient with dark ink text; one primary action per surface
- Secondary button: surface fill with hairline border; destructive actions use the danger tint
- Badges: pill, tinted background + border of the same hue
- Signing context: every signing card lists the **network** and **asset mint** (and balance when tokens move) directly above the button
- Banners: info tint on devnet/testnet, warning tint on mainnet, danger tint when the program is not deployed

## Voice

Direct and specific. Say what is locked, what is due, which network you are on, and what the program guarantees. Use "circle", "turn", "contribution", "payout", and "protection". Never say "risk-free", "guaranteed yield", or "trust the code", and never present simulated or local state as confirmed on-chain state.
