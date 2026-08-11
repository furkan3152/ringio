use anchor_lang::prelude::Pubkey;
use solana_sha256_hasher::hashv;

use crate::constants::{MAX_MEMBERS, ORDER_DOMAIN};

/// Exact collateral needed to guarantee only the installments due after payout.
/// Rank zero locks `(member_count - 1) * contribution`; the final rank locks zero.
pub fn collateral_required(member_count: u16, rank: u16, contribution: u64) -> Option<u64> {
    if member_count < 2 || usize::from(member_count) > MAX_MEMBERS || rank >= member_count {
        return None;
    }

    let remaining_obligations = u64::from(member_count.checked_sub(rank)?.checked_sub(1)?);
    contribution.checked_mul(remaining_obligations)
}

pub fn total_collateral_required(member_count: u16, contribution: u64) -> Option<u64> {
    if member_count < 2 || usize::from(member_count) > MAX_MEMBERS {
        return None;
    }

    let n = u128::from(member_count);
    let triangular = n.checked_mul(n.checked_sub(1)?)?.checked_div(2)?;
    let total = triangular.checked_mul(u128::from(contribution))?;
    u64::try_from(total).ok()
}

pub fn round_payout(member_count: u16, contribution: u64) -> Option<u64> {
    if member_count < 2 || usize::from(member_count) > MAX_MEMBERS {
        return None;
    }
    contribution.checked_mul(u64::from(member_count))
}

pub fn round_grace_ends(
    round_started_at: i64,
    period_seconds: i64,
    grace_seconds: i64,
) -> Option<i64> {
    round_started_at
        .checked_add(period_seconds)?
        .checked_add(grace_seconds)
}

/// Adds only pauses completed after the current phase began.
pub fn effective_deadline(
    base_deadline: i64,
    total_paused_seconds: u64,
    phase_pause_snapshot: u64,
) -> Option<i64> {
    let paused_delta = total_paused_seconds.checked_sub(phase_pause_snapshot)?;
    let paused_delta_i64 = i64::try_from(paused_delta).ok()?;
    base_deadline.checked_add(paused_delta_i64)
}

/// Completes one pause interval. A reversed clock or accumulator overflow fails
/// closed by returning `None`.
pub fn accumulate_pause_seconds(
    total_paused_seconds: u64,
    paused_at: i64,
    resumed_at: i64,
) -> Option<u64> {
    let elapsed_i64 = resumed_at.checked_sub(paused_at)?;
    let elapsed = u64::try_from(elapsed_i64).ok()?;
    total_paused_seconds.checked_add(elapsed)
}

pub fn order_score(group: &Pubkey, entropy: &[u8; 32], member: &Pubkey) -> [u8; 32] {
    hashv(&[ORDER_DOMAIN, group.as_ref(), entropy, member.as_ref()]).to_bytes()
}

