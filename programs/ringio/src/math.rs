use pinocchio::pubkey::Pubkey;

use crate::constants::{COMMITMENT_DOMAIN, MAX_MEMBERS, ORDER_DOMAIN, REVEAL_DOMAIN};
use crate::hash::hashv;

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

/// `(paused_at, total_paused_seconds)` after a `set_paused` request.
/// Repeating the current state is a no-op.
pub fn next_pause_state(
    was_paused: bool,
    requested_paused: bool,
    paused_at: i64,
    total_paused_seconds: u64,
    now: i64,
) -> Option<(i64, u64)> {
    match (was_paused, requested_paused) {
        (false, true) => Some((now, total_paused_seconds)),
        (true, false) => Some((
            0,
            accumulate_pause_seconds(total_paused_seconds, paused_at, now)?,
        )),
        _ => Some((paused_at, total_paused_seconds)),
    }
}

pub fn commitment_hash(group: &Pubkey, member: &Pubkey, secret: &[u8; 32]) -> [u8; 32] {
    hashv(&[COMMITMENT_DOMAIN, group, member, secret])
}

pub fn reveal_digest(group: &Pubkey, member: &Pubkey, secret: &[u8; 32]) -> [u8; 32] {
    hashv(&[REVEAL_DOMAIN, group, member, secret])
}

pub fn xor_digest(accumulator: &mut [u8; 32], digest: &[u8; 32]) {
    for (target, source) in accumulator.iter_mut().zip(digest.iter()) {
        *target ^= *source;
    }
}

pub fn order_score(group: &Pubkey, entropy: &[u8; 32], member: &Pubkey) -> [u8; 32] {
    hashv(&[ORDER_DOMAIN, group, entropy, member])
}

