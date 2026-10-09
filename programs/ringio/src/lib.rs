//! Ringio — invite-only, collateralized rotating savings circles on Solana.
//!
//! Written with Pinocchio (no Anchor, no heap) to keep the deployed binary —
//! and therefore the SOL locked as program rent — as small as possible. The
//! external interface is byte-for-byte identical to the original Anchor
//! program: account layouts, 8-byte instruction/account/event
//! discriminators, Borsh argument encoding, account order, and error codes.
#![no_std]

pub mod accounts;
pub mod constants;
pub mod error;
pub mod events;
pub mod hash;
pub mod math;
pub mod processor;
pub mod state;

use pinocchio::{account_info::AccountInfo, pubkey::Pubkey, ProgramResult};

use constants::discriminator as ix;
use error::AccountError;

pinocchio_pubkey::declare_id!("JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy");

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint {
    use pinocchio::{no_allocator, nostd_panic_handler, program_entrypoint};

    program_entrypoint!(crate::process_instruction);
    no_allocator!();
    nostd_panic_handler!();
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Like Anchor: unknown or short discriminators hit the missing fallback,
    // and bytes after the arguments are ignored.
    if data.len() < 8 {
        return Err(AccountError::InstructionFallbackNotFound.into());
    }
    let (discriminator, args) = data.split_at(8);
    let no_args =
        |handler: fn(&Pubkey, &[AccountInfo]) -> ProgramResult| handler(program_id, accounts);
    match discriminator {
        d if d == ix::CREATE_GROUP => processor::create_group(program_id, accounts, args),
        d if d == ix::INVITE_MEMBER => processor::invite_member(program_id, accounts, args),
        d if d == ix::JOIN_GROUP => processor::join_group(program_id, accounts, args),
        d if d == ix::REVEAL_SECRET => processor::reveal_secret(program_id, accounts, args),
        d if d == ix::FINALIZE_ORDER => no_args(processor::finalize_order),
        d if d == ix::POST_COLLATERAL => no_args(processor::post_collateral),
        d if d == ix::ACTIVATE_GROUP => no_args(processor::activate_group),
        d if d == ix::CONTRIBUTE => no_args(processor::contribute),
        d if d == ix::COVER_DEFAULT => no_args(processor::cover_default),
        d if d == ix::SETTLE_ROUND => no_args(processor::settle_round),
        d if d == ix::ABORT_UNCOVERED_ROUND => no_args(processor::abort_uncovered_round),
        d if d == ix::CANCEL_GROUP => no_args(processor::cancel_group),
        d if d == ix::REFUND_FAILED_ROUND => no_args(processor::refund_failed_round),
        d if d == ix::REFUND_COLLATERAL => no_args(processor::refund_collateral),
        d if d == ix::INITIALIZE_CONFIG => processor::initialize_config(program_id, accounts, args),
        d if d == ix::SET_PAUSED => processor::set_paused(program_id, accounts, args),
        d if d == ix::UPDATE_PAUSE_AUTHORITY => {
            processor::update_pause_authority(program_id, accounts, args)
        }
        _ => Err(AccountError::InstructionFallbackNotFound.into()),
    }
}
