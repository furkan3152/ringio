//! Account layouts. Byte offsets are identical to the former Anchor/Borsh
//! layout (8-byte discriminator, then fields in declaration order without
//! padding), so accounts created by the previous program remain valid.

use pinocchio::{program_error::ProgramError, pubkey::Pubkey};

use crate::constants::{discriminator, MAX_MEMBERS, STATE_VERSION};
use crate::error::{AccountError, RingioError};

/// Views account data as a fixed-size array so constant-offset field access
/// compiles without bounds checks; a wrong length fails closed.
#[inline(always)]
fn fixed<const N: usize>(data: &[u8]) -> Result<&[u8; N], ProgramError> {
    data.try_into()
        .map_err(|_| ProgramError::from(AccountError::AccountDidNotDeserialize))
}

#[inline(always)]
fn fixed_mut<const N: usize>(data: &mut [u8]) -> Result<&mut [u8; N], ProgramError> {
    data.try_into()
        .map_err(|_| ProgramError::from(AccountError::AccountDidNotDeserialize))
}

/// The `index`-th 32-byte slot of the array at `base`. Out-of-range access
/// fails closed instead of panicking.
#[inline(never)]
fn slot(data: &[u8], base: usize, index: usize) -> Result<&[u8; 32], ProgramError> {
    if index >= MAX_MEMBERS {
        return Err(RingioError::InvariantViolation.into());
    }
    let start = base + index * 32;
    data.get(start..start + 32)
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or(RingioError::InvariantViolation.into())
}

#[inline(never)]
fn slot_mut(data: &mut [u8], base: usize, index: usize) -> Result<&mut [u8; 32], ProgramError> {
    if index >= MAX_MEMBERS {
        return Err(RingioError::InvariantViolation.into());
    }
    let start = base + index * 32;
    data.get_mut(start..start + 32)
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or(RingioError::InvariantViolation.into())
}

#[inline(always)]
fn read_key(data: &[u8], offset: usize) -> Pubkey {
    let mut key = [0u8; 32];
    key.copy_from_slice(&data[offset..offset + 32]);
    key
}

#[inline(always)]
fn read_u16(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([data[offset], data[offset + 1]])
}

#[inline(always)]
fn read_u64(data: &[u8], offset: usize) -> u64 {
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&data[offset..offset + 8]);
    u64::from_le_bytes(bytes)
}

#[inline(always)]
fn read_i64(data: &[u8], offset: usize) -> i64 {
    read_u64(data, offset) as i64
}