/// Allocation-free insertion sort keeps the on-chain work bounded by MAX_MEMBERS.
pub fn derive_payout_order(
    members: &[Pubkey; MAX_MEMBERS],
    member_count: u16,
    entropy: &[u8; 32],
    group: &Pubkey,
) -> Option<[Pubkey; MAX_MEMBERS]> {
    let count = usize::from(member_count);
    if member_count < 2 || count > MAX_MEMBERS {
        return None;
    }

    let mut order = [Pubkey::default(); MAX_MEMBERS];
    order[..count].copy_from_slice(&members[..count]);

    for index in 0..count {
        if order[index] == Pubkey::default() {
            return None;
        }
        for other in 0..index {
            if order[other] == order[index] {
                return None;
            }
        }
    }

    for index in 1..count {
        let key = order[index];
        let key_score = order_score(group, entropy, &key);
        let mut cursor = index;

        while cursor > 0 {
            let previous = order[cursor - 1];
            let previous_score = order_score(group, entropy, &previous);
            let move_previous = previous_score > key_score
                || (previous_score == key_score && previous.to_bytes() > key.to_bytes());
            if !move_previous {
                break;
            }
            order[cursor] = previous;
            cursor -= 1;
        }
        order[cursor] = key;
    }

    Some(order)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collateral_is_rank_monotone_and_sums_to_triangular_requirement() {
        let contributions = [1_u64, 10, 1_000_000, u32::MAX as u64];

        for member_count in 2..=MAX_MEMBERS as u16 {
            for contribution in contributions {
                let mut sum = 0_u64;
                let mut previous = None;
                for rank in 0..member_count {
                    let required = collateral_required(member_count, rank, contribution).unwrap();
                    if let Some(previous_required) = previous {
                        assert_eq!(previous_required - required, contribution);
                        assert!(previous_required >= required);
                    }
                    sum = sum.checked_add(required).unwrap();
                    previous = Some(required);
                }
                assert_eq!(previous, Some(0));
                assert_eq!(
                    sum,
                    total_collateral_required(member_count, contribution).unwrap()
                );
            }
        }
    }

    #[test]
    fn every_round_resolution_mix_conserves_token_value() {
        let contributions = [1_u64, 10, 1_000_000];

        for member_count in 2..=MAX_MEMBERS as u16 {
            for round in 0..member_count {
                for covered_post_payout in 0..=round {
                    for contribution in contributions {
                        // Ranks [0, round) have already received. Every rank at/after
                        // the current round must pay directly or the group defaults.
                        let post_payout = u64::from(round);
                        let covered = u64::from(covered_post_payout);
                        let direct_post = post_payout - covered;
                        let direct_pre = u64::from(member_count - round);
                        let direct_total = direct_pre + direct_post;

                        let opening_collateral =
                            total_collateral_required(member_count, contribution).unwrap();
                        let collateral_consumed_or_released =
                            post_payout.checked_mul(contribution).unwrap();
                        let closing_collateral = opening_collateral
                            .checked_sub(collateral_consumed_or_released)
                            .unwrap();
                        let external_contributions =
                            direct_total.checked_mul(contribution).unwrap();
                        let returned_collateral = direct_post.checked_mul(contribution).unwrap();
                        let payout = round_payout(member_count, contribution).unwrap();

                        assert_eq!(
                            opening_collateral + external_contributions,
                            closing_collateral + returned_collateral + payout
                        );
                        assert_eq!(
                            (direct_total + covered).checked_mul(contribution).unwrap(),
                            payout
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn math_rejects_invalid_domains_and_overflow() {
        assert_eq!(collateral_required(1, 0, 1), None);
        assert_eq!(collateral_required(2, 2, 1), None);
        assert_eq!(collateral_required(MAX_MEMBERS as u16 + 1, 0, 1), None);
        assert_eq!(collateral_required(MAX_MEMBERS as u16, 0, u64::MAX), None);
        assert_eq!(
            total_collateral_required(MAX_MEMBERS as u16, u64::MAX),
            None
        );
        assert_eq!(round_payout(MAX_MEMBERS as u16, u64::MAX), None);
        assert_eq!(round_grace_ends(i64::MAX, 1, 1), None);
        assert_eq!(effective_deadline(i64::MAX, 1, 0), None);
        assert_eq!(effective_deadline(100, 0, 1), None);
        assert_eq!(effective_deadline(100, u64::MAX, 0), None);
        assert_eq!(accumulate_pause_seconds(0, 20, 10), None);
        assert_eq!(accumulate_pause_seconds(u64::MAX, 10, 11), None);
    }

    #[test]
    fn cumulative_pause_freezes_deadline_by_exact_completed_duration() {
        // The phase began when the global completed-pause total was 5 seconds.
        // Two later pauses totaling 12 seconds move the deadline by exactly 12.
        assert_eq!(effective_deadline(200, 17, 5), Some(212));
        assert_eq!(accumulate_pause_seconds(5, 100, 107), Some(12));
        assert_eq!(accumulate_pause_seconds(12, 150, 155), Some(17));
    }

    #[test]
    fn pause_after_expiry_does_not_revive_the_deadline() {
        let base_deadline = 100;
        let resumed_at = 160;
        let effective = effective_deadline(base_deadline, 10, 0).unwrap();

        assert_eq!(effective, 110);
        assert!(resumed_at > effective);
    }

    #[test]
    fn phase_snapshot_excludes_pauses_completed_before_phase_start() {
        assert_eq!(effective_deadline(300, 25, 25), Some(300));
        assert_eq!(effective_deadline(300, 31, 25), Some(306));
    }

    #[test]
    fn ordering_is_deterministic_complete_and_unique() {
        let group = Pubkey::new_unique();
        let mut members = [Pubkey::default(); MAX_MEMBERS];
        for member in members.iter_mut().take(12) {
            *member = Pubkey::new_unique();
        }
        let entropy = [7_u8; 32];

        let first = derive_payout_order(&members, 12, &entropy, &group).unwrap();
        let second = derive_payout_order(&members, 12, &entropy, &group).unwrap();
        assert_eq!(first, second);

        for member in members.iter().take(12) {
            assert_eq!(
                first.iter().take(12).filter(|item| *item == member).count(),
                1
            );
        }
    }
}
