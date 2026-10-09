use pinocchio::program_error::ProgramError;

/// Program errors. Codes are identical to the former Anchor program
/// (`6000 + variant index`) so clients decode them unchanged.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum RingioError {
    ProtocolPaused = 6000,
    Unauthorized,
    InvalidGroupState,
    InvalidMemberCount,
    InvalidContributionAmount,
    InvalidDuration,
    InvalidDeadline,
    GroupFull,
    InvalidInvite,
    DuplicateMember,
    InvalidCommitment,
    CommitmentMismatch,
    AlreadyRevealed,
    RevealIncomplete,
    OrderNotFinalized,
    MemberNotRanked,
    CollateralAlreadyPosted,
    CollateralIncomplete,
    CollateralVaultShortfall,
    ContributionAlreadyResolved,
    ContributionWindowClosed,
    GracePeriodActive,
    DefaultNotCoverable,
    DefaultIsCoverable,
    RoundIncomplete,
    WrongRecipient,
    PayoutAlreadyReceived,
    NothingToRefund,
    PendingRoundRefunds,
    CancellationNotAllowed,
    WrongMint,
    WrongTokenAuthority,
    WrongVault,
    MathOverflow,
    InvariantViolation,
}

impl From<RingioError> for ProgramError {
    fn from(error: RingioError) -> Self {
        ProgramError::Custom(error as u32)
    }
}

/// Account-validation failures, numbered like Anchor's framework errors so
/// existing client error copy keeps working.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum AccountError {
    InstructionFallbackNotFound = 101,
    InstructionDidNotDeserialize = 102,
    ConstraintMut = 2000,
    ConstraintSeeds = 2006,
    ConstraintAddress = 2012,
    AccountDiscriminatorMismatch = 3002,
    AccountDidNotDeserialize = 3003,
    AccountNotEnoughKeys = 3005,
    AccountOwnedByWrongProgram = 3007,
    InvalidProgramId = 3008,
    AccountNotSigner = 3010,
    AccountNotInitialized = 3012,
    AccountNotProgramData = 3013,
    AccountSysvarMismatch = 3015,
}

impl From<AccountError> for ProgramError {
    fn from(error: AccountError) -> Self {
        ProgramError::Custom(error as u32)
    }
}

/// Shorthand for `Err(error.into())`.
#[inline(always)]
pub fn fail<T>(error: impl Into<ProgramError>) -> Result<T, ProgramError> {
    Err(error.into())
}

/// Turns a checked-arithmetic `None` into `MathOverflow`.
pub trait OrOverflow<T> {
    fn or_overflow(self) -> Result<T, ProgramError>;
}

impl<T> OrOverflow<T> for Option<T> {
    #[inline(always)]
    fn or_overflow(self) -> Result<T, ProgramError> {
        self.ok_or(ProgramError::Custom(RingioError::MathOverflow as u32))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_match_the_published_anchor_numbering() {
        assert_eq!(RingioError::ProtocolPaused as u32, 6000);
        assert_eq!(RingioError::GroupFull as u32, 6007);
        assert_eq!(RingioError::ContributionAlreadyResolved as u32, 6019);
        assert_eq!(RingioError::GracePeriodActive as u32, 6021);
        assert_eq!(RingioError::CancellationNotAllowed as u32, 6029);
        assert_eq!(RingioError::InvariantViolation as u32, 6034);
    }
}
