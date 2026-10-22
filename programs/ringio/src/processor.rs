//! Instruction handlers. Each handler validates its accounts exactly as the
//! former Anchor account structs did, then applies the same state machine.

use pinocchio::{
    account_info::AccountInfo, instruction::Seed, program_error::ProgramError, pubkey::Pubkey,
    ProgramResult,
};

use crate::accounts::{
    create_pda, create_token_vault, mint_decimals, now, owned, pda, program, program_account,
    require, signer, transfer, user_token_account, vault, writable,
};
use crate::constants::*;
use crate::error::{fail, AccountError, OrOverflow, RingioError};
use crate::events::{discriminator as event, Event};
use crate::math;
use crate::state::{
    Config, Group, GroupStatus, Invite, Member, CONFIG_LEN, GROUP_LEN, INVITE_LEN, MEMBER_LEN,
};

// ------------------------------------------------------------- loaders

// Anchor validates accounts in two passes: first it deserializes every
// account (owner, discriminator, layout, signer, program id), then it creates
// `init` accounts, then it checks the remaining constraints (seeds before
// `mut`). The `read_*` / `*_address` split keeps that order where it is
// observable.

#[inline(never)]
fn read_config(info: &AccountInfo, program_id: &Pubkey) -> Result<Config, ProgramError> {
    program_account(info, program_id, &discriminator::CONFIG, CONFIG_LEN)?;
    Config::load(&info.try_borrow_data()?)
}

fn config_address(info: &AccountInfo, config: &Config, program_id: &Pubkey) -> ProgramResult {
    pda(info, &[CONFIG_SEED, &[config.bump]], program_id)
}

#[inline(never)]
fn load_config(info: &AccountInfo, program_id: &Pubkey) -> Result<Config, ProgramError> {
    let config = read_config(info, program_id)?;
    config_address(info, &config, program_id)?;
    Ok(config)
}

fn store_config(info: &AccountInfo, config: &Config) -> ProgramResult {
    config.store(&mut info.try_borrow_mut_data()?)
}

fn require_unpaused(config: &Config) -> ProgramResult {
    require(!config.paused, RingioError::ProtocolPaused)
}

#[inline(never)]
fn read_group(info: &AccountInfo, program_id: &Pubkey) -> Result<Group, ProgramError> {
    program_account(info, program_id, &discriminator::GROUP, GROUP_LEN)?;
    Group::load(&info.try_borrow_data()?)
}

#[inline(never)]
fn group_address(info: &AccountInfo, group: &Group, program_id: &Pubkey) -> ProgramResult {
    pda(
        info,
        &[
            GROUP_SEED,
            &group.creator,
            &group.id.to_le_bytes(),
            &[group.bump],
        ],
        program_id,
    )
}

fn load_group(info: &AccountInfo, program_id: &Pubkey) -> Result<Group, ProgramError> {
    let group = read_group(info, program_id)?;
    group_address(info, &group, program_id)?;
    Ok(group)
}

fn load_group_mut(info: &AccountInfo, program_id: &Pubkey) -> Result<Group, ProgramError> {
    let group = load_group(info, program_id)?;
    writable(info)?;
    Ok(group)
}

#[inline(never)]
fn store_group(info: &AccountInfo, group: &Group) -> ProgramResult {
    group.store(&mut info.try_borrow_mut_data()?)
}

#[inline(never)]
fn read_member(info: &AccountInfo, program_id: &Pubkey) -> Result<Member, ProgramError> {
    program_account(info, program_id, &discriminator::MEMBER, MEMBER_LEN)?;
    Member::load(&info.try_borrow_data()?)
}

/// Member of `group` at the canonical `("member", group, member.wallet)` PDA.
/// `link_error` is the error for a member that belongs to another group.
#[inline(never)]
fn load_member(
    info: &AccountInfo,
    program_id: &Pubkey,
    group: &Pubkey,
    link_error: RingioError,
) -> Result<Member, ProgramError> {
    let member = read_member(info, program_id)?;
    pda(
        info,
        &[MEMBER_SEED, group, &member.wallet, &[member.bump]],
        program_id,
    )?;
    require(&member.group == group, link_error)?;
    Ok(member)
}

/// The signer's own Member account (writable), at `("member", group, signer)`.
#[inline(never)]
fn load_own_member(
    info: &AccountInfo,
    program_id: &Pubkey,
    group: &Pubkey,
    participant: &AccountInfo,
) -> Result<Member, ProgramError> {
    let member = read_member(info, program_id)?;
    pda(
        info,
        &[MEMBER_SEED, group, participant.key(), &[member.bump]],
        program_id,
    )?;
    writable(info)?;
    require(
        &member.group == group && &member.wallet == participant.key(),
        RingioError::Unauthorized,
    )?;
    Ok(member)
}

#[inline(never)]
fn store_member(info: &AccountInfo, member: &Member) -> ProgramResult {
    member.store(&mut info.try_borrow_mut_data()?)
}

/// The first `N` bytes of an account, if it has that many.
fn header<const N: usize>(info: &AccountInfo) -> Option<[u8; N]> {
    info.try_borrow_data().ok()?.get(..N)?.try_into().ok()
}

/// Verifies `info` is the canonical PDA for `seeds` and returns its bump.
#[inline(never)]
fn find_pda(info: &AccountInfo, seeds: &[&[u8]], program_id: &Pubkey) -> Result<u8, ProgramError> {
    let (address, bump) = pinocchio::pubkey::find_program_address(seeds, program_id);
    require(&address == info.key(), AccountError::ConstraintSeeds)?;
    Ok(bump)
}

fn deadline(base: i64, config: &Config, group: &Group) -> Result<i64, ProgramError> {
    math::effective_deadline(
        base,
        config.total_paused_seconds,
        group.phase_pause_snapshot,
    )
    .or_overflow()
}

fn grace_ends(config: &Config, group: &Group) -> Result<i64, ProgramError> {
    let base = math::round_grace_ends(
        group.round_started_at,
        group.period_seconds,
        group.grace_seconds,
    )
    .or_overflow()?;
    deadline(base, config, group)
}