/// Sorts the roster by `(score, wallet)` ascending — the same total order the
/// original program produced. Scores are computed once per member.
/// Returns `None` for an invalid count, an empty slot, or a duplicate wallet.
pub fn derive_payout_order(
    roster: &[Pubkey; MAX_MEMBERS],
    member_count: u16,
    entropy: &[u8; 32],
    group: &Pubkey,
) -> Option<[u8; MAX_MEMBERS]> {
    let count = usize::from(member_count);
    if member_count < 2 || count > MAX_MEMBERS {
        return None;
    }
    for index in 0..count {
        if roster[index] == [0u8; 32] || roster[..index].contains(&roster[index]) {
            return None;
        }
    }

    let mut scores = [[0u8; 32]; MAX_MEMBERS];
    for index in 0..count {
        scores[index] = order_score(group, entropy, &roster[index]);
    }

    // Insertion sort over indices; `order[i]` is the roster index paid in round i.
    let mut order = [0u8; MAX_MEMBERS];
    for (slot, value) in order.iter_mut().enumerate().take(count) {
        *value = slot as u8;
    }
    for index in 1..count {
        let key = order[index];
        let key_rank = (scores.get(usize::from(key))?, roster.get(usize::from(key))?);
        let mut cursor = index;
        while cursor > 0 {
            let previous = order[cursor - 1];
            if (
                scores.get(usize::from(previous))?,
                roster.get(usize::from(previous))?,
            ) <= key_rank
            {
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
        for member_count in 2..=MAX_MEMBERS as u16 {
            for round in 0..member_count {
                for covered_post_payout in 0..=round {
                    for contribution in [1_u64, 10, 1_000_000] {
                        let post_payout = u64::from(round);
                        let covered = u64::from(covered_post_payout);
                        let direct_post = post_payout - covered;
                        let direct_pre = u64::from(member_count - round);
                        let direct_total = direct_pre + direct_post;
                        let opening =
                            total_collateral_required(member_count, contribution).unwrap();
                        let consumed = post_payout.checked_mul(contribution).unwrap();
                        let closing = opening.checked_sub(consumed).unwrap();
                        let external = direct_total.checked_mul(contribution).unwrap();
                        let returned = direct_post.checked_mul(contribution).unwrap();
                        let payout = round_payout(member_count, contribution).unwrap();
                        assert_eq!(opening + external, closing + returned + payout);
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
        assert_eq!(effective_deadline(200, 17, 5), Some(212));
        assert_eq!(accumulate_pause_seconds(5, 100, 107), Some(12));
        assert_eq!(accumulate_pause_seconds(12, 150, 155), Some(17));
        assert_eq!(effective_deadline(300, 25, 25), Some(300));
        assert_eq!(effective_deadline(300, 31, 25), Some(306));
    }

    #[test]
    fn pause_state_accumulates_only_real_completed_intervals() {
        let first_pause = next_pause_state(false, true, 0, 5, 100).unwrap();
        assert_eq!(first_pause, (100, 5));
        assert_eq!(
            next_pause_state(true, true, first_pause.0, first_pause.1, 105).unwrap(),
            first_pause
        );
        let first_resume = next_pause_state(true, false, 100, 5, 110).unwrap();
        assert_eq!(first_resume, (0, 15));
        assert_eq!(
            next_pause_state(false, false, 0, 15, 999).unwrap(),
            first_resume
        );
        assert_eq!(next_pause_state(true, false, 200, 0, 199), None);
        assert_eq!(next_pause_state(true, false, 10, u64::MAX, 11), None);
    }

    #[test]
    fn commitment_is_domain_bound_to_group_and_member() {
        let secret = [9_u8; 32];
        let baseline = commitment_hash(&[1; 32], &[3; 32], &secret);
        assert_ne!(baseline, [0; 32]);
        assert_ne!(baseline, commitment_hash(&[2; 32], &[3; 32], &secret));
        assert_ne!(baseline, commitment_hash(&[1; 32], &[4; 32], &secret));
        assert_ne!(baseline, reveal_digest(&[1; 32], &[3; 32], &secret));
    }

    fn reference_order(
        roster: &[Pubkey],
        entropy: &[u8; 32],
        group: &Pubkey,
    ) -> [Pubkey; MAX_MEMBERS] {
        // The original algorithm: insertion sort recomputing scores per comparison.
        let mut order = [[0u8; 32]; MAX_MEMBERS];
        order[..roster.len()].copy_from_slice(roster);
        for index in 1..roster.len() {
            let key = order[index];
            let key_score = order_score(group, entropy, &key);
            let mut cursor = index;
            while cursor > 0 {
                let previous = order[cursor - 1];
                let previous_score = order_score(group, entropy, &previous);
                if !(previous_score > key_score || (previous_score == key_score && previous > key))
                {
                    break;
                }
                order[cursor] = previous;
                cursor -= 1;
            }
            order[cursor] = key;
        }
        order
    }

    #[test]
    fn ordering_matches_the_original_algorithm_and_is_a_permutation() {
        let group = [42u8; 32];
        for count in [2usize, 3, 12, MAX_MEMBERS] {
            let mut roster = [[0u8; 32]; MAX_MEMBERS];
            for (index, wallet) in roster.iter_mut().take(count).enumerate() {
                *wallet = [index as u8 + 1; 32];
                wallet[31] = (index * 37 % 251) as u8;
            }
            for seed in 0..4u8 {
                let entropy = [seed; 32];
                let order = derive_payout_order(&roster, count as u16, &entropy, &group).unwrap();
                let expected = reference_order(&roster[..count], &entropy, &group);
                for slot in 0..count {
                    assert_eq!(roster[usize::from(order[slot])], expected[slot]);
                }
                let mut seen = [false; MAX_MEMBERS];
                for slot in 0..count {
                    assert!(!seen[usize::from(order[slot])]);
                    seen[usize::from(order[slot])] = true;
                }
            }
        }
    }

    #[test]
    fn ordering_rejects_duplicates_and_empty_slots() {
        let mut roster = [[0u8; 32]; MAX_MEMBERS];
        roster[0] = [1; 32];
        roster[1] = [1; 32];
        assert!(derive_payout_order(&roster, 2, &[0; 32], &[9; 32]).is_none());
        roster[1] = [0; 32];
        assert!(derive_payout_order(&roster, 2, &[0; 32], &[9; 32]).is_none());
        assert!(derive_payout_order(&roster, 1, &[0; 32], &[9; 32]).is_none());
    }
}
