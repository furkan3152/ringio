# Ringio AI Group Matching

Status: implemented and exercised against the deployed devnet program. The server decodes Ringio Group, Member, mint, and SPL vault accounts; derives collision-resistant display codes from Group addresses; hard-fails on RPC errors; and never substitutes static catalog rows. The deterministic bilingual matcher, privacy/input checks, API route, optional OpenRouter adapter, and exact custom-period formatter are checked in. Under Node.js 20.19.4, 17/17 web tests pass: 4 duration cases, 11 matcher/privacy/rate-limit cases, and 2 binary layout decoder cases. Real-Group listing, wallet filtering, natural-language matching, exact-code lookup, fallback/privacy, and homepage/API runtime smoke checks pass. This is not evidence of a live OpenRouter call.

## Product boundary

The matcher answers one question: “Which currently eligible on-chain Ringio circles best fit the economic preferences I described?” It may rank and explain decoded Group accounts. It cannot invite a wallet, approve membership, change circle terms, move tokens, sign a transaction, or claim that a group will complete.

A short group code is a public lookup identifier, comparable to a listing number. It is not a password, invitation secret, membership proof, or authorization factor. A recommendation never bypasses the on-chain invite and `join_group` flow.

## Data flow

```text
user message
  -> length and privacy checks
  -> structured preference extraction / deterministic filters
  -> decoded eligible devnet Group subset
  -> deterministic scores and fallback explanation
  -> optional GPT-4o rerank/explanation over that subset
  -> schema validation + known-code allowlist
  -> response with reasons, tradeoffs, and mode label
```

The LLM never receives member wallets, phone numbers, email addresses, seed phrases, invite secrets, private group messages, or contribution transaction history. It sees only the current request and bounded economic fields selected from eligible Group accounts.

## Public group record

The RPC decoder produces this public shape:

| Field | Meaning |
| --- | --- |
| `code` | case-insensitive `RNG-` code derived from the first 48 bits of the Group address; lookup is always reconciled to the full address |
| `accountAddress` / `mint` | full Group and settlement-mint addresses |
| `name` | deterministic `Ringio [code]` label; no creator name is invented |
| `contributionUsdc` | fixed contribution shown in human USDC units |
| `cadence` | weekly, biweekly, or monthly |
| `languages`, `location`, `interests` | empty/unspecified until creator-signed metadata exists; never inferred |
| `start.isoDate` / `start.timezone` | Group account creation time in UTC, not an invented planned start |
| `memberSlots.total` / `filled` / `available` | current Group account capacity |
| `postPayoutCollateral` | precise scope, coverage percentage, and maximum first-rank amount |
| `enrollmentStatus` | `accepting-members`, `full`, or `closed`; only accepting groups can be eligible |
| `listingSource` | always `solana-devnet` |

Production group metadata should be signed by the creator, versioned, moderated, and linked to the immutable group PDA/id. The program account remains canonical for economics and membership. A database or indexer is a read/discovery layer, not an authority over funds.

## Matching strategy

1. A direct group-code mention gets ranking priority only if the record exists, is eligible/open, and does not violate an explicit maximum budget.
2. Full/closed groups and records with no open capacity are hard-filtered.
3. A contribution amount is a hard filter only when the user explicitly frames it as a ceiling such as “up to” or “maximum.”
4. Cadence, desired group size, collateral preference, and ordinary contribution targets are scored preferences. Requests for language, location, interests, or planned starts receive an explicit “not recorded on-chain” tradeoff until signed metadata exists.
5. A deterministic score ranks the remaining entries and records which signals matched.
6. GPT‑4o may rerank the bounded candidate set and produce natural-language reasons/tradeoffs.
7. The response is rejected unless every returned code exists in the candidate allowlist, the payload matches the expected JSON shape, and its answer/reasons/tradeoffs contain no recognized risk-free or guaranteed-return promise.
8. Missing key, timeout, upstream failure, malformed JSON, or an unknown code falls back to the deterministic result with `mode: "deterministic"`.

This retrieval-first design keeps availability and economic facts out of the model's imagination. GPT‑4o explains known records; it does not invent groups.

## OpenRouter call