/// Borsh-decodes a fixed-size argument. Like Anchor, trailing bytes are ignored.
fn args<const N: usize>(data: &[u8]) -> Result<&[u8; N], ProgramError> {
    data.get(..N)
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or(ProgramError::Custom(
            AccountError::InstructionDidNotDeserialize as u32,
        ))
}

fn key_arg(data: &[u8]) -> Result<Pubkey, ProgramError> {
    Ok(*args::<32>(data)?)
}

/// Binds `$seeds` to the group PDA signer seeds in the caller's scope.
macro_rules! group_seeds {
    ($group:expr => $seeds:ident) => {
        let id_bytes = $group.id.to_le_bytes();
        let bump_bytes = [$group.bump];
        let $seeds = [
            Seed::from(GROUP_SEED),
            Seed::from(&$group.creator),
            Seed::from(&id_bytes),
            Seed::from(&bump_bytes),
        ];
    };
}

macro_rules! accounts {
    ($accounts:expr, [$($name:ident),+ $(,)?]) => {
        let [$($name),+, ..] = $accounts else {
            return fail(AccountError::AccountNotEnoughKeys);
        };
    };
}

// ------------------------------------------------------------- admin

pub fn initialize_config(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    accounts!(
        accounts,
        [config, admin, ringio_program, program_data, system_program]
    );
    let pause_authority = key_arg(data)?;
    signer(admin)?;
    program(ringio_program, program_id)?;
    owned(program_data, &BPF_LOADER_UPGRADEABLE_ID)?;
    let program_data_header = header::<45>(program_data).filter(|state| state[..4] == [3, 0, 0, 0]);
    let Some(program_data_header) = program_data_header else {
        return fail(AccountError::AccountNotProgramData);
    };
    program(system_program, &SYSTEM_PROGRAM_ID)?;

    let bump = find_pda(config, &[CONFIG_SEED], program_id)?;
    let bump_seed = [bump];
    create_pda(
        admin,
        config,
        CONFIG_LEN,
        program_id,
        &[Seed::from(CONFIG_SEED), Seed::from(&bump_seed)],
    )?;

    writable(admin)?;
    // The executable Ringio program must point at this ProgramData account...
    let program_header = header::<36>(ringio_program);
    require(
        ringio_program.owner() == &BPF_LOADER_UPGRADEABLE_ID
            && program_header.is_some_and(|state| {
                state[..4] == [2, 0, 0, 0] && &state[4..36] == program_data.key()
            }),
        RingioError::Unauthorized,
    )?;
    // ...and only its current upgrade authority may initialize the config.
    require(
        program_data_header[12] == 1 && &program_data_header[13..45] == admin.key(),
        RingioError::Unauthorized,
    )?;
    require(pause_authority != [0u8; 32], RingioError::Unauthorized)?;

    let state = Config {
        admin: *admin.key(),
        pause_authority,
        paused_at: 0,
        total_paused_seconds: 0,
        paused: false,
        bump,
    };
    store_config(config, &state)?;
    Event::new(event::CONFIG_INITIALIZED)
        .key(admin.key())
        .key(&pause_authority)
        .emit();
    Ok(())
}

pub fn set_paused(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    accounts!(accounts, [config_info, pause_authority]);
    let paused = match args::<1>(data)?[0] {
        0 => false,
        1 => true,
        _ => return fail(AccountError::InstructionDidNotDeserialize),
    };
    writable(config_info)?;
    let mut config = load_config(config_info, program_id)?;
    require(
        &config.pause_authority == pause_authority.key(),
        RingioError::Unauthorized,
    )?;
    signer(pause_authority)?;

    let (paused_at, total) = math::next_pause_state(
        config.paused,
        paused,
        config.paused_at,
        config.total_paused_seconds,
        now()?,
    )
    .or_overflow()?;
    config.paused_at = paused_at;
    config.total_paused_seconds = total;
    config.paused = paused;
    store_config(config_info, &config)?;
    Event::new(event::PAUSE_CHANGED)
        .key(pause_authority.key())
        .bool(paused)
        .emit();
    Ok(())
}

pub fn update_pause_authority(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    accounts!(accounts, [config_info, admin]);
    let new_pause_authority = key_arg(data)?;
    writable(config_info)?;
    let mut config = load_config(config_info, program_id)?;
    require(&config.admin == admin.key(), RingioError::Unauthorized)?;
    signer(admin)?;
    require(new_pause_authority != [0u8; 32], RingioError::Unauthorized)?;

    let old = config.pause_authority;
    config.pause_authority = new_pause_authority;
    store_config(config_info, &config)?;
    Event::new(event::PAUSE_AUTHORITY_CHANGED)
        .key(admin.key())
        .key(&old)
        .key(&new_pause_authority)
        .emit();
    Ok(())
}

// ------------------------------------------------------------- forming

struct CreateGroupArgs {
    group_id: u64,
    member_count: u16,
    contribution_amount: u64,
    period_seconds: i64,
    grace_seconds: i64,
    join_deadline: i64,
    reveal_window_seconds: i64,
    collateral_window_seconds: i64,
    creator_commitment: [u8; 32],
}

impl CreateGroupArgs {
    fn parse(data: &[u8]) -> Result<Self, ProgramError> {
        let raw = args::<90>(data)?;
        let u64_at = |offset: usize| {
            u64::from_le_bytes(raw[offset..offset + 8].try_into().unwrap_or([0; 8]))
        };
        let mut creator_commitment = [0u8; 32];
        creator_commitment.copy_from_slice(&raw[58..90]);
        Ok(Self {
            group_id: u64_at(0),
            member_count: u16::from_le_bytes([raw[8], raw[9]]),
            contribution_amount: u64_at(10),
            period_seconds: u64_at(18) as i64,
            grace_seconds: u64_at(26) as i64,
            join_deadline: u64_at(34) as i64,
            reveal_window_seconds: u64_at(42) as i64,
            collateral_window_seconds: u64_at(50) as i64,
            creator_commitment,
        })
    }
}

