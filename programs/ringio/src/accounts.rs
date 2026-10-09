//! Account validation and CPI helpers. Every check the former Anchor
//! `#[derive(Accounts)]` structs performed is reproduced explicitly here:
//! owner, discriminator, exact size, PDA seeds, signer, writability, program
//! ids, sysvar ids, and classic SPL Token account/mint validity.

use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::{create_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent},
    ProgramResult,
};
use pinocchio_system::instructions::{Allocate, Assign, CreateAccount, Transfer};
use pinocchio_token::instructions::{InitializeAccount3, TransferChecked};

use crate::constants::{SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID};
use crate::error::{fail, AccountError, RingioError};

pub const TOKEN_ACCOUNT_LEN: usize = 165;
pub const MINT_LEN: usize = 82;

#[inline(always)]
pub fn require(condition: bool, error: impl Into<ProgramError>) -> ProgramResult {
    if condition {
        Ok(())
    } else {
        Err(error.into())
    }
}

pub fn signer(info: &AccountInfo) -> ProgramResult {
    require(info.is_signer(), AccountError::AccountNotSigner)
}

pub fn writable(info: &AccountInfo) -> ProgramResult {
    require(info.is_writable(), AccountError::ConstraintMut)
}

pub fn program(info: &AccountInfo, id: &Pubkey) -> ProgramResult {
    require(info.key() == id, AccountError::InvalidProgramId)
}

/// The account must already exist, be owned by `owner`, and (for program
/// accounts) carry the expected discriminator and exact size.
#[inline(never)]
pub fn owned(info: &AccountInfo, owner: &Pubkey) -> ProgramResult {
    if info.owner() == owner {
        return Ok(());
    }
    if info.owner() == &SYSTEM_PROGRAM_ID && info.lamports() == 0 {
        return fail(AccountError::AccountNotInitialized);
    }
    fail(AccountError::AccountOwnedByWrongProgram)
}

#[inline(never)]
pub fn program_account(
    info: &AccountInfo,
    program_id: &Pubkey,
    discriminator: &[u8; 8],
    len: usize,
) -> ProgramResult {
    owned(info, program_id)?;
    let data = info.try_borrow_data()?;
    if data.len() < 8 || &data[..8] != discriminator {
        return fail(AccountError::AccountDiscriminatorMismatch);
    }
    require(data.len() == len, AccountError::AccountDidNotDeserialize)
}

/// Seeds include the stored bump; the derived address must equal the account key.
#[inline(never)]
pub fn pda(info: &AccountInfo, seeds: &[&[u8]], program_id: &Pubkey) -> ProgramResult {
    let derived = create_program_address(seeds, program_id)
        .map_err(|_| ProgramError::from(AccountError::ConstraintSeeds))?;
    require(&derived == info.key(), AccountError::ConstraintSeeds)
}

pub fn now() -> Result<i64, ProgramError> {
    #[cfg(target_os = "solana")]
    {
        let mut clock = core::mem::MaybeUninit::<Clock>::uninit();
        // SAFETY: the dedicated clock syscall fully initializes a `Clock`.
        let result =
            unsafe { pinocchio::syscalls::sol_get_clock_sysvar(clock.as_mut_ptr() as *mut u8) };
        if result != pinocchio::SUCCESS {
            return Err(ProgramError::UnsupportedSysvar);
        }
        Ok(unsafe { clock.assume_init() }.unix_timestamp)
    }
    #[cfg(not(target_os = "solana"))]
    {
        let _ = core::mem::size_of::<Clock>();
        Err(ProgramError::UnsupportedSysvar)
    }
}

/// Rent-exempt minimum using integer math only (no soft-float code in the
/// binary). Supports the current 2-year threshold and SIMD-0194's 1-year
/// threshold; any other value fails closed instead of under-funding.
pub fn rent_exempt_minimum(len: usize) -> Result<u64, ProgramError> {
    #[cfg(target_os = "solana")]
    {
        let mut rent = core::mem::MaybeUninit::<Rent>::uninit();
        // SAFETY: the dedicated rent syscall fully initializes a `Rent`.
        let result =
            unsafe { pinocchio::syscalls::sol_get_rent_sysvar(rent.as_mut_ptr() as *mut u8) };
        if result != pinocchio::SUCCESS {
            return Err(ProgramError::UnsupportedSysvar);
        }
        let rent = unsafe { rent.assume_init() };
        #[allow(deprecated)]
        let (per_byte, threshold) = (
            rent.lamports_per_byte_year,
            rent.exemption_threshold.to_bits(),
        );
        rent_from_parts(per_byte, threshold, len)
    }
    #[cfg(not(target_os = "solana"))]
    {
        let _ = (core::mem::size_of::<Rent>(), len);
        Err(ProgramError::UnsupportedSysvar)
    }
}

const TWO_F64_BITS: u64 = 0x4000_0000_0000_0000;
const ONE_F64_BITS: u64 = 0x3ff0_0000_0000_0000;

pub fn rent_from_parts(
    lamports_per_byte_year: u64,
    threshold_bits: u64,
    len: usize,
) -> Result<u64, ProgramError> {
    let years = match threshold_bits {
        TWO_F64_BITS => 2,
        ONE_F64_BITS => 1,
        _ => return Err(ProgramError::UnsupportedSysvar),
    };
    (len as u64)
        .checked_add(128)
        .and_then(|bytes| bytes.checked_mul(lamports_per_byte_year))
        .and_then(|lamports| lamports.checked_mul(years))
        .ok_or(ProgramError::ArithmeticOverflow)
}

