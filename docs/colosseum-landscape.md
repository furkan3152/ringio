# Ringio — Colosseum Copilot Landscape Report

Generated on 2026-08-12 from the authenticated Colosseum Copilot API. This is supplementary grant evidence, not a claim that Colosseum endorses Ringio.

## Executive conclusion

Ringio is **not the first Solana ROSCA**. Colosseum Copilot surfaced at least ten named direct or near-direct rotating-savings projects across Radar, Breakout, and Cypherpunk. The category is therefore **medium-to-high crowded at the idea level**.

The defensible wedge is narrower: Ringio combines a mathematically defined post-payout default reserve, member-specific collateral accounting, permissionless deterministic coverage, auditable payout ordering, and an explorer-verifiable funded lifecycle. None of the six closest Colosseum project profiles reviewed below discloses that complete mechanism. This is a profile-level comparison, not a full security audit of competing repositories.

Ringio should lead with **default-risk resolution and execution evidence**, not with “ROSCA on Solana.” AI group discovery is useful UX, but the winner comparison suggests that an AI label alone is not a strong differentiator.

## Methodology and limitations

- Dataset reported by the API: 5,428 projects, including 293 winners.
- Three diversified searches covered exact ROSCA mechanics, social/community savings, and AI-assisted financial-group discovery.
- Six closest project profiles and three adjacent ML clusters were inspected.
- A winner-only search and a winner-versus-all cohort comparison were run.
- Archive search was attempted with three query variants. No archive result reached the Copilot guide's `0.20` “worth reading” threshold, so archive snippets are not used as primary evidence.
- Copilot's `crowdedness` value on a project is the size of its broad ML cluster. It is **not** a normalized 0–100 score and is not a direct competitor count.
- The ML taxonomy is coarse: several ROSCA projects are assigned to “Solana-Based Charitable Fundraising,” so cluster labels must not be treated as exact market definitions.

## Closest projects