fn validate_group_args(args: &CreateGroupArgs, now: i64) -> ProgramResult {
    require(
        args.member_count >= MIN_MEMBERS && usize::from(args.member_count) <= MAX_MEMBERS,
        RingioError::InvalidMemberCount,
    )?;
    require(
        args.contribution_amount > 0,
        RingioError::InvalidContributionAmount,
    )?;
    let windows = [
        args.period_seconds,
        args.grace_seconds,
        args.reveal_window_seconds,
        args.collateral_window_seconds,
    ];
    require(
        windows
            .iter()
            .all(|window| *window > 0 && *window <= MAX_PHASE_SECONDS),
        RingioError::InvalidDuration,
    )?;
    require(args.join_deadline > now, RingioError::InvalidDeadline)?;
    let join_window = args.join_deadline.checked_sub(now).or_overflow()?;
    require(
        join_window <= MAX_PHASE_SECONDS,
        RingioError::InvalidDeadline,
    )?;
    math::round_payout(args.member_count, args.contribution_amount).or_overflow()?;
    math::total_collateral_required(args.member_count, args.contribution_amount).or_overflow()?;
    math::round_grace_ends(now, args.period_seconds, args.grace_seconds).or_overflow()?;
    args.join_deadline
        .checked_add(args.reveal_window_seconds)
        .and_then(|value| value.checked_add(args.collateral_window_seconds))
        .or_overflow()?;
    Ok(())
}

pub fn create_group(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    accounts!(
        accounts,
        [
            config_info,
            group_info,
            member_info,
            pot_vault,
            collateral_vault,
            mint,
            creator,
            token_program,
            system_program,
            rent
        ]
    );
    let args = CreateGroupArgs::parse(data)?;
    let config = read_config(config_info, program_id)?;
    mint_decimals(mint)?;
    signer(creator)?;
    program(token_program, &TOKEN_PROGRAM_ID)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;
    require(
        rent.key() == &RENT_SYSVAR_ID,
        AccountError::AccountSysvarMismatch,
    )?;

    let group_key = *group_info.key();
    let creator_key = *creator.key();
    let id_bytes = args.group_id.to_le_bytes();
    let group_bump = find_pda(
        group_info,
        &[GROUP_SEED, &creator_key, &id_bytes],
        program_id,
    )?;
    let seed = [group_bump];
    create_pda(
        creator,
        group_info,
        GROUP_LEN,
        program_id,
        &[
            Seed::from(GROUP_SEED),
            Seed::from(&creator_key),
            Seed::from(&id_bytes),
            Seed::from(&seed),
        ],
    )?;
    let member_bump = find_pda(
        member_info,
        &[MEMBER_SEED, &group_key, &creator_key],
        program_id,
    )?;
    let seed = [member_bump];
    create_pda(
        creator,
        member_info,
        MEMBER_LEN,
        program_id,
        &[
            Seed::from(MEMBER_SEED),
            Seed::from(&group_key),
            Seed::from(&creator_key),
            Seed::from(&seed),
        ],
    )?;
    let pot_bump = find_pda(pot_vault, &[POT_VAULT_SEED, &group_key], program_id)?;
    let seed = [pot_bump];
    create_token_vault(
        creator,
        pot_vault,
        mint,
        &group_key,
        &[
            Seed::from(POT_VAULT_SEED),
            Seed::from(&group_key),
            Seed::from(&seed),
        ],
    )?;
    let collateral_bump = find_pda(
        collateral_vault,
        &[COLLATERAL_VAULT_SEED, &group_key],
        program_id,
    )?;
    let seed = [collateral_bump];
    create_token_vault(
        creator,
        collateral_vault,
        mint,
        &group_key,
        &[
            Seed::from(COLLATERAL_VAULT_SEED),
            Seed::from(&group_key),
            Seed::from(&seed),
        ],
    )?;

    config_address(config_info, &config, program_id)?;
    writable(creator)?;

    require_unpaused(&config)?;
    let now = now()?;
    validate_group_args(&args, now)?;
    require(
        args.creator_commitment != ZERO_HASH,
        RingioError::InvalidCommitment,
    )?;

    let group = Group {
        creator: creator_key,
        mint: *mint.key(),
        pot_vault: *pot_vault.key(),
        collateral_vault: *collateral_vault.key(),
        id: args.group_id,
        contribution_amount: args.contribution_amount,
        total_collateral_locked: 0,
        period_seconds: args.period_seconds,
        grace_seconds: args.grace_seconds,
        join_deadline: args.join_deadline,
        reveal_window_seconds: args.reveal_window_seconds,
        collateral_window_seconds: args.collateral_window_seconds,
        reveal_deadline: 0,
        collateral_deadline: 0,
        created_at: now,
        reveal_started_at: 0,
        collateral_started_at: 0,
        round_started_at: 0,
        member_count: args.member_count,
        joined_count: 1,
        revealed_count: 0,
        collateralized_count: 0,
        current_round: 0,
        round_contributions: 0,
        failed_round: UNSET_ROUND,
        status: GroupStatus::Forming,
        bump: group_bump,
        pot_vault_bump: pot_bump,
        collateral_vault_bump: collateral_bump,
        phase_pause_snapshot: config.total_paused_seconds,
    };
    {
        let mut data = group_info.try_borrow_mut_data()?;
        group.store(&mut data)?;
        Group::set_member_at(&mut data, 0, &creator_key)?;
    }
    store_member(
        member_info,
        &Member::new(
            group_key,
            creator_key,
            args.creator_commitment,
            0,
            member_bump,
        ),
    )?;

    Event::new(event::GROUP_CREATED)
        .key(&group_key)
        .key(&creator_key)
        .key(mint.key())
        .u16(args.member_count)
        .u64(args.contribution_amount)
        .i64(args.join_deadline)
        .emit();
    Ok(())
}