/// Creates a rent-exempt PDA account, tolerating a pre-funded address the way
/// Anchor's `init` does (top up, allocate, assign) so nobody can grief
/// creation by sending lamports to the address first. Fails if the account
/// already holds data or belongs to another program.
#[inline(never)]
pub fn create_pda(
    payer: &AccountInfo,
    target: &AccountInfo,
    space: usize,
    owner: &Pubkey,
    seeds: &[Seed],
) -> ProgramResult {
    let required = rent_exempt_minimum(space)?;
    let signers = [Signer::from(seeds)];
    let current = target.lamports();
    if current == 0 {
        return CreateAccount {
            from: payer,
            to: target,
            lamports: required,
            space: space as u64,
            owner,
        }
        .invoke_signed(&signers);
    }
    let top_up = required.saturating_sub(current);
    if top_up > 0 {
        Transfer {
            from: payer,
            to: target,
            lamports: top_up,
        }
        .invoke()?;
    }
    Allocate {
        account: target,
        space: space as u64,
    }
    .invoke_signed(&signers)?;
    Assign {
        account: target,
        owner,
    }
    .invoke_signed(&signers)
}

/// Creates a classic SPL Token account at a PDA, owned (authority) by `authority`.
#[inline(never)]
pub fn create_token_vault(
    payer: &AccountInfo,
    vault: &AccountInfo,
    mint: &AccountInfo,
    authority: &Pubkey,
    seeds: &[Seed],
) -> ProgramResult {
    create_pda(payer, vault, TOKEN_ACCOUNT_LEN, &TOKEN_PROGRAM_ID, seeds)?;
    InitializeAccount3 {
        account: vault,
        mint,
        owner: authority,
    }
    .invoke()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rent_matches_the_runtime_formula() {
        // Default cluster rent: 3480 lamports per byte-year, 2-year exemption.
        assert_eq!(rent_from_parts(3_480, 2.0f64.to_bits(), 165), Ok(2_039_280));
        assert_eq!(
            rent_from_parts(3_480, 2.0f64.to_bits(), 2_387),
            Ok(17_504_400)
        );
        assert_eq!(rent_from_parts(6_960, 1.0f64.to_bits(), 165), Ok(2_039_280));
        assert!(rent_from_parts(3_480, 1.5f64.to_bits(), 165).is_err());
    }
}

#[derive(Clone, Copy)]
pub struct TokenAccount {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}

/// An initialized classic SPL Token account (Token-2022 is not accepted).
#[inline(never)]
pub fn token_account(info: &AccountInfo) -> Result<TokenAccount, ProgramError> {
    owned(info, &TOKEN_PROGRAM_ID)?;
    let data = info.try_borrow_data()?;
    if data.len() != TOKEN_ACCOUNT_LEN || data[108] == 0 {
        return fail(AccountError::AccountDidNotDeserialize);
    }
    let mut mint = [0u8; 32];
    let mut owner = [0u8; 32];
    let mut amount = [0u8; 8];
    mint.copy_from_slice(&data[0..32]);
    owner.copy_from_slice(&data[32..64]);
    amount.copy_from_slice(&data[64..72]);
    Ok(TokenAccount {
        mint,
        owner,
        amount: u64::from_le_bytes(amount),
    })
}

/// An initialized classic SPL Token mint; returns its decimals.
#[inline(never)]
pub fn mint_decimals(info: &AccountInfo) -> Result<u8, ProgramError> {
    owned(info, &TOKEN_PROGRAM_ID)?;
    let data = info.try_borrow_data()?;
    if data.len() != MINT_LEN || data[45] != 1 {
        return fail(AccountError::AccountDidNotDeserialize);
    }
    Ok(data[44])
}

/// A token account with the circle mint, owned by `owner`.
#[inline(never)]
pub fn user_token_account(
    info: &AccountInfo,
    mint: &Pubkey,
    owner: &Pubkey,
) -> Result<TokenAccount, ProgramError> {
    writable(info)?;
    let account = token_account(info)?;
    require(&account.mint == mint, RingioError::WrongMint)?;
    require(&account.owner == owner, RingioError::WrongTokenAuthority)?;
    Ok(account)
}

/// One of the circle's own vaults: canonical address, circle mint, circle authority.
#[inline(never)]
pub fn vault(
    info: &AccountInfo,
    expected: &Pubkey,
    mint: &Pubkey,
    group: &Pubkey,
) -> Result<TokenAccount, ProgramError> {
    require(info.key() == expected, RingioError::WrongVault)?;
    let account = token_account(info)?;
    require(&account.mint == mint, RingioError::WrongMint)?;
    require(&account.owner == group, RingioError::WrongTokenAuthority)?;
    Ok(account)
}

/// `transfer_checked`, optionally signed by the group PDA.
#[inline(never)]
pub fn transfer(
    from: &AccountInfo,
    mint: &AccountInfo,
    to: &AccountInfo,
    authority: &AccountInfo,
    amount: u64,
    decimals: u8,
    group_seeds: Option<&[Seed]>,
) -> ProgramResult {
    let instruction = TransferChecked {
        from,
        mint,
        to,
        authority,
        amount,
        decimals,
    };
    match group_seeds {
        Some(seeds) => instruction.invoke_signed(&[Signer::from(seeds)]),
        None => instruction.invoke(),
    }
}