#[inline(always)]
fn write(data: &mut [u8], offset: usize, bytes: &[u8]) {
    data[offset..offset + bytes.len()].copy_from_slice(bytes);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum GroupStatus {
    Forming = 0,
    Revealing = 1,
    Collateralizing = 2,
    Active = 3,
    Completed = 4,
    Cancelled = 5,
    Defaulted = 6,
}

impl GroupStatus {
    pub fn from_u8(value: u8) -> Option<Self> {
        Some(match value {
            0 => Self::Forming,
            1 => Self::Revealing,
            2 => Self::Collateralizing,
            3 => Self::Active,
            4 => Self::Completed,
            5 => Self::Cancelled,
            6 => Self::Defaulted,
            _ => return None,
        })
    }

    pub const fn event_code(self) -> u8 {
        self as u8
    }
}

// ----------------------------------------------------------------- Config

pub const CONFIG_LEN: usize = 136;

#[derive(Clone, Copy, Debug)]
pub struct Config {
    pub admin: Pubkey,
    pub pause_authority: Pubkey,
    pub paused_at: i64,
    pub total_paused_seconds: u64,
    pub paused: bool,
    pub bump: u8,
}

impl Config {
    pub fn load(data: &[u8]) -> Result<Self, ProgramError> {
        let data = fixed::<CONFIG_LEN>(data)?;
        Ok(Self {
            admin: read_key(data, 8),
            pause_authority: read_key(data, 40),
            paused_at: read_i64(data, 72),
            total_paused_seconds: read_u64(data, 80),
            paused: data[88] == 1,
            bump: data[89],
        })
    }

    /// Writes every field (used for both initialization and updates).
    #[inline(never)]
    pub fn store(&self, data: &mut [u8]) -> Result<(), ProgramError> {
        let data = fixed_mut::<CONFIG_LEN>(data)?;
        write(data, 0, &discriminator::CONFIG);
        write(data, 8, &self.admin);
        write(data, 40, &self.pause_authority);
        write(data, 72, &self.paused_at.to_le_bytes());
        write(data, 80, &self.total_paused_seconds.to_le_bytes());
        data[88] = self.paused as u8;
        data[89] = self.bump;
        data[90] = STATE_VERSION;
        Ok(())
    }
}

// ------------------------------------------------------------------ Group

pub const GROUP_LEN: usize = 2_387;
const G_ENTROPY: usize = 136;
const G_MEMBERS: usize = 168;
const G_PAYOUT_ORDER: usize = 168 + 32 * MAX_MEMBERS;

/// Every scalar field of a Group. The roster, payout order and entropy arrays
/// stay in account data and are accessed in place to keep stack use small.
#[derive(Clone, Copy, Debug)]
pub struct Group {
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub pot_vault: Pubkey,
    pub collateral_vault: Pubkey,
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
    pub phase_pause_snapshot: u64,
}

impl Group {
    /// Fails for a wrong length, an unknown status byte, or an out-of-range member count.
    #[inline(never)]
    pub fn load(data: &[u8]) -> Result<Self, ProgramError> {
        let data = fixed::<GROUP_LEN>(data)?;
        let invalid = || ProgramError::from(AccountError::AccountDidNotDeserialize);
        let member_count = read_u16(data, 2_328);
        if member_count < crate::constants::MIN_MEMBERS || usize::from(member_count) > MAX_MEMBERS {
            return Err(invalid());
        }
        Ok(Self {
            creator: read_key(data, 8),
            mint: read_key(data, 40),
            pot_vault: read_key(data, 72),
            collateral_vault: read_key(data, 104),
            id: read_u64(data, 2_216),
            contribution_amount: read_u64(data, 2_224),
            total_collateral_locked: read_u64(data, 2_232),
            period_seconds: read_i64(data, 2_240),
            grace_seconds: read_i64(data, 2_248),
            join_deadline: read_i64(data, 2_256),
            reveal_window_seconds: read_i64(data, 2_264),
            collateral_window_seconds: read_i64(data, 2_272),
            reveal_deadline: read_i64(data, 2_280),
            collateral_deadline: read_i64(data, 2_288),
            created_at: read_i64(data, 2_296),
            reveal_started_at: read_i64(data, 2_304),
            collateral_started_at: read_i64(data, 2_312),
            round_started_at: read_i64(data, 2_320),
            member_count,
            joined_count: read_u16(data, 2_330),
            revealed_count: read_u16(data, 2_332),
            collateralized_count: read_u16(data, 2_334),
            current_round: read_u16(data, 2_336),
            round_contributions: read_u16(data, 2_338),
            failed_round: read_u16(data, 2_340),
            status: GroupStatus::from_u8(data[2_342]).ok_or_else(invalid)?,
            bump: data[2_343],
            pot_vault_bump: data[2_344],
            collateral_vault_bump: data[2_345],
            phase_pause_snapshot: read_u64(data, 2_347),
        })
    }

    /// Writes every scalar field plus the discriminator and version. The
    /// roster, order and entropy arrays are untouched.
    #[inline(never)]
    pub fn store(&self, data: &mut [u8]) -> Result<(), ProgramError> {
        let data = fixed_mut::<GROUP_LEN>(data)?;
        write(data, 0, &discriminator::GROUP);
        write(data, 8, &self.creator);
        write(data, 40, &self.mint);
        write(data, 72, &self.pot_vault);
        write(data, 104, &self.collateral_vault);
        write(data, 2_216, &self.id.to_le_bytes());
        write(data, 2_224, &self.contribution_amount.to_le_bytes());
        write(data, 2_232, &self.total_collateral_locked.to_le_bytes());
        write(data, 2_240, &self.period_seconds.to_le_bytes());
        write(data, 2_248, &self.grace_seconds.to_le_bytes());
        write(data, 2_256, &self.join_deadline.to_le_bytes());
        write(data, 2_264, &self.reveal_window_seconds.to_le_bytes());
        write(data, 2_272, &self.collateral_window_seconds.to_le_bytes());
        write(data, 2_280, &self.reveal_deadline.to_le_bytes());
        write(data, 2_288, &self.collateral_deadline.to_le_bytes());
        write(data, 2_296, &self.created_at.to_le_bytes());
        write(data, 2_304, &self.reveal_started_at.to_le_bytes());
        write(data, 2_312, &self.collateral_started_at.to_le_bytes());
        write(data, 2_320, &self.round_started_at.to_le_bytes());
        write(data, 2_328, &self.member_count.to_le_bytes());
        write(data, 2_330, &self.joined_count.to_le_bytes());
        write(data, 2_332, &self.revealed_count.to_le_bytes());
        write(data, 2_334, &self.collateralized_count.to_le_bytes());
        write(data, 2_336, &self.current_round.to_le_bytes());
        write(data, 2_338, &self.round_contributions.to_le_bytes());
        write(data, 2_340, &self.failed_round.to_le_bytes());
        data[2_342] = self.status as u8;
        data[2_343] = self.bump;
        data[2_344] = self.pot_vault_bump;
        data[2_345] = self.collateral_vault_bump;
        data[2_346] = STATE_VERSION;
        write(data, 2_347, &self.phase_pause_snapshot.to_le_bytes());
        Ok(())
    }

    pub fn member_at(data: &[u8], index: usize) -> Result<Pubkey, ProgramError> {
        slot(data, G_MEMBERS, index).copied()
    }

    pub fn set_member_at(
        data: &mut [u8],
        index: usize,
        wallet: &Pubkey,
    ) -> Result<(), ProgramError> {
        *slot_mut(data, G_MEMBERS, index)? = *wallet;
        Ok(())
    }

    pub fn payout_at(data: &[u8], index: usize) -> Result<Pubkey, ProgramError> {
        slot(data, G_PAYOUT_ORDER, index).copied()
    }

    pub fn set_payout_at(
        data: &mut [u8],
        index: usize,
        wallet: &Pubkey,
    ) -> Result<(), ProgramError> {
        *slot_mut(data, G_PAYOUT_ORDER, index)? = *wallet;
        Ok(())
    }

    pub fn entropy(data: &[u8]) -> Result<[u8; 32], ProgramError> {
        slot(data, G_ENTROPY, 0).copied()
    }

    pub fn set_entropy(data: &mut [u8], entropy: &[u8; 32]) -> Result<(), ProgramError> {
        *slot_mut(data, G_ENTROPY, 0)? = *entropy;
        Ok(())
    }

    /// Payout rank of `wallet` within the finalized order, if present.
    pub fn rank_of(
        data: &[u8],
        member_count: u16,
        wallet: &Pubkey,
    ) -> Result<Option<u16>, ProgramError> {
        for index in 0..usize::from(member_count) {
            if &Self::payout_at(data, index)? == wallet {
                return Ok(Some(index as u16));
            }
        }
        Ok(None)
    }

    pub fn is_member(
        data: &[u8],
        joined_count: u16,
        wallet: &Pubkey,
    ) -> Result<bool, ProgramError> {
        for index in 0..usize::from(joined_count) {
            if &Self::member_at(data, index)? == wallet {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn expected_recipient(&self, data: &[u8]) -> Result<Option<Pubkey>, ProgramError> {
        if self.current_round < self.member_count {
            return Self::payout_at(data, usize::from(self.current_round)).map(Some);
        }
        Ok(None)
    }
}

// ----------------------------------------------------------------- Invite

pub const INVITE_LEN: usize = 104;

#[derive(Clone, Copy, Debug)]
pub struct Invite {
    pub group: Pubkey,
    pub invitee: Pubkey,
    pub used: bool,
    pub bump: u8,
}

impl Invite {
    pub fn load(data: &[u8]) -> Result<Self, ProgramError> {
        let data = fixed::<INVITE_LEN>(data)?;
        Ok(Self {
            group: read_key(data, 8),
            invitee: read_key(data, 40),
            used: data[72] == 1,
            bump: data[73],
        })
    }

    pub fn store(&self, data: &mut [u8]) -> Result<(), ProgramError> {
        let data = fixed_mut::<INVITE_LEN>(data)?;
        write(data, 0, &discriminator::INVITE);
        write(data, 8, &self.group);
        write(data, 40, &self.invitee);
        data[72] = self.used as u8;
        data[73] = self.bump;
        Ok(())
    }
}

// ----------------------------------------------------------------- Member

pub const MEMBER_LEN: usize = 190;

#[derive(Clone, Copy, Debug)]
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
}

impl Member {
    pub fn new(
        group: Pubkey,
        wallet: Pubkey,
        commitment: [u8; 32],
        joined_index: u16,
        bump: u8,
    ) -> Self {
        Self {
            group,
            wallet,
            commitment,
            reveal_digest: [0; 32],
            collateral_locked: 0,
            joined_index,
            payout_rank: crate::constants::UNSET_ROUND,
            last_contributed_round: crate::constants::UNSET_ROUND,
            last_refunded_round: crate::constants::UNSET_ROUND,
            defaults: 0,
            revealed: false,
            collateral_posted: false,
            payout_received: false,
            last_resolution_kind: crate::constants::RESOLUTION_NONE,
            bump,
        }
    }

    #[inline(never)]
    pub fn load(data: &[u8]) -> Result<Self, ProgramError> {
        let data = fixed::<MEMBER_LEN>(data)?;
        Ok(Self {
            group: read_key(data, 8),
            wallet: read_key(data, 40),
            commitment: read_key(data, 72),
            reveal_digest: read_key(data, 104),
            collateral_locked: read_u64(data, 136),
            joined_index: read_u16(data, 144),
            payout_rank: read_u16(data, 146),
            last_contributed_round: read_u16(data, 148),
            last_refunded_round: read_u16(data, 150),
            defaults: read_u16(data, 152),
            revealed: data[154] == 1,
            collateral_posted: data[155] == 1,
            payout_received: data[156] == 1,
            last_resolution_kind: data[157],
            bump: data[158],
        })
    }

    #[inline(never)]
    pub fn store(&self, data: &mut [u8]) -> Result<(), ProgramError> {
        let data = fixed_mut::<MEMBER_LEN>(data)?;
        write(data, 0, &discriminator::MEMBER);
        write(data, 8, &self.group);
        write(data, 40, &self.wallet);
        write(data, 72, &self.commitment);
        write(data, 104, &self.reveal_digest);
        write(data, 136, &self.collateral_locked.to_le_bytes());
        write(data, 144, &self.joined_index.to_le_bytes());
        write(data, 146, &self.payout_rank.to_le_bytes());
        write(data, 148, &self.last_contributed_round.to_le_bytes());
        write(data, 150, &self.last_refunded_round.to_le_bytes());
        write(data, 152, &self.defaults.to_le_bytes());
        data[154] = self.revealed as u8;
        data[155] = self.collateral_posted as u8;
        data[156] = self.payout_received as u8;
        data[157] = self.last_resolution_kind;
        data[158] = self.bump;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use std::vec;

    #[test]
    fn group_round_trips_scalar_fields_and_arrays_in_place() {
        let mut data = vec![0u8; GROUP_LEN];
        data[2_328] = 4;
        let mut group = Group::load(&data).unwrap();
        group.creator = [1; 32];
        group.mint = [2; 32];
        group.id = 42;
        group.contribution_amount = 1_000_000;
        group.period_seconds = 604_800;
        group.phase_pause_snapshot = 11;
        group.status = GroupStatus::Active;
        group.failed_round = crate::constants::UNSET_ROUND;
        group.store(&mut data).unwrap();
        Group::set_member_at(&mut data, 1, &[5; 32]).unwrap();
        Group::set_payout_at(&mut data, 3, &[6; 32]).unwrap();
        assert!(Group::set_member_at(&mut data, MAX_MEMBERS, &[5; 32]).is_err());
        assert!(Group::payout_at(&data[..100], 0).is_err());

        // Offsets used by the TypeScript decoder.
        assert_eq!(&data[0..8], &discriminator::GROUP);
        assert_eq!(&data[8..40], &[1; 32]);
        assert_eq!(&data[200..232], &[5; 32]);
        assert_eq!(&data[1_192 + 96..1_192 + 128], &[6; 32]);
        assert_eq!(data[2_342], 3);
        assert_eq!(data[2_346], STATE_VERSION);

        let reloaded = Group::load(&data).unwrap();
        assert_eq!(reloaded.id, 42);
        assert_eq!(reloaded.contribution_amount, 1_000_000);
        assert_eq!(reloaded.phase_pause_snapshot, 11);
        assert_eq!(reloaded.status, GroupStatus::Active);
        assert_eq!(Group::rank_of(&data, 4, &[6; 32]), Ok(Some(3)));
        assert_eq!(Group::is_member(&data, 2, &[5; 32]), Ok(true));
        assert_eq!(Group::is_member(&data, 1, &[5; 32]), Ok(false));
    }

    #[test]
    fn group_load_rejects_unknown_status_and_member_count() {
        let mut data = vec![0u8; GROUP_LEN];
        data[2_328] = 1;
        assert!(Group::load(&data).is_err());
        data[2_328] = 2;
        data[2_342] = 7;
        assert!(Group::load(&data).is_err());
        assert!(Group::load(&data[..GROUP_LEN - 1]).is_err());
    }

    #[test]
    fn member_and_config_round_trip() {
        let mut data = vec![0u8; MEMBER_LEN];
        let member = Member::new([1; 32], [2; 32], [3; 32], 4, 254);
        member.store(&mut data).unwrap();
        let loaded = Member::load(&data).unwrap();
        assert_eq!(loaded.payout_rank, crate::constants::UNSET_ROUND);
        assert_eq!(loaded.joined_index, 4);
        assert_eq!(loaded.bump, 254);
        assert_eq!(&data[0..8], &discriminator::MEMBER);

        let mut config_data = vec![0u8; CONFIG_LEN];
        let config = Config {
            admin: [7; 32],
            pause_authority: [8; 32],
            paused_at: 0,
            total_paused_seconds: 9,
            paused: true,
            bump: 253,
        };
        config.store(&mut config_data).unwrap();
        let loaded = Config::load(&config_data).unwrap();
        assert_eq!(loaded.total_paused_seconds, 9);
        assert!(loaded.paused);
        assert_eq!(config_data[90], STATE_VERSION);
    }
}