pub fn invite_member(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    accounts!(
        accounts,
        [
            config_info,
            group_info,
            invite_info,
            creator,
            system_program
        ]
    );
    let invitee = key_arg(data)?;
    let config = read_config(config_info, program_id)?;
    let group = read_group(group_info, program_id)?;
    signer(creator)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;

    let group_key = *group_info.key();
    let bump = find_pda(
        invite_info,
        &[INVITE_SEED, &group_key, &invitee],
        program_id,
    )?;
    let seed = [bump];
    create_pda(
        creator,
        invite_info,
        INVITE_LEN,
        program_id,
        &[
            Seed::from(INVITE_SEED),
            Seed::from(&group_key),
            Seed::from(&invitee),
            Seed::from(&seed),
        ],
    )?;

    config_address(config_info, &config, program_id)?;
    group_address(group_info, &group, program_id)?;
    require(&group.creator == creator.key(), RingioError::Unauthorized)?;
    writable(creator)?;

    require_unpaused(&config)?;
    let now = now()?;
    require(
        group.status == GroupStatus::Forming,
        RingioError::InvalidGroupState,
    )?;
    require(
        now <= deadline(group.join_deadline, &config, &group)?,
        RingioError::InvalidDeadline,
    )?;
    require(
        group.joined_count < group.member_count,
        RingioError::GroupFull,
    )?;
    require(
        invitee != [0u8; 32] && invitee != group.creator,
        RingioError::DuplicateMember,
    )?;
    require(
        !Group::is_member(&group_info.try_borrow_data()?, group.joined_count, &invitee)?,
        RingioError::DuplicateMember,
    )?;

    Invite {
        group: group_key,
        invitee,
        used: false,
        bump,
    }
    .store(&mut invite_info.try_borrow_mut_data()?)?;
    Event::new(event::MEMBER_INVITED)
        .key(&group_key)
        .key(&invitee)
        .emit();
    Ok(())
}

pub fn join_group(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    accounts!(
        accounts,
        [
            config_info,
            group_info,
            invite_info,
            member_info,
            participant,
            system_program
        ]
    );
    let commitment = key_arg(data)?;
    let config = read_config(config_info, program_id)?;
    let mut group = read_group(group_info, program_id)?;
    program_account(invite_info, program_id, &discriminator::INVITE, INVITE_LEN)?;
    let mut invite = Invite::load(&invite_info.try_borrow_data()?)?;
    signer(participant)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;

    let group_key = *group_info.key();
    let participant_key = *participant.key();
    let member_bump = find_pda(
        member_info,
        &[MEMBER_SEED, &group_key, &participant_key],
        program_id,
    )?;
    let seed = [member_bump];
    create_pda(
        participant,
        member_info,
        MEMBER_LEN,
        program_id,
        &[
            Seed::from(MEMBER_SEED),
            Seed::from(&group_key),
            Seed::from(&participant_key),
            Seed::from(&seed),
        ],
    )?;

    config_address(config_info, &config, program_id)?;
    group_address(group_info, &group, program_id)?;
    writable(group_info)?;
    pda(
        invite_info,
        &[INVITE_SEED, &group_key, &participant_key, &[invite.bump]],
        program_id,
    )?;
    writable(invite_info)?;
    require(invite.group == group_key, RingioError::InvalidInvite)?;
    require(
        invite.invitee == participant_key,
        RingioError::InvalidInvite,
    )?;
    writable(participant)?;

    require_unpaused(&config)?;
    require(commitment != ZERO_HASH, RingioError::InvalidCommitment)?;
    require(!invite.used, RingioError::InvalidInvite)?;
    let now = now()?;
    require(
        group.status == GroupStatus::Forming,
        RingioError::InvalidGroupState,
    )?;
    require(
        now <= deadline(group.join_deadline, &config, &group)?,
        RingioError::InvalidDeadline,
    )?;
    require(
        group.joined_count < group.member_count,
        RingioError::GroupFull,
    )?;
    require(
        !Group::is_member(
            &group_info.try_borrow_data()?,
            group.joined_count,
            &participant_key,
        )?,
        RingioError::DuplicateMember,
    )?;

    let joined_index = group.joined_count;
    group.joined_count = group.joined_count.checked_add(1).or_overflow()?;
    if group.joined_count == group.member_count {
        group.status = GroupStatus::Revealing;
        group.reveal_started_at = now;
        group.phase_pause_snapshot = config.total_paused_seconds;
        group.reveal_deadline = now.checked_add(group.reveal_window_seconds).or_overflow()?;
    }
    {
        let mut data = group_info.try_borrow_mut_data()?;
        Group::set_member_at(&mut data, usize::from(joined_index), &participant_key)?;
        group.store(&mut data)?;
    }

    store_member(
        member_info,
        &Member::new(
            group_key,
            participant_key,
            commitment,
            joined_index,
            member_bump,
        ),
    )?;
    invite.used = true;
    invite.store(&mut invite_info.try_borrow_mut_data()?)?;

    Event::new(event::MEMBER_JOINED)
        .key(&group_key)
        .key(&participant_key)
        .u16(joined_index)
        .emit();
    Ok(())
}

pub fn reveal_secret(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    accounts!(
        accounts,
        [config_info, group_info, member_info, participant]
    );
    let secret = key_arg(data)?;
    let config = load_config(config_info, program_id)?;
    let mut group = load_group_mut(group_info, program_id)?;
    let group_key = *group_info.key();
    let mut member = load_own_member(member_info, program_id, &group_key, participant)?;
    signer(participant)?;

    require_unpaused(&config)?;
    require(secret != ZERO_HASH, RingioError::InvalidCommitment)?;
    let now = now()?;
    require(
        group.status == GroupStatus::Revealing,
        RingioError::InvalidGroupState,
    )?;
    require(
        now <= deadline(group.reveal_deadline, &config, &group)?,
        RingioError::InvalidDeadline,
    )?;
    require(!member.revealed, RingioError::AlreadyRevealed)?;
    require(
        member.commitment == math::commitment_hash(&group_key, participant.key(), &secret),
        RingioError::CommitmentMismatch,
    )?;

    let digest = math::reveal_digest(&group_key, participant.key(), &secret);
    group.revealed_count = group.revealed_count.checked_add(1).or_overflow()?;
    member.revealed = true;
    member.reveal_digest = digest;
    {
        let mut data = group_info.try_borrow_mut_data()?;
        let mut entropy = Group::entropy(&data)?;
        math::xor_digest(&mut entropy, &digest);
        Group::set_entropy(&mut data, &entropy)?;
        group.store(&mut data)?;
    }
    store_member(member_info, &member)?;
    Event::new(event::SECRET_REVEALED)
        .key(&group_key)
        .key(participant.key())
        .hash(&digest)
        .emit();
    Ok(())
}

