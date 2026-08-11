use anchor_lang::prelude::*;

#[error_code]
pub enum RingioError {
    #[msg("The protocol is paused")]
    ProtocolPaused,
    #[msg("The signer is not authorized for this action")]
    Unauthorized,
    #[msg("The group is not in the required state")]
    InvalidGroupState,
    #[msg("The requested member count is outside the supported range")]
    InvalidMemberCount,
    #[msg("The contribution amount must be greater than zero")]
    InvalidContributionAmount,
    #[msg("A duration must be greater than zero")]
    InvalidDuration,
    #[msg("The supplied deadline is invalid or has elapsed")]
    InvalidDeadline,
    #[msg("The group is already full")]
    GroupFull,
    #[msg("The invite is invalid or has already been used")]
    InvalidInvite,
    #[msg("This wallet is already a member")]
    DuplicateMember,
    #[msg("The commitment must not be the all-zero hash")]
    InvalidCommitment,
    #[msg("The reveal does not match the member commitment")]
    CommitmentMismatch,
    #[msg("This member already revealed")]
    AlreadyRevealed,
    #[msg("Not all members have revealed")]
    RevealIncomplete,
    #[msg("The payout order has not been finalized")]
    OrderNotFinalized,
    #[msg("The member is not present in the finalized payout order")]
    MemberNotRanked,
    #[msg("Collateral has already been posted by this member")]
    CollateralAlreadyPosted,
    #[msg("Not all members have posted their required collateral")]
    CollateralIncomplete,
    #[msg("The collateral vault is below the tracked required amount")]
    CollateralVaultShortfall,
    #[msg("This member has already resolved the current contribution")]
    ContributionAlreadyResolved,
    #[msg("The current round contribution window has closed")]
    ContributionWindowClosed,
    #[msg("The round grace period has not elapsed")]
    GracePeriodActive,
    #[msg("This missed contribution is not eligible for collateral coverage")]
    DefaultNotCoverable,
    #[msg("The selected member is not an uncovered defaulter")]
    DefaultIsCoverable,
    #[msg("Not every contribution in the round has been resolved")]
    RoundIncomplete,
    #[msg("The supplied payout recipient is not next in the on-chain order")]
    WrongRecipient,
    #[msg("The payout for this member has already been recorded")]
    PayoutAlreadyReceived,
    #[msg("There is no failed-round resolution to refund")]
    NothingToRefund,
    #[msg("Failed-round contribution refunds must finish before collateral refunds")]
    PendingRoundRefunds,
    #[msg("The group cannot be cancelled yet")]
    CancellationNotAllowed,
    #[msg("The token mint does not match the group mint")]
    WrongMint,
    #[msg("The token account authority is invalid")]
    WrongTokenAuthority,
    #[msg("The supplied vault is not the group's canonical vault")]
    WrongVault,
    #[msg("Arithmetic overflow or underflow")]
    MathOverflow,
    #[msg("An internal state invariant was violated")]
    InvariantViolation,
}