| Project | Hackathon | What its Colosseum profile says | Default-risk disclosure in profile | Prize |
| --- | --- | --- | --- | --- |
| [RizqFi](https://colosseum.com/projects/explore/rizqfi) | Cypherpunk | USDC ROSCA, automated rotation, contribution tracking, smart-contract escrow | No collateral replacement mechanism stated | None shown |
| [Rotare-Saving](https://colosseum.com/projects/explore/rotare-saving) | Cypherpunk | SOL savings pools and automated distribution on target completion | No post-payout default mechanism stated | None shown |
| [Ajọ on Sol](https://colosseum.com/projects/explore/ajo-on-sol) | Breakout | Nigerian ROSCA, rotating payouts, escrow, staking | No position-aware collateral mechanism stated | None shown |
| [KrediLoop](https://colosseum.com/projects/explore/krediloop) | Cypherpunk | African group savings, automated distribution, planned/on-chain credit scoring | Credit scoring is named; contribution replacement is not | None shown |
| [InTrust](https://colosseum.com/projects/explore/intrust) | Radar | Payment recording, reputation, and automated distribution; payment default is identified as a problem | Credit scores are described as future work; no collateral cover stated | None shown |
| [Halo Protocol](https://colosseum.com/projects/explore/halo-protocol) | Cypherpunk | ROSCA with trust scoring, staking, and DeFi yield | No exact remaining-obligation collateral or keeper cover stated | None shown |

Additional direct or near-direct results included Sontine, Vaquita Protocol, Koopaa, and LoopVault. The direct profiles inspected above did not show a prize. A winner-filtered query returned adjacent savings, stablecoin, RWA, and AI projects rather than a clearly direct ROSCA winner; this supports, but does not prove, that the exact niche has not produced a Colosseum winner in the indexed dataset.

## Crowdedness assessment

| Layer | Evidence | Assessment |
| --- | --- | --- |
| Exact ROSCA idea | At least ten named direct or near-direct projects surfaced | Medium-high; the concept alone is not differentiated |
| Community-fundraising cluster (`v1-c4`) | 111 projects, 1 winner | Broad and low-win-rate cluster; not an exact ROSCA count |
| Yield/DeFi optimization cluster (`v1-c8`) | 257 projects, 29 winners | Crowded but competitively validated adjacent category |
| AI DeFi assistant cluster (`v1-c22`) | 270 projects, 11 winners | Crowded and relatively under-indexed among winners |

## Winner-pattern comparison

Colosseum compared 293 winners with all 5,428 indexed projects. These are correlations in project metadata, not causal rules.

| Attribute | Winner share | All-project share | Relative lift | Implication for Ringio |
| --- | ---: | ---: | ---: | --- |
| Rust | 45.7% | 31.3% | +46.3% | Keep the on-chain mechanism central and technically evidenced |
| Anchor | 25.6% | 21.6% | +18.7% | Anchor is useful proof, but not differentiation by itself |
| TypeScript | 21.2% | 13.7% | +54.4% | A complete, usable client matters |
| Stablecoin payments | 1.71% | 0.79% | +115.4% | Lead with fixed USDC flows and settlement evidence |
| AI tech-stack tag | 5.80% | 10.59% | -45.2% | Do not pitch an AI wrapper as the core product |
| Yield/DeFi optimization cluster | 9.90% | 4.73% | +109.0% | Frame capital efficiency and risk mechanics concretely |
| AI-powered DeFi assistant cluster | 3.75% | 4.97% | -24.5% | Keep AI bounded to discovery/explanation |

Generic “smart-contract escrow” and “lack of transparency” positioning were underrepresented among winners in the comparison slice. Ringio should demonstrate the actual failure mode it resolves instead of relying on generic blockchain benefits.

## Ringio's evidence-backed differentiation

1. **Position-aware collateral:** collateral equals the contributions a member will still owe after receiving the pot, rather than a flat arbitrary bond.
2. **Compensatory default handling:** a missed eligible contribution is replaced into the round pot and debited only from the responsible member's collateral ledger; value is not burned or redirected as a protocol fee.
3. **Keeper-safe execution:** anyone may trigger eligible coverage or settlement, but the program fixes the amount and recipient.
4. **Solvency separated from liveness:** Protection Ratio measures covered post-payout obligations while unpaid-member state is displayed separately. Invite-only membership and abort/refund remain explicit answers to pre-payout stalling in the MVP.
5. **Auditable order and state:** commit-reveal ordering, PDA-derived state, SPL-token vaults, pause accounting, and terminal refund paths are implemented on-chain.
6. **Funded devnet proof:** the published program completed a two-member lifecycle with direct contributions, independent-keeper payouts, premature-cover rejection, post-grace collateral coverage, zero terminal vaults, and conserved participant balances.
7. **Bounded AI discovery:** deterministic eligibility and budget filters select candidates; GPT-4o may only rerank or explain them. Private group data, wallet data, invitations, and fund movement are outside the model's authority.

## Positioning recommendation

Use this thesis in the grant and demo:

> Ringio is a solvency-aware savings-circle protocol on Solana. Existing ROSCA submissions largely emphasize transparency and automated rotation; Ringio demonstrates how an early recipient's later missed contribution can be replaced from exactly that member's remaining-obligation collateral by a permissionless keeper, with fixed recipients and explorer-verifiable conservation. AI helps users find compatible circles but never decides eligibility or moves funds.

Avoid these claims:

- “The first ROSCA on Solana.”
- “Trustless” without explaining the remaining pre-payout liveness risk.
- “AI-managed funds” or autonomous custody.
- A single numeric “Crowdedness Score” derived from the cluster-size field.
- Competitor security claims based only on profile metadata.

## Recommended next proof

- Complete one five-member browser-signed devnet circle.
- Include one post-payout default covered by an unrelated keeper.
- Reconcile both vaults and all participant balances in the demo.
- Show the deterministic matcher result with OpenRouter disabled, then the same eligible candidate set with GPT-4o explanation enabled.
- Present Ringio beside the closest profiles using mechanism-level differences, not feature-count marketing.

## Source links

- [Colosseum Copilot](https://colosseum.com/copilot)
- [RizqFi](https://colosseum.com/projects/explore/rizqfi)
- [Rotare-Saving](https://colosseum.com/projects/explore/rotare-saving)
- [Ajọ on Sol](https://colosseum.com/projects/explore/ajo-on-sol)
- [KrediLoop](https://colosseum.com/projects/explore/krediloop)
- [InTrust](https://colosseum.com/projects/explore/intrust)
- [Halo Protocol](https://colosseum.com/projects/explore/halo-protocol)