pub fn finalize_order(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    accounts!(accounts, [config_info, group_info]);
    let config = load_config(config_info, program_id)?;
    let mut group = load_group_mut(group_info, program_id)?;
    require_unpaused(&config)?;
    let now = now()?;
    require(
        group.status == GroupStatus::Revealing,
        RingioError::InvalidGroupState,
    )?;
    require(
        group.joined_count == group.member_count && group.revealed_count == group.member_count,
        RingioError::RevealIncomplete,
    )?;

    let group_key = *group_info.key();
    let entropy = {
        let mut data = group_info.try_borrow_mut_data()?;
        let mut roster = [[0u8; 32]; MAX_MEMBERS];
        for (index, wallet) in roster
            .iter_mut()
            .enumerate()
            .take(usize::from(group.member_count))
        {
            *wallet = Group::member_at(&data, index)?;
        }
        let entropy = Group::entropy(&data)?;
        let order = math::derive_payout_order(&roster, group.member_count, &entropy, &group_key)
            .ok_or(ProgramError::from(RingioError::InvariantViolation))?;
        for (round, roster_index) in order
            .iter()
            .enumerate()
            .take(usize::from(group.member_count))
        {
            let wallet = roster
                .get(usize::from(*roster_index))
                .ok_or(ProgramError::from(RingioError::InvariantViolation))?;
            Group::set_payout_at(&mut data, round, wallet)?;
        }
        group.status = GroupStatus::Collateralizing;
        group.collateral_started_at = now;
        group.phase_pause_snapshot = config.total_paused_seconds;
        group.collateral_deadline = now
            .checked_add(group.collateral_window_seconds)
            .or_overflow()?;
        group.store(&mut data)?;
        entropy
    };
    Event::new(event::ORDER_FINALIZED)
        .key(&group_key)
        .hash(&entropy)
        .u16(group.member_count)
        .i64(group.collateral_deadline)
        .emit();
    Ok(())
}

pub fn post_collateral(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    accounts!(
        accounts,
        [
            config_info,
            group_info,
            member_info,
            source,
            collateral_vault,
            mint,
            participant,
            token_program
        ]
    );
    let config = load_config(config_info, program_id)?;
    let mut group = load_group_mut(group_info, program_id)?;
    require(&group.mint == mint.key(), RingioError::WrongMint)?;
    require(
        &group.collateral_vault == collateral_vault.key(),
        RingioError::WrongVault,
    )?;
    let group_key = *group_info.key();
    let mut member = load_own_member(member_info, program_id, &group_key, participant)?;
    user_token_account(source, &group.mint, participant.key())?;
    writable(collateral_vault)?;
    vault(
        collateral_vault,
        &group.collateral_vault,
        &group.mint,
        &group_key,
    )?;
    let decimals = mint_decimals(mint)?;
    signer(participant)?;
    program(token_program, &TOKEN_PROGRAM_ID)?;

    require_unpaused(&config)?;
    let now = now()?;
    require(
        group.status == GroupStatus::Collateralizing,
        RingioError::InvalidGroupState,
    )?;
    require(
        now <= deadline(group.collateral_deadline, &config, &group)?,
        RingioError::InvalidDeadline,
    )?;
    require(
        !member.collateral_posted,
        RingioError::CollateralAlreadyPosted,
    )?;
    let rank = Group::rank_of(
        &group_info.try_borrow_data()?,
        group.member_count,
        participant.key(),
    )?
    .ok_or(ProgramError::from(RingioError::MemberNotRanked))?;
    let required = math::collateral_required(group.member_count, rank, group.contribution_amount)
        .or_overflow()?;

    member.payout_rank = rank;
    member.collateral_locked = required;
    member.collateral_posted = true;
    group.total_collateral_locked = group
        .total_collateral_locked
        .checked_add(required)
        .or_overflow()?;
    group.collateralized_count = group.collateralized_count.checked_add(1).or_overflow()?;
    store_member(member_info, &member)?;
    store_group(group_info, &group)?;

    if required > 0 {
        transfer(
            source,
            mint,
            collateral_vault,
            participant,
            required,
            decimals,
            None,
        )?;
    }
    Event::new(event::COLLATERAL_POSTED)
        .key(&group_key)
        .key(participant.key())
        .u16(rank)
        .u64(required)
        .emit();
    Ok(())
}

pub fn activate_group(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    accounts!(accounts, [config_info, group_info, collateral_vault]);
    let config = load_config(config_info, program_id)?;
    let mut group = load_group_mut(group_info, program_id)?;
    require(
        &group.collateral_vault == collateral_vault.key(),
        RingioError::WrongVault,
    )?;
    let vault_state = vault(
        collateral_vault,
        &group.collateral_vault,
        &group.mint,
        group_info.key(),
    )?;

    require_unpaused(&config)?;
    let now = now()?;
    require(
        group.status == GroupStatus::Collateralizing,
        RingioError::InvalidGroupState,
    )?;
    require(
        group.collateralized_count == group.member_count,
        RingioError::CollateralIncomplete,
    )?;
    let expected_total =
        math::total_collateral_required(group.member_count, group.contribution_amount)
            .or_overflow()?;
    require(
        group.total_collateral_locked == expected_total,
        RingioError::InvariantViolation,
    )?;
    require(
        vault_state.amount >= expected_total,
        RingioError::CollateralVaultShortfall,
    )?;

    group.status = GroupStatus::Active;
    group.current_round = 0;
    group.round_contributions = 0;
    group.round_started_at = now;
    group.phase_pause_snapshot = config.total_paused_seconds;
    store_group(group_info, &group)?;
    Event::new(event::GROUP_ACTIVATED)
        .key(group_info.key())
        .i64(now)
        .u64(expected_total)
        .emit();
    Ok(())
}

// ------------------------------------------------------------- rounds