- Endpoint: `POST https://openrouter.ai/api/v1/chat/completions`
- Default model: `openai/gpt-4o`, configurable through `OPENROUTER_MODEL`
- Authentication: server-only `OPENROUTER_API_KEY`
- Output: strict JSON Schema, low temperature, bounded completion length
- Routing: `data_collection: "deny"`; optional Zero Data Retention routing when `OPENROUTER_ZDR=true` and a compatible endpoint is available
- Network behavior: explicit timeout, no automatic user-visible failure, no prompt/body logging

OpenRouter/provider privacy settings still need operational review. ZDR is an additional routing policy, not permission to send personal or private financial data.

## HTTP contract

Request:

```json
{
  "message": "Haftalık, en fazla 100 USDC ve 6 kişilik bir grup arıyorum",
  "history": []
}
```

Response:

```json
{
  "mode": "deterministic",
  "answer": "Ringio RNG-A1B2C3D4E5F6 isteğine en yakın zincir üstü grup.",
  "locale": "tr",
  "notice": null,
  "requestedCodeStatus": null,
  "catalogMode": "solana-devnet",
  "programId": "JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy",
  "groupCodeNotice": "Public discovery identifier only; never an authentication or invite credential.",
  "matches": [
    {
      "code": "RNG-A1B2C3D4E5F6",
      "groupCode": "RNG-A1B2C3D4E5F6",
      "name": "...",
      "score": 84,
      "reasons": ["Weekly cadence", "Within budget"],
      "tradeoffs": ["Communication language is not recorded on-chain"]
    }
  ]
}
```

The exact checked-in TypeScript types are authoritative. Clients must render the returned `mode`, because a rules fallback and a model-assisted result are different product states.

`mode: "openrouter"` is the only response-level indication that the optional provider returned an accepted schema result. Natural-sounding text is not evidence that a provider call occurred. `catalogMode: "solana-devnet"` means candidates were decoded from the configured program; an empty array is valid when no eligible Group exists.

## Security and abuse controls

| Threat | Control | Remaining production work |
| --- | --- | --- |
| Browser key theft | API key exists only in the server route | Rotate keys and use per-environment restricted keys |
| Paid endpoint abuse | request/body caps and best-effort per-IP limit | Durable distributed rate limiting and budget alerts |
| Prompt injection | fixed system policy, structured catalog, schema output, known-code allowlist | Red-team multilingual and indirect-injection cases |
| Group hallucination | retrieval before generation; unknown codes rejected | Index freshness monitoring |
| Personal data leakage | reject common wallet/contact/secret patterns; public fields only | Formal retention policy and privacy review |
| Stale availability | direct confirmed-RPC read and never auto-join | Subscriptions/index freshness monitoring |
| Biased recommendations | reasons + tradeoffs, deterministic baseline, no paid ranking | Ranking evaluation and disclosure policy |
| Financial-advice framing | matcher describes fit, not returns/safety; model output with recognized risk-free/guaranteed-return promises is rejected | Expand multilingual red-team cases, legal review, and user reporting workflow |

## Test matrix

- Direct code lookup is case-insensitive and cannot reveal an unpublished group.
- Turkish and English budget/cadence/location requests produce stable deterministic rankings.
- An explicit maximum budget excludes over-budget groups; an ordinary contribution target, cadence, language, location, start, or size mismatch remains a scored tradeoff.
- A full group is never returned as an available match.
- Unknown OpenRouter codes are rejected and trigger fallback.
- Model output that claims risk-free or guaranteed financial returns is rejected and triggers fallback.
- Missing key, timeout, non-200 response, invalid JSON, and schema mismatch all return a usable deterministic answer.
- Oversized history/body, invalid roles, wallet-like strings, contact details, and secret-key language fail before an upstream request.
- Returned scores stay in range and each match includes at least one reason and an explicit tradeoff list.

## Production dependencies

To make discovery production-grade, Ringio needs:

1. a persistent indexer/subscription layer that reconciles to deployed Group accounts;
2. signed creator metadata and moderation for searchable text/tags;
3. durable rate limiting, OpenRouter spend caps, monitoring, and key rotation;
4. privacy/legal review and an explicit retention policy;
5. evaluation data measuring whether users consider recommended groups relevant and understandable.
