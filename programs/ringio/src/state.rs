use anchor_lang::prelude::*;

use crate::constants::{MAX_MEMBERS, UNSET_ROUND};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum GroupStatus {
    Forming,
    Revealing,
    Collateralizing,
    Active,
    Completed,
    Cancelled,
    Defaulted,
}

impl GroupStatus {
    pub const fn event_code(self) -> u8 {
        match self {
            Self::Forming => 0,
            Self::Revealing => 1,
            Self::Collateralizing => 2,
            Self::Active => 3,
            Self::Completed => 4,
            Self::Cancelled => 5,
            Self::Defaulted => 6,
        }
    }
}

#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub pause_authority: Pubkey,
    pub paused_at: i64,
    pub total_paused_seconds: u64,
    pub paused: bool,
    pub bump: u8,
    pub version: u8,
    pub reserved: [u8; 45],
}

#[account]
#[derive(InitSpace)]
pub struct Group {
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub pot_vault: Pubkey,
    pub collateral_vault: Pubkey,
    pub entropy: [u8; 32],
    pub members: [Pubkey; MAX_MEMBERS],
    pub payout_order: [Pubkey; MAX_MEMBERS],
    pub id: u64,
    pub contribution_amount: u64,
    pub total_collateral_locked: u64,
    pub period_seconds: i64,
    pub grace_seconds: i64,
    pub join_deadline: i64,
    pub reveal_window_seconds: i64,
    pub collateral_window_seconds: i64,
    pub reveal_deadline: i64,
    pub collateral_deadline: i64,
    pub created_at: i64,
    pub reveal_started_at: i64,
    pub collateral_started_at: i64,
    pub round_started_at: i64,
    pub member_count: u16,
    pub joined_count: u16,
    pub revealed_count: u16,
    pub collateralized_count: u16,
    pub current_round: u16,
    pub round_contributions: u16,
    pub failed_round: u16,
    pub status: GroupStatus,
    pub bump: u8,
    pub pot_vault_bump: u8,
    pub collateral_vault_bump: u8,
    pub version: u8,
    pub phase_pause_snapshot: u64,
    pub reserved: [u8; 32],
}

impl Group {
    pub fn rank_of(&self, wallet: &Pubkey) -> Option<u16> {
        self.payout_order
            .iter()
            .take(usize::from(self.member_count))
            .position(|candidate| candidate == wallet)
            .and_then(|rank| u16::try_from(rank).ok())
    }

    pub fn expected_recipient(&self) -> Option<Pubkey> {
        if self.current_round >= self.member_count {
            return None;
        }
        self.payout_order
            .get(usize::from(self.current_round))
            .copied()
    }
}

#[account]
#[derive(InitSpace)]
pub struct Invite {
    pub group: Pubkey,
    pub invitee: Pubkey,
    pub used: bool,
    pub bump: u8,
    pub reserved: [u8; 30],
}

#[account]
#[derive(InitSpace)]
pub struct Member {
    pub group: Pubkey,
    pub wallet: Pubkey,
    pub commitment: [u8; 32],
    pub reveal_digest: [u8; 32],
    pub collateral_locked: u64,
    pub joined_index: u16,
    pub payout_rank: u16,
    pub last_contributed_round: u16,
    pub last_refunded_round: u16,
    pub defaults: u16,
    pub revealed: bool,
    pub collateral_posted: bool,
    pub payout_received: bool,
    pub last_resolution_kind: u8,
    pub bump: u8,
    pub reserved: [u8; 31],
}

impl Member {
    pub fn initialize(
        &mut self,
        group: Pubkey,
        wallet: Pubkey,
        commitment: [u8; 32],
        joined_index: u16,
        bump: u8,
    ) {
        self.group = group;
        self.wallet = wallet;
        self.commitment = commitment;
        self.reveal_digest = [0; 32];
        self.collateral_locked = 0;
        self.joined_index = joined_index;
        self.payout_rank = UNSET_ROUND;
        self.last_contributed_round = UNSET_ROUND;
        self.last_refunded_round = UNSET_ROUND;
        self.defaults = 0;
        self.revealed = false;
        self.collateral_posted = false;
        self.payout_received = false;
        self.last_resolution_kind = 0;
        self.bump = bump;
        self.reserved = [0; 31];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_initialized_accounts_fit_system_program_cpi_limit() {
        const MAX_CPI_INIT_DATA: usize = 10_240;
        let account_sizes = std::hint::black_box([
            8 + GlobalConfig::INIT_SPACE,
            8 + Group::INIT_SPACE,
            8 + Invite::INIT_SPACE,
            8 + Member::INIT_SPACE,
        ]);
        for account_size in account_sizes {
            assert!(account_size <= MAX_CPI_INIT_DATA);
        }
        assert_eq!(std::hint::black_box(GlobalConfig::INIT_SPACE), 128);
        assert_eq!(std::hint::black_box(Group::INIT_SPACE), 2_379);
    }

    #[test]
    fn status_event_codes_are_unique_and_terminal_states_are_distinct() {
        let statuses = [
            GroupStatus::Forming,
            GroupStatus::Revealing,
            GroupStatus::Collateralizing,
            GroupStatus::Active,
            GroupStatus::Completed,
            GroupStatus::Cancelled,
            GroupStatus::Defaulted,
        ];

        for (index, status) in statuses.iter().enumerate() {
            assert_eq!(usize::from(status.event_code()), index);
        }
        assert_ne!(GroupStatus::Completed, GroupStatus::Cancelled);
        assert_ne!(GroupStatus::Cancelled, GroupStatus::Defaulted);
    }
}