pub fn contribute(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    accounts!(
        accounts,
        [
            config_info,
            group_info,
            member_info,
            source,
            pot_vault,
            collateral_vault,
            mint,
            participant,
            token_program
        ]
    );
    let config = load_config(config_info, program_id)?;
    let mut group = load_group_mut(group_info, program_id)?;
    require(&group.mint == mint.key(), RingioError::WrongMint)?;
    require(&group.pot_vault == pot_vault.key(), RingioError::WrongVault)?;
    require(
        &group.collateral_vault == collateral_vault.key(),
        RingioError::WrongVault,
    )?;
    let group_key = *group_info.key();
    let mut member = load_own_member(member_info, program_id, &group_key, participant)?;
    require(member.collateral_posted, RingioError::CollateralIncomplete)?;
    user_token_account(source, &group.mint, participant.key())?;
    writable(pot_vault)?;
    vault(pot_vault, &group.pot_vault, &group.mint, &group_key)?;
    writable(collateral_vault)?;
    vault(
        collateral_vault,
        &group.collateral_vault,
        &group.mint,
        &group_key,
    )?;
    let decimals = mint_decimals(mint)?;
    signer(participant)?;
    program(token_program, &TOKEN_PROGRAM_ID)?;

    require_unpaused(&config)?;
    let now = now()?;
    require(
        group.status == GroupStatus::Active,
        RingioError::InvalidGroupState,
    )?;
    require(
        now <= grace_ends(&config, &group)?,
        RingioError::ContributionWindowClosed,
    )?;
    require(
        member.last_contributed_round != group.current_round,
        RingioError::ContributionAlreadyResolved,
    )?;
    require(
        member.payout_rank != UNSET_ROUND,
        RingioError::OrderNotFinalized,
    )?;

    let round = group.current_round;
    let amount = group.contribution_amount;
    let release = if member.payout_rank < round {
        require(member.payout_received, RingioError::InvariantViolation)?;
        require(
            member.collateral_locked >= amount,
            RingioError::CollateralVaultShortfall,
        )?;
        amount
    } else {
        0
    };

    member.last_contributed_round = round;
    member.last_resolution_kind = RESOLUTION_DIRECT;
    member.collateral_locked = member
        .collateral_locked
        .checked_sub(release)
        .or_overflow()?;
    group.total_collateral_locked = group
        .total_collateral_locked
        .checked_sub(release)
        .or_overflow()?;
    group.round_contributions = group.round_contributions.checked_add(1).or_overflow()?;
    store_member(member_info, &member)?;
    store_group(group_info, &group)?;

    transfer(source, mint, pot_vault, participant, amount, decimals, None)?;
    if release > 0 {
        group_seeds!(group => seeds);
        transfer(
            collateral_vault,
            mint,
            source,
            group_info,
            release,
            decimals,
            Some(&seeds),
        )?;
    }
    Event::new(event::CONTRIBUTION_RECORDED)
        .key(&group_key)
        .key(participant.key())
        .u16(round)
        .u64(amount)
        .u64(release)
        .emit();
    Ok(())
}

fn is_coverable(member: &Member, group: &Group) -> bool {
    member.payout_rank < group.current_round
        && member.payout_received
        && member.collateral_locked >= group.contribution_amount
}

pub fn cover_default(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    accounts!(
        accounts,
        [
            config_info,
            group_info,
            member_info,
            pot_vault,
            collateral_vault,
            mint,
            keeper,
            token_program
        ]
    );
    let config = load_config(config_info, program_id)?;
    let mut group = load_group_mut(group_info, program_id)?;
    require(&group.mint == mint.key(), RingioError::WrongMint)?;
    require(&group.pot_vault == pot_vault.key(), RingioError::WrongVault)?;
    require(
        &group.collateral_vault == collateral_vault.key(),
        RingioError::WrongVault,
    )?;
    let group_key = *group_info.key();
    writable(member_info)?;
    let mut member = load_member(
        member_info,
        program_id,
        &group_key,
        RingioError::Unauthorized,
    )?;
    writable(pot_vault)?;
    vault(pot_vault, &group.pot_vault, &group.mint, &group_key)?;
    writable(collateral_vault)?;
    vault(
        collateral_vault,
        &group.collateral_vault,
        &group.mint,
        &group_key,
    )?;
    let decimals = mint_decimals(mint)?;
    signer(keeper)?;
    program(token_program, &TOKEN_PROGRAM_ID)?;

    require_unpaused(&config)?;
    let now = now()?;
    require(
        group.status == GroupStatus::Active,
        RingioError::InvalidGroupState,
    )?;
    require(
        now > grace_ends(&config, &group)?,
        RingioError::GracePeriodActive,
    )?;
    require(
        member.last_contributed_round != group.current_round,
        RingioError::ContributionAlreadyResolved,
    )?;
    require(
        is_coverable(&member, &group),
        RingioError::DefaultNotCoverable,
    )?;

    let round = group.current_round;
    let amount = group.contribution_amount;
    member.last_contributed_round = round;
    member.last_resolution_kind = RESOLUTION_COLLATERAL;
    member.defaults = member.defaults.checked_add(1).or_overflow()?;
    member.collateral_locked = member.collateral_locked.checked_sub(amount).or_overflow()?;
    group.total_collateral_locked = group
        .total_collateral_locked
        .checked_sub(amount)
        .or_overflow()?;
    group.round_contributions = group.round_contributions.checked_add(1).or_overflow()?;
    store_member(member_info, &member)?;
    store_group(group_info, &group)?;

    group_seeds!(group => seeds);
    transfer(
        collateral_vault,
        mint,
        pot_vault,
        group_info,
        amount,
        decimals,
        Some(&seeds),
    )?;
    Event::new(event::DEFAULT_COVERED)
        .key(&group_key)
        .key(&member.wallet)
        .key(keeper.key())
        .u16(round)
        .u64(amount)
        .emit();
    Ok(())
}

