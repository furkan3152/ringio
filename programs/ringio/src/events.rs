use anchor_lang::prelude::*;

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub pause_authority: Pubkey,
}

#[event]
pub struct PauseChanged {
    pub pause_authority: Pubkey,
    pub paused: bool,
}

#[event]
pub struct PauseAuthorityChanged {
    pub admin: Pubkey,
    pub old_pause_authority: Pubkey,
    pub new_pause_authority: Pubkey,
}

#[event]
pub struct GroupCreated {
    pub group: Pubkey,
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub member_count: u16,
    pub contribution_amount: u64,
    pub join_deadline: i64,
}

#[event]
pub struct MemberInvited {
    pub group: Pubkey,
    pub invitee: Pubkey,
}

#[event]
pub struct MemberJoined {
    pub group: Pubkey,
    pub member: Pubkey,
    pub joined_index: u16,
}

#[event]
pub struct SecretRevealed {
    pub group: Pubkey,
    pub member: Pubkey,
    pub reveal_digest: [u8; 32],
}

#[event]
pub struct OrderFinalized {
    pub group: Pubkey,
    pub entropy: [u8; 32],
    pub member_count: u16,
    pub collateral_deadline: i64,
}

#[event]
pub struct CollateralPosted {
    pub group: Pubkey,
    pub member: Pubkey,
    pub payout_rank: u16,
    pub amount: u64,
}

#[event]
pub struct GroupActivated {
    pub group: Pubkey,
    pub started_at: i64,
    pub total_collateral: u64,
}

#[event]
pub struct ContributionRecorded {
    pub group: Pubkey,
    pub member: Pubkey,
    pub round: u16,
    pub amount: u64,
    pub collateral_released: u64,
}

#[event]
pub struct DefaultCovered {
    pub group: Pubkey,
    pub member: Pubkey,
    pub keeper: Pubkey,
    pub round: u16,
    pub amount: u64,
}

#[event]
pub struct RoundSettled {
    pub group: Pubkey,
    pub keeper: Pubkey,
    pub round: u16,
    pub recipient: Pubkey,
    pub amount: u64,
    pub completed: bool,
}

#[event]
pub struct GroupTerminated {
    pub group: Pubkey,
    pub status: u8,
    pub failed_round: u16,
    pub actor: Pubkey,
}

#[event]
pub struct FailedRoundRefunded {
    pub group: Pubkey,
    pub member: Pubkey,
    pub round: u16,
    pub resolution_kind: u8,
    pub amount: u64,
}

#[event]
pub struct CollateralRefunded {
    pub group: Pubkey,
    pub member: Pubkey,
    pub amount: u64,
}