pub fn settle_round(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    accounts!(
        accounts,
        [
            config_info,
            group_info,
            member_info,
            pot_vault,
            recipient_token,
            mint,
            keeper,
            token_program
        ]
    );
    let config = load_config(config_info, program_id)?;
    let mut group = load_group_mut(group_info, program_id)?;
    require(&group.mint == mint.key(), RingioError::WrongMint)?;
    require(&group.pot_vault == pot_vault.key(), RingioError::WrongVault)?;
    let group_key = *group_info.key();
    writable(member_info)?;
    let mut recipient = load_member(
        member_info,
        program_id,
        &group_key,
        RingioError::WrongRecipient,
    )?;
    writable(pot_vault)?;
    let pot = vault(pot_vault, &group.pot_vault, &group.mint, &group_key)?;
    user_token_account(recipient_token, &group.mint, &recipient.wallet)?;
    let decimals = mint_decimals(mint)?;
    signer(keeper)?;
    program(token_program, &TOKEN_PROGRAM_ID)?;

    require_unpaused(&config)?;
    let now = now()?;
    require(
        group.status == GroupStatus::Active,
        RingioError::InvalidGroupState,
    )?;
    require(
        group.round_contributions == group.member_count,
        RingioError::RoundIncomplete,
    )?;
    let expected = group
        .expected_recipient(&group_info.try_borrow_data()?)?
        .ok_or(ProgramError::from(RingioError::WrongRecipient))?;
    require(expected == recipient.wallet, RingioError::WrongRecipient)?;
    require(
        recipient.payout_rank == group.current_round,
        RingioError::WrongRecipient,
    )?;
    require(
        !recipient.payout_received,
        RingioError::PayoutAlreadyReceived,
    )?;
    let round = group.current_round;
    let payout = math::round_payout(group.member_count, group.contribution_amount).or_overflow()?;
    require(pot.amount >= payout, RingioError::InvariantViolation)?;

    recipient.payout_received = true;
    group.current_round = group.current_round.checked_add(1).or_overflow()?;
    group.round_contributions = 0;
    let completed = group.current_round == group.member_count;
    if completed {
        group.status = GroupStatus::Completed;
    } else {
        group.round_started_at = now;
        group.phase_pause_snapshot = config.total_paused_seconds;
    }
    store_member(member_info, &recipient)?;
    store_group(group_info, &group)?;

    group_seeds!(group => seeds);
    transfer(
        pot_vault,
        mint,
        recipient_token,
        group_info,
        payout,
        decimals,
        Some(&seeds),
    )?;
    Event::new(event::ROUND_SETTLED)
        .key(&group_key)
        .key(keeper.key())
        .u16(round)
        .key(&expected)
        .u64(payout)
        .bool(completed)
        .emit();
    Ok(())
}

pub fn abort_uncovered_round(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    accounts!(accounts, [config_info, group_info, member_info, keeper]);
    let config = load_config(config_info, program_id)?;
    let mut group = load_group_mut(group_info, program_id)?;
    let group_key = *group_info.key();
    let member = load_member(
        member_info,
        program_id,
        &group_key,
        RingioError::Unauthorized,
    )?;
    signer(keeper)?;

    require_unpaused(&config)?;
    let now = now()?;
    require(
        group.status == GroupStatus::Active,
        RingioError::InvalidGroupState,
    )?;
    require(
        now > grace_ends(&config, &group)?,
        RingioError::GracePeriodActive,
    )?;
    require(
        member.last_contributed_round != group.current_round,
        RingioError::ContributionAlreadyResolved,
    )?;
    require(
        !is_coverable(&member, &group),
        RingioError::DefaultIsCoverable,
    )?;

    group.failed_round = group.current_round;
    group.status = GroupStatus::Defaulted;
    store_group(group_info, &group)?;
    Event::new(event::GROUP_TERMINATED)
        .key(&group_key)
        .u8(GroupStatus::Defaulted.event_code())
        .u16(group.failed_round)
        .key(keeper.key())
        .emit();
    Ok(())
}

pub fn cancel_group(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    accounts!(accounts, [config_info, group_info, caller]);
    let config = load_config(config_info, program_id)?;
    let mut group = load_group_mut(group_info, program_id)?;
    signer(caller)?;

    require_unpaused(&config)?;
    let now = now()?;
    let allowed = match group.status {
        GroupStatus::Forming => {
            caller.key() == &group.creator || now > deadline(group.join_deadline, &config, &group)?
        }
        GroupStatus::Revealing => {
            now > deadline(group.reveal_deadline, &config, &group)?
                && group.revealed_count < group.member_count
        }
        GroupStatus::Collateralizing => {
            now > deadline(group.collateral_deadline, &config, &group)?
                && group.collateralized_count < group.member_count
        }
        _ => false,
    };
    require(allowed, RingioError::CancellationNotAllowed)?;

    group.status = GroupStatus::Cancelled;
    store_group(group_info, &group)?;
    Event::new(event::GROUP_TERMINATED)
        .key(group_info.key())
        .u8(GroupStatus::Cancelled.event_code())
        .u16(UNSET_ROUND)
        .key(caller.key())
        .emit();
    Ok(())
}

// ------------------------------------------------------------- refunds (allowed while paused)

pub fn refund_failed_round(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    accounts!(
        accounts,
        [
            group_info,
            member_info,
            pot_vault,
            collateral_vault,
            member_token,
            mint,
            keeper,
            token_program
        ]
    );
    let mut group = load_group_mut(group_info, program_id)?;
    require(&group.mint == mint.key(), RingioError::WrongMint)?;
    require(&group.pot_vault == pot_vault.key(), RingioError::WrongVault)?;
    require(
        &group.collateral_vault == collateral_vault.key(),
        RingioError::WrongVault,
    )?;
    let group_key = *group_info.key();
    writable(member_info)?;
    let mut member = load_member(
        member_info,
        program_id,
        &group_key,
        RingioError::Unauthorized,
    )?;
    writable(pot_vault)?;
    vault(pot_vault, &group.pot_vault, &group.mint, &group_key)?;
    writable(collateral_vault)?;
    vault(
        collateral_vault,
        &group.collateral_vault,
        &group.mint,
        &group_key,
    )?;
    user_token_account(member_token, &group.mint, &member.wallet)?;
    let decimals = mint_decimals(mint)?;
    signer(keeper)?;
    program(token_program, &TOKEN_PROGRAM_ID)?;

    require(
        group.status == GroupStatus::Defaulted,
        RingioError::InvalidGroupState,
    )?;
    require(
        member.last_contributed_round == group.failed_round
            && member.last_refunded_round != group.failed_round,
        RingioError::NothingToRefund,
    )?;
    let kind = member.last_resolution_kind;
    require(
        kind == RESOLUTION_DIRECT || kind == RESOLUTION_COLLATERAL,
        RingioError::NothingToRefund,
    )?;

    let round = group.failed_round;
    let amount = group.contribution_amount;
    member.last_refunded_round = round;
    group.round_contributions = group.round_contributions.checked_sub(1).or_overflow()?;
    if kind == RESOLUTION_COLLATERAL {
        member.collateral_locked = member.collateral_locked.checked_add(amount).or_overflow()?;
        group.total_collateral_locked = group
            .total_collateral_locked
            .checked_add(amount)
            .or_overflow()?;
    }
    store_member(member_info, &member)?;
    store_group(group_info, &group)?;

    let destination = if kind == RESOLUTION_DIRECT {
        member_token
    } else {
        collateral_vault
    };
    group_seeds!(group => seeds);
    transfer(
        pot_vault,
        mint,
        destination,
        group_info,
        amount,
        decimals,
        Some(&seeds),
    )?;
    Event::new(event::FAILED_ROUND_REFUNDED)
        .key(&group_key)
        .key(&member.wallet)
        .u16(round)
        .u8(kind)
        .u64(amount)
        .emit();
    Ok(())
}

pub fn refund_collateral(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    accounts!(
        accounts,
        [
            group_info,
            member_info,
            collateral_vault,
            member_token,
            mint,
            participant,
            token_program
        ]
    );
    let mut group = load_group_mut(group_info, program_id)?;
    require(&group.mint == mint.key(), RingioError::WrongMint)?;
    require(
        &group.collateral_vault == collateral_vault.key(),
        RingioError::WrongVault,
    )?;
    let group_key = *group_info.key();
    let mut member = load_own_member(member_info, program_id, &group_key, participant)?;
    writable(collateral_vault)?;
    vault(
        collateral_vault,
        &group.collateral_vault,
        &group.mint,
        &group_key,
    )?;
    user_token_account(member_token, &group.mint, participant.key())?;
    let decimals = mint_decimals(mint)?;
    signer(participant)?;
    program(token_program, &TOKEN_PROGRAM_ID)?;

    require(
        matches!(
            group.status,
            GroupStatus::Cancelled | GroupStatus::Defaulted | GroupStatus::Completed
        ),
        RingioError::InvalidGroupState,
    )?;
    if group.status == GroupStatus::Defaulted {
        require(
            group.round_contributions == 0,
            RingioError::PendingRoundRefunds,
        )?;
    }
    let amount = member.collateral_locked;
    require(amount > 0, RingioError::NothingToRefund)?;
    member.collateral_locked = 0;
    group.total_collateral_locked = group
        .total_collateral_locked
        .checked_sub(amount)
        .or_overflow()?;
    store_member(member_info, &member)?;
    store_group(group_info, &group)?;

    group_seeds!(group => seeds);
    transfer(
        collateral_vault,
        mint,
        member_token,
        group_info,
        amount,
        decimals,
        Some(&seeds),
    )?;
    Event::new(event::COLLATERAL_REFUNDED)
        .key(&group_key)
        .key(&member.wallet)
        .u64(amount)
        .emit();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_args(now: i64) -> CreateGroupArgs {
        CreateGroupArgs {
            group_id: 1,
            member_count: 4,
            contribution_amount: 1_000_000,
            period_seconds: 7 * 24 * 60 * 60,
            grace_seconds: 24 * 60 * 60,
            join_deadline: now + 24 * 60 * 60,
            reveal_window_seconds: 24 * 60 * 60,
            collateral_window_seconds: 24 * 60 * 60,
            creator_commitment: [1; 32],
        }
    }

    #[test]
    fn creation_rejects_round_deadline_overflow_before_custody() {
        let now = i64::MAX - 10;
        let mut args = valid_args(0);
        args.join_deadline = i64::MAX - 1;
        args.period_seconds = 8;
        args.grace_seconds = 8;
        assert!(validate_group_args(&args, now).is_err());
    }

    #[test]
    fn creation_rejects_unbounded_windows_and_counts() {
        let now = 1_700_000_000;
        let mut args = valid_args(now);
        args.period_seconds = MAX_PHASE_SECONDS + 1;
        assert!(validate_group_args(&args, now).is_err());
        let mut args = valid_args(now);
        args.member_count = MAX_MEMBERS as u16 + 1;
        assert_eq!(
            validate_group_args(&args, now),
            Err(ProgramError::Custom(RingioError::InvalidMemberCount as u32))
        );
        let mut args = valid_args(now);
        args.join_deadline = now;
        assert_eq!(
            validate_group_args(&args, now),
            Err(ProgramError::Custom(RingioError::InvalidDeadline as u32))
        );
    }

    #[test]
    fn normal_group_terms_validate() {
        let now = 1_700_000_000;
        assert!(validate_group_args(&valid_args(now), now).is_ok());
    }

    #[test]
    fn create_group_args_use_the_borsh_layout() {
        let mut raw = [0u8; 90];
        raw[0..8].copy_from_slice(&42u64.to_le_bytes());
        raw[8..10].copy_from_slice(&5u16.to_le_bytes());
        raw[10..18].copy_from_slice(&250_000_000u64.to_le_bytes());
        raw[18..26].copy_from_slice(&604_800i64.to_le_bytes());
        raw[34..42].copy_from_slice(&1_900_000_000i64.to_le_bytes());
        raw[58..90].copy_from_slice(&[7; 32]);
        let args = CreateGroupArgs::parse(&raw).unwrap();
        assert_eq!(args.group_id, 42);
        assert_eq!(args.member_count, 5);
        assert_eq!(args.contribution_amount, 250_000_000);
        assert_eq!(args.period_seconds, 604_800);
        assert_eq!(args.join_deadline, 1_900_000_000);
        assert_eq!(args.creator_commitment, [7; 32]);
        assert!(CreateGroupArgs::parse(&raw[..89]).is_err());
    }
}
