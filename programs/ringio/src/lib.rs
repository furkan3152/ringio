use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use solana_sha256_hasher::hashv;

pub mod constants;
pub mod error;
pub mod events;
pub mod math;
pub mod state;

use constants::*;
use error::RingioError;
use events::*;
use state::*;

declare_id!("JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy");

#[program]
pub mod ringio {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        pause_authority: Pubkey,
    ) -> Result<()> {
        require!(
            pause_authority != Pubkey::default(),
            RingioError::Unauthorized
        );

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pause_authority = pause_authority;
        config.paused_at = 0;
        config.total_paused_seconds = 0;
        config.paused = false;
        config.bump = ctx.bumps.config;
        config.version = STATE_VERSION;
        config.reserved = [0; 45];

        emit!(ConfigInitialized {
            admin: config.admin,
            pause_authority,
        });
        Ok(())
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let config = &mut ctx.accounts.config;
        let (paused_at, total_paused_seconds) = next_pause_state(
            config.paused,
            paused,
            config.paused_at,
            config.total_paused_seconds,
            now,
        )
        .ok_or_else(|| error!(RingioError::MathOverflow))?;
        config.paused_at = paused_at;
        config.total_paused_seconds = total_paused_seconds;
        config.paused = paused;
        emit!(PauseChanged {
            pause_authority: ctx.accounts.pause_authority.key(),
            paused,
        });
        Ok(())
    }

    pub fn update_pause_authority(
        ctx: Context<UpdatePauseAuthority>,
        new_pause_authority: Pubkey,
    ) -> Result<()> {
        require!(
            new_pause_authority != Pubkey::default(),
            RingioError::Unauthorized
        );
        let old_pause_authority = ctx.accounts.config.pause_authority;
        ctx.accounts.config.pause_authority = new_pause_authority;
        emit!(PauseAuthorityChanged {
            admin: ctx.accounts.admin.key(),
            old_pause_authority,
            new_pause_authority,
        });
        Ok(())
    }

    pub fn create_group(ctx: Context<CreateGroup>, args: CreateGroupArgs) -> Result<()> {
        require_unpaused(&ctx.accounts.config)?;
        let now = Clock::get()?.unix_timestamp;
        validate_group_args(&args, now)?;
        require!(
            args.creator_commitment != ZERO_HASH,
            RingioError::InvalidCommitment
        );

        let group_key = ctx.accounts.group.key();
        let creator_key = ctx.accounts.creator.key();
        let mint_key = ctx.accounts.mint.key();
        let mut members = [Pubkey::default(); MAX_MEMBERS];
        members[0] = creator_key;

        let group = &mut ctx.accounts.group;
        group.creator = creator_key;
        group.mint = mint_key;
        group.pot_vault = ctx.accounts.pot_vault.key();
        group.collateral_vault = ctx.accounts.collateral_vault.key();
        group.entropy = ZERO_HASH;
        group.members = members;
        group.payout_order = [Pubkey::default(); MAX_MEMBERS];
        group.id = args.group_id;
        group.contribution_amount = args.contribution_amount;
        group.total_collateral_locked = 0;
        group.period_seconds = args.period_seconds;
        group.grace_seconds = args.grace_seconds;
        group.join_deadline = args.join_deadline;
        group.reveal_window_seconds = args.reveal_window_seconds;
        group.collateral_window_seconds = args.collateral_window_seconds;
        group.reveal_deadline = 0;
        group.collateral_deadline = 0;
        group.created_at = now;
        group.reveal_started_at = 0;
        group.collateral_started_at = 0;
        group.round_started_at = 0;
        group.phase_pause_snapshot = ctx.accounts.config.total_paused_seconds;
        group.member_count = args.member_count;
        group.joined_count = 1;
        group.revealed_count = 0;
        group.collateralized_count = 0;
        group.current_round = 0;
        group.round_contributions = 0;
        group.failed_round = UNSET_ROUND;
        group.status = GroupStatus::Forming;
        group.bump = ctx.bumps.group;
        group.pot_vault_bump = ctx.bumps.pot_vault;
        group.collateral_vault_bump = ctx.bumps.collateral_vault;
        group.version = STATE_VERSION;
        group.reserved = [0; 32];

        ctx.accounts.creator_member.initialize(
            group_key,
            creator_key,
            args.creator_commitment,
            0,
            ctx.bumps.creator_member,
        );

        emit!(GroupCreated {
            group: group_key,
            creator: creator_key,
            mint: mint_key,
            member_count: args.member_count,
            contribution_amount: args.contribution_amount,
            join_deadline: args.join_deadline,
        });
        Ok(())
    }

    pub fn invite_member(ctx: Context<InviteMember>, invitee: Pubkey) -> Result<()> {
        require_unpaused(&ctx.accounts.config)?;
        let now = Clock::get()?.unix_timestamp;
        let group = &ctx.accounts.group;
        require!(
            group.status == GroupStatus::Forming,
            RingioError::InvalidGroupState
        );
        let join_deadline = math::effective_deadline(
            group.join_deadline,
            ctx.accounts.config.total_paused_seconds,
            group.phase_pause_snapshot,
        )
        .ok_or_else(|| error!(RingioError::MathOverflow))?;
        require!(now <= join_deadline, RingioError::InvalidDeadline);
        require!(
            group.joined_count < group.member_count,
            RingioError::GroupFull
        );
        require!(
            invitee != Pubkey::default() && invitee != group.creator,
            RingioError::DuplicateMember
        );
        require!(
            !group.members[..usize::from(group.joined_count)].contains(&invitee),
            RingioError::DuplicateMember
        );

        let invite = &mut ctx.accounts.invite;
        invite.group = group.key();
        invite.invitee = invitee;
        invite.used = false;
        invite.bump = ctx.bumps.invite;
        invite.reserved = [0; 30];

        emit!(MemberInvited {
            group: group.key(),
            invitee,
        });
        Ok(())
    }

    pub fn join_group(ctx: Context<JoinGroup>, commitment: [u8; 32]) -> Result<()> {
        require_unpaused(&ctx.accounts.config)?;
        require!(commitment != ZERO_HASH, RingioError::InvalidCommitment);
        require!(!ctx.accounts.invite.used, RingioError::InvalidInvite);

        let now = Clock::get()?.unix_timestamp;
        let participant = ctx.accounts.participant.key();
        let group_key = ctx.accounts.group.key();
        let group = &mut ctx.accounts.group;
        require!(
            group.status == GroupStatus::Forming,
            RingioError::InvalidGroupState
        );
        let join_deadline = math::effective_deadline(
            group.join_deadline,
            ctx.accounts.config.total_paused_seconds,
            group.phase_pause_snapshot,
        )
        .ok_or_else(|| error!(RingioError::MathOverflow))?;
        require!(now <= join_deadline, RingioError::InvalidDeadline);
        require!(
            group.joined_count < group.member_count,
            RingioError::GroupFull
        );
        require!(
            !group.members[..usize::from(group.joined_count)].contains(&participant),
            RingioError::DuplicateMember
        );

        let joined_index = group.joined_count;
        let member_slot = group
            .members
            .get_mut(usize::from(joined_index))
            .ok_or_else(|| error!(RingioError::InvariantViolation))?;
        *member_slot = participant;
        group.joined_count = group
            .joined_count
            .checked_add(1)
            .ok_or_else(|| error!(RingioError::MathOverflow))?;

        if group.joined_count == group.member_count {
            group.status = GroupStatus::Revealing;
            group.reveal_started_at = now;
            group.phase_pause_snapshot = ctx.accounts.config.total_paused_seconds;
            group.reveal_deadline = now
                .checked_add(group.reveal_window_seconds)
                .ok_or_else(|| error!(RingioError::MathOverflow))?;
        }

        ctx.accounts.member.initialize(
            group_key,
            participant,
            commitment,
            joined_index,
            ctx.bumps.member,
        );
        ctx.accounts.invite.used = true;

        emit!(MemberJoined {
            group: group_key,
            member: participant,
            joined_index,
        });
        Ok(())
    }

    pub fn reveal_secret(ctx: Context<RevealSecret>, secret: [u8; 32]) -> Result<()> {
        require_unpaused(&ctx.accounts.config)?;
        require!(secret != ZERO_HASH, RingioError::InvalidCommitment);
        let now = Clock::get()?.unix_timestamp;
        let group_key = ctx.accounts.group.key();
        let participant = ctx.accounts.participant.key();
        let group = &mut ctx.accounts.group;
        let member = &mut ctx.accounts.member;

        require!(
            group.status == GroupStatus::Revealing,
            RingioError::InvalidGroupState
        );
        let reveal_deadline = math::effective_deadline(
            group.reveal_deadline,
            ctx.accounts.config.total_paused_seconds,
            group.phase_pause_snapshot,
        )
        .ok_or_else(|| error!(RingioError::MathOverflow))?;
        require!(now <= reveal_deadline, RingioError::InvalidDeadline);
        require!(!member.revealed, RingioError::AlreadyRevealed);
        require!(
            member.commitment == commitment_hash(&group_key, &participant, &secret),
            RingioError::CommitmentMismatch
        );

        let digest = reveal_digest(&group_key, &participant, &secret);
        xor_digest(&mut group.entropy, &digest);
        group.revealed_count = group
            .revealed_count
            .checked_add(1)
            .ok_or_else(|| error!(RingioError::MathOverflow))?;
        member.revealed = true;
        member.reveal_digest = digest;

        emit!(SecretRevealed {
            group: group_key,
            member: participant,
            reveal_digest: digest,
        });
        Ok(())
    }

    pub fn finalize_order(ctx: Context<FinalizeOrder>) -> Result<()> {
        require_unpaused(&ctx.accounts.config)?;
        let now = Clock::get()?.unix_timestamp;
        let group_key = ctx.accounts.group.key();
        let group = &mut ctx.accounts.group;
        require!(
            group.status == GroupStatus::Revealing,
            RingioError::InvalidGroupState
        );
        require!(
            group.joined_count == group.member_count && group.revealed_count == group.member_count,
            RingioError::RevealIncomplete
        );

        group.payout_order = math::derive_payout_order(
            &group.members,
            group.member_count,
            &group.entropy,
            &group_key,
        )
        .ok_or_else(|| error!(RingioError::InvariantViolation))?;
        group.status = GroupStatus::Collateralizing;
        group.collateral_started_at = now;
        group.phase_pause_snapshot = ctx.accounts.config.total_paused_seconds;
        group.collateral_deadline = now
            .checked_add(group.collateral_window_seconds)
            .ok_or_else(|| error!(RingioError::MathOverflow))?;

        emit!(OrderFinalized {
            group: group_key,
            entropy: group.entropy,
            member_count: group.member_count,
            collateral_deadline: group.collateral_deadline,
        });
        Ok(())
    }

    pub fn post_collateral(ctx: Context<PostCollateral>) -> Result<()> {
        require_unpaused(&ctx.accounts.config)?;
        let now = Clock::get()?.unix_timestamp;
        let participant = ctx.accounts.participant.key();
        let group_key = ctx.accounts.group.key();
        let group = &mut ctx.accounts.group;
        let member = &mut ctx.accounts.member;

        require!(
            group.status == GroupStatus::Collateralizing,
            RingioError::InvalidGroupState
        );
        let collateral_deadline = math::effective_deadline(
            group.collateral_deadline,
            ctx.accounts.config.total_paused_seconds,
            group.phase_pause_snapshot,
        )
        .ok_or_else(|| error!(RingioError::MathOverflow))?;
        require!(now <= collateral_deadline, RingioError::InvalidDeadline);
        require!(
            !member.collateral_posted,
            RingioError::CollateralAlreadyPosted
        );

        let rank = group
            .rank_of(&participant)
            .ok_or_else(|| error!(RingioError::MemberNotRanked))?;
        let required =
            math::collateral_required(group.member_count, rank, group.contribution_amount)
                .ok_or_else(|| error!(RingioError::MathOverflow))?;

        member.payout_rank = rank;
        member.collateral_locked = required;
        member.collateral_posted = true;
        group.total_collateral_locked = group
            .total_collateral_locked
            .checked_add(required)
            .ok_or_else(|| error!(RingioError::MathOverflow))?;
        group.collateralized_count = group
            .collateralized_count
            .checked_add(1)
            .ok_or_else(|| error!(RingioError::MathOverflow))?;

        if required > 0 {
            token::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.source.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.collateral_vault.to_account_info(),
                        authority: ctx.accounts.participant.to_account_info(),
                    },
                ),
                required,
                ctx.accounts.mint.decimals,
            )?;
        }

        emit!(CollateralPosted {
            group: group_key,
            member: participant,
            payout_rank: rank,
            amount: required,
        });
        Ok(())
    }

    pub fn activate_group(ctx: Context<ActivateGroup>) -> Result<()> {
        require_unpaused(&ctx.accounts.config)?;
        let now = Clock::get()?.unix_timestamp;
        let group_key = ctx.accounts.group.key();
        let group = &mut ctx.accounts.group;
        require!(
            group.status == GroupStatus::Collateralizing,
            RingioError::InvalidGroupState
        );
        require!(
            group.collateralized_count == group.member_count,
            RingioError::CollateralIncomplete
        );
        let expected_total =
            math::total_collateral_required(group.member_count, group.contribution_amount)
                .ok_or_else(|| error!(RingioError::MathOverflow))?;
        require!(
            group.total_collateral_locked == expected_total,
            RingioError::InvariantViolation
        );
        require!(
            ctx.accounts.collateral_vault.amount >= expected_total,
            RingioError::CollateralVaultShortfall
        );

        group.status = GroupStatus::Active;
        group.current_round = 0;
        group.round_contributions = 0;
        group.round_started_at = now;
        group.phase_pause_snapshot = ctx.accounts.config.total_paused_seconds;

        emit!(GroupActivated {
            group: group_key,
            started_at: now,
            total_collateral: expected_total,
        });
        Ok(())
    }

    pub fn contribute(ctx: Context<Contribute>) -> Result<()> {
        require_unpaused(&ctx.accounts.config)?;
        let now = Clock::get()?.unix_timestamp;
        let participant = ctx.accounts.participant.key();
        let group_key = ctx.accounts.group.key();
        let group_authority = ctx.accounts.group.to_account_info();
        let group = &mut ctx.accounts.group;
        let member = &mut ctx.accounts.member;

        require!(
            group.status == GroupStatus::Active,
            RingioError::InvalidGroupState
        );
        let base_grace_ends = math::round_grace_ends(
            group.round_started_at,
            group.period_seconds,
            group.grace_seconds,
        )
        .ok_or_else(|| error!(RingioError::MathOverflow))?;
        let grace_ends = math::effective_deadline(
            base_grace_ends,
            ctx.accounts.config.total_paused_seconds,
            group.phase_pause_snapshot,
        )
        .ok_or_else(|| error!(RingioError::MathOverflow))?;
        require!(now <= grace_ends, RingioError::ContributionWindowClosed);
        require!(
            member.last_contributed_round != group.current_round,
            RingioError::ContributionAlreadyResolved
        );
        require!(
            member.payout_rank != UNSET_ROUND,
            RingioError::OrderNotFinalized
        );

        let round = group.current_round;
        let amount = group.contribution_amount;
        let release = if member.payout_rank < round {
            require!(member.payout_received, RingioError::InvariantViolation);
            require!(
                member.collateral_locked >= amount,
                RingioError::CollateralVaultShortfall
            );
            amount
        } else {
            0
        };

        member.last_contributed_round = round;
        member.last_resolution_kind = RESOLUTION_DIRECT;
        member.collateral_locked = member
            .collateral_locked
            .checked_sub(release)
            .ok_or_else(|| error!(RingioError::MathOverflow))?;
        group.total_collateral_locked = group
            .total_collateral_locked
            .checked_sub(release)
            .ok_or_else(|| error!(RingioError::MathOverflow))?;
        group.round_contributions = group
            .round_contributions
            .checked_add(1)
            .ok_or_else(|| error!(RingioError::MathOverflow))?;

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.source.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.pot_vault.to_account_info(),
                    authority: ctx.accounts.participant.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        if release > 0 {
            let signer_creator = group.creator;
            let group_id = group.id.to_le_bytes();
            let group_bump = [group.bump];
            let signer_seeds: &[&[u8]] = &[
                GROUP_SEED,
                signer_creator.as_ref(),
                group_id.as_ref(),
                group_bump.as_ref(),
            ];
            token::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.collateral_vault.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.source.to_account_info(),
                        authority: group_authority,
                    },
                    &[signer_seeds],
                ),
                release,
                ctx.accounts.mint.decimals,
            )?;
        }

        emit!(ContributionRecorded {
            group: group_key,
            member: participant,
            round,
            amount,
            collateral_released: release,
        });
        Ok(())
    }

    pub fn cover_default(ctx: Context<CoverDefault>) -> Result<()> {
        require_unpaused(&ctx.accounts.config)?;
        let now = Clock::get()?.unix_timestamp;
        let keeper = ctx.accounts.keeper.key();
        let group_key = ctx.accounts.group.key();
        let group_authority = ctx.accounts.group.to_account_info();
        let group = &mut ctx.accounts.group;
        let member = &mut ctx.accounts.member;
        require!(
            group.status == GroupStatus::Active,
            RingioError::InvalidGroupState
        );

        let base_grace_ends = math::round_grace_ends(
            group.round_started_at,
            group.period_seconds,
            group.grace_seconds,
        )
        .ok_or_else(|| error!(RingioError::MathOverflow))?;
        let grace_ends = math::effective_deadline(
            base_grace_ends,
            ctx.accounts.config.total_paused_seconds,
            group.phase_pause_snapshot,
        )
        .ok_or_else(|| error!(RingioError::MathOverflow))?;
        require!(now > grace_ends, RingioError::GracePeriodActive);
        require!(
            member.last_contributed_round != group.current_round,
            RingioError::ContributionAlreadyResolved
        );
        require!(
            member.payout_rank < group.current_round
                && member.payout_received
                && member.collateral_locked >= group.contribution_amount,
            RingioError::DefaultNotCoverable
        );

        let round = group.current_round;
        let amount = group.contribution_amount;
        member.last_contributed_round = round;
        member.last_resolution_kind = RESOLUTION_COLLATERAL;
        member.defaults = member
            .defaults
            .checked_add(1)
            .ok_or_else(|| error!(RingioError::MathOverflow))?;
        member.collateral_locked = member
            .collateral_locked
            .checked_sub(amount)
            .ok_or_else(|| error!(RingioError::MathOverflow))?;
        group.total_collateral_locked = group
            .total_collateral_locked
            .checked_sub(amount)
            .ok_or_else(|| error!(RingioError::MathOverflow))?;
        group.round_contributions = group
            .round_contributions
            .checked_add(1)
            .ok_or_else(|| error!(RingioError::MathOverflow))?;

        let signer_creator = group.creator;
        let group_id = group.id.to_le_bytes();
        let group_bump = [group.bump];
        let signer_seeds: &[&[u8]] = &[
            GROUP_SEED,
            signer_creator.as_ref(),
            group_id.as_ref(),
            group_bump.as_ref(),
        ];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.collateral_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.pot_vault.to_account_info(),
                    authority: group_authority,
                },
                &[signer_seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        emit!(DefaultCovered {
            group: group_key,
            member: member.wallet,
            keeper,
            round,
            amount,
        });
        Ok(())
    }

    pub fn settle_round(ctx: Context<SettleRound>) -> Result<()> {
        require_unpaused(&ctx.accounts.config)?;
        let now = Clock::get()?.unix_timestamp;
        let keeper = ctx.accounts.keeper.key();
        let group_key = ctx.accounts.group.key();
        let group_authority = ctx.accounts.group.to_account_info();
        let group = &mut ctx.accounts.group;
        let recipient_member = &mut ctx.accounts.recipient_member;

        require!(
            group.status == GroupStatus::Active,
            RingioError::InvalidGroupState
        );
        require!(
            group.round_contributions == group.member_count,
            RingioError::RoundIncomplete
        );
        let expected_recipient = group
            .expected_recipient()
            .ok_or_else(|| error!(RingioError::WrongRecipient))?;
        require_keys_eq!(
            expected_recipient,
            recipient_member.wallet,
            RingioError::WrongRecipient
        );
        require!(
            recipient_member.payout_rank == group.current_round,
            RingioError::WrongRecipient
        );
        require!(
            !recipient_member.payout_received,
            RingioError::PayoutAlreadyReceived
        );

        let round = group.current_round;
        let payout = math::round_payout(group.member_count, group.contribution_amount)
            .ok_or_else(|| error!(RingioError::MathOverflow))?;
        require!(
            ctx.accounts.pot_vault.amount >= payout,
            RingioError::InvariantViolation
        );

        recipient_member.payout_received = true;
        group.current_round = group
            .current_round
            .checked_add(1)
            .ok_or_else(|| error!(RingioError::MathOverflow))?;
        group.round_contributions = 0;
        let completed = group.current_round == group.member_count;
        if completed {
            group.status = GroupStatus::Completed;
        } else {
            group.round_started_at = now;
            group.phase_pause_snapshot = ctx.accounts.config.total_paused_seconds;
        }

        let signer_creator = group.creator;
        let group_id = group.id.to_le_bytes();
        let group_bump = [group.bump];
        let signer_seeds: &[&[u8]] = &[
            GROUP_SEED,
            signer_creator.as_ref(),
            group_id.as_ref(),
            group_bump.as_ref(),
        ];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.pot_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.recipient_token.to_account_info(),
                    authority: group_authority,
                },
                &[signer_seeds],
            ),
            payout,
            ctx.accounts.mint.decimals,
        )?;

        emit!(RoundSettled {
            group: group_key,
            keeper,
            round,
            recipient: expected_recipient,
            amount: payout,
            completed,
        });
        Ok(())
    }

    pub fn abort_uncovered_round(ctx: Context<AbortUncoveredRound>) -> Result<()> {
        require_unpaused(&ctx.accounts.config)?;
        let now = Clock::get()?.unix_timestamp;
        let group_key = ctx.accounts.group.key();
        let group = &mut ctx.accounts.group;
        let member = &ctx.accounts.delinquent_member;
        require!(
            group.status == GroupStatus::Active,
            RingioError::InvalidGroupState
        );

        let base_grace_ends = math::round_grace_ends(
            group.round_started_at,
            group.period_seconds,
            group.grace_seconds,
        )
        .ok_or_else(|| error!(RingioError::MathOverflow))?;
        let grace_ends = math::effective_deadline(
            base_grace_ends,
            ctx.accounts.config.total_paused_seconds,
            group.phase_pause_snapshot,
        )
        .ok_or_else(|| error!(RingioError::MathOverflow))?;
        require!(now > grace_ends, RingioError::GracePeriodActive);
        require!(
            member.last_contributed_round != group.current_round,
            RingioError::ContributionAlreadyResolved
        );
        let coverable = member.payout_rank < group.current_round
            && member.payout_received
            && member.collateral_locked >= group.contribution_amount;
        require!(!coverable, RingioError::DefaultIsCoverable);

        group.failed_round = group.current_round;
        group.status = GroupStatus::Defaulted;
        emit!(GroupTerminated {
            group: group_key,
            status: GroupStatus::Defaulted.event_code(),
            failed_round: group.failed_round,
            actor: ctx.accounts.keeper.key(),
        });
        Ok(())
    }

    pub fn cancel_group(ctx: Context<CancelGroup>) -> Result<()> {
        require_unpaused(&ctx.accounts.config)?;
        let now = Clock::get()?.unix_timestamp;
        let caller = ctx.accounts.caller.key();
        let group_key = ctx.accounts.group.key();
        let group = &mut ctx.accounts.group;

        let allowed = match group.status {
            GroupStatus::Forming => {
                let deadline = math::effective_deadline(
                    group.join_deadline,
                    ctx.accounts.config.total_paused_seconds,
                    group.phase_pause_snapshot,
                )
                .ok_or_else(|| error!(RingioError::MathOverflow))?;
                caller == group.creator || now > deadline
            }
            GroupStatus::Revealing => {
                let deadline = math::effective_deadline(
                    group.reveal_deadline,
                    ctx.accounts.config.total_paused_seconds,
                    group.phase_pause_snapshot,
                )
                .ok_or_else(|| error!(RingioError::MathOverflow))?;
                now > deadline && group.revealed_count < group.member_count
            }
            GroupStatus::Collateralizing => {
                let deadline = math::effective_deadline(
                    group.collateral_deadline,
                    ctx.accounts.config.total_paused_seconds,
                    group.phase_pause_snapshot,
                )
                .ok_or_else(|| error!(RingioError::MathOverflow))?;
                now > deadline && group.collateralized_count < group.member_count
            }
            _ => false,
        };
        require!(allowed, RingioError::CancellationNotAllowed);

        group.status = GroupStatus::Cancelled;
        emit!(GroupTerminated {
            group: group_key,
            status: GroupStatus::Cancelled.event_code(),
            failed_round: UNSET_ROUND,
            actor: caller,
        });
        Ok(())
    }

    pub fn refund_failed_round(ctx: Context<RefundFailedRound>) -> Result<()> {
        let group_key = ctx.accounts.group.key();
        let group_authority = ctx.accounts.group.to_account_info();
        let group = &mut ctx.accounts.group;
        let member = &mut ctx.accounts.member;
        require!(
            group.status == GroupStatus::Defaulted,
            RingioError::InvalidGroupState
        );
        require!(
            member.last_contributed_round == group.failed_round
                && member.last_refunded_round != group.failed_round,
            RingioError::NothingToRefund
        );
        require!(
            member.last_resolution_kind == RESOLUTION_DIRECT
                || member.last_resolution_kind == RESOLUTION_COLLATERAL,
            RingioError::NothingToRefund
        );

        let round = group.failed_round;
        let amount = group.contribution_amount;
        let resolution_kind = member.last_resolution_kind;
        member.last_refunded_round = round;
        group.round_contributions = group
            .round_contributions
            .checked_sub(1)
            .ok_or_else(|| error!(RingioError::MathOverflow))?;

        if resolution_kind == RESOLUTION_COLLATERAL {
            member.collateral_locked = member
                .collateral_locked
                .checked_add(amount)
                .ok_or_else(|| error!(RingioError::MathOverflow))?;
            group.total_collateral_locked = group
                .total_collateral_locked
                .checked_add(amount)
                .ok_or_else(|| error!(RingioError::MathOverflow))?;
        }

        let signer_creator = group.creator;
        let group_id = group.id.to_le_bytes();
        let group_bump = [group.bump];
        let signer_seeds: &[&[u8]] = &[
            GROUP_SEED,
            signer_creator.as_ref(),
            group_id.as_ref(),
            group_bump.as_ref(),
        ];
        let destination = if resolution_kind == RESOLUTION_DIRECT {
            ctx.accounts.member_token.to_account_info()
        } else {
            ctx.accounts.collateral_vault.to_account_info()
        };
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.pot_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: destination,
                    authority: group_authority,
                },
                &[signer_seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        emit!(FailedRoundRefunded {
            group: group_key,
            member: member.wallet,
            round,
            resolution_kind,
            amount,
        });
        Ok(())
    }

    pub fn refund_collateral(ctx: Context<RefundCollateral>) -> Result<()> {
        let group_key = ctx.accounts.group.key();
        let group_authority = ctx.accounts.group.to_account_info();
        let group = &mut ctx.accounts.group;
        let member = &mut ctx.accounts.member;
        require!(
            group.status == GroupStatus::Cancelled
                || group.status == GroupStatus::Defaulted
                || group.status == GroupStatus::Completed,
            RingioError::InvalidGroupState
        );
        if group.status == GroupStatus::Defaulted {
            require!(
                group.round_contributions == 0,
                RingioError::PendingRoundRefunds
            );
        }

        let amount = member.collateral_locked;
        require!(amount > 0, RingioError::NothingToRefund);
        member.collateral_locked = 0;
        group.total_collateral_locked = group
            .total_collateral_locked
            .checked_sub(amount)
            .ok_or_else(|| error!(RingioError::MathOverflow))?;

        let signer_creator = group.creator;
        let group_id = group.id.to_le_bytes();
        let group_bump = [group.bump];
        let signer_seeds: &[&[u8]] = &[
            GROUP_SEED,
            signer_creator.as_ref(),
            group_id.as_ref(),
            group_bump.as_ref(),
        ];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.collateral_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.member_token.to_account_info(),
                    authority: group_authority,
                },
                &[signer_seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        emit!(CollateralRefunded {
            group: group_key,
            member: member.wallet,
            amount,
        });
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateGroupArgs {
    pub group_id: u64,
    pub member_count: u16,
    pub contribution_amount: u64,
    pub period_seconds: i64,
    pub grace_seconds: i64,
    pub join_deadline: i64,
    pub reveal_window_seconds: i64,
    pub collateral_window_seconds: i64,
    pub creator_commitment: [u8; 32],
}

fn validate_group_args(args: &CreateGroupArgs, now: i64) -> Result<()> {
    require!(
        args.member_count >= MIN_MEMBERS && usize::from(args.member_count) <= MAX_MEMBERS,
        RingioError::InvalidMemberCount
    );
    require!(
        args.contribution_amount > 0,
        RingioError::InvalidContributionAmount
    );
    require!(
        args.period_seconds > 0
            && args.grace_seconds > 0
            && args.reveal_window_seconds > 0
            && args.collateral_window_seconds > 0
            && args.period_seconds <= MAX_PHASE_SECONDS
            && args.grace_seconds <= MAX_PHASE_SECONDS
            && args.reveal_window_seconds <= MAX_PHASE_SECONDS
            && args.collateral_window_seconds <= MAX_PHASE_SECONDS,
        RingioError::InvalidDuration
    );
    require!(args.join_deadline > now, RingioError::InvalidDeadline);
    let join_window = args
        .join_deadline
        .checked_sub(now)
        .ok_or_else(|| error!(RingioError::MathOverflow))?;
    require!(
        join_window <= MAX_PHASE_SECONDS,
        RingioError::InvalidDeadline
    );
    math::round_payout(args.member_count, args.contribution_amount)
        .ok_or_else(|| error!(RingioError::MathOverflow))?;
    math::total_collateral_required(args.member_count, args.contribution_amount)
        .ok_or_else(|| error!(RingioError::MathOverflow))?;
    math::round_grace_ends(now, args.period_seconds, args.grace_seconds)
        .ok_or_else(|| error!(RingioError::MathOverflow))?;
    args.join_deadline
        .checked_add(args.reveal_window_seconds)
        .and_then(|deadline| deadline.checked_add(args.collateral_window_seconds))
        .ok_or_else(|| error!(RingioError::MathOverflow))?;
    Ok(())
}

fn require_unpaused(config: &GlobalConfig) -> Result<()> {
    require!(!config.paused, RingioError::ProtocolPaused);
    Ok(())
}

fn next_pause_state(
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
            math::accumulate_pause_seconds(total_paused_seconds, paused_at, now)?,
        )),
        _ => Some((paused_at, total_paused_seconds)),
    }
}

pub fn commitment_hash(group: &Pubkey, member: &Pubkey, secret: &[u8; 32]) -> [u8; 32] {
    hashv(&[COMMITMENT_DOMAIN, group.as_ref(), member.as_ref(), secret]).to_bytes()
}

pub fn reveal_digest(group: &Pubkey, member: &Pubkey, secret: &[u8; 32]) -> [u8; 32] {
    hashv(&[REVEAL_DOMAIN, group.as_ref(), member.as_ref(), secret]).to_bytes()
}

fn xor_digest(accumulator: &mut [u8; 32], digest: &[u8; 32]) {
    for (target, source) in accumulator.iter_mut().zip(digest.iter()) {
        *target ^= *source;
    }
}

#[cfg(test)]
mod validation_tests {
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
    fn creation_rejects_unbounded_windows() {
        let now = 1_700_000_000;
        let mut args = valid_args(now);
        args.period_seconds = MAX_PHASE_SECONDS + 1;
        assert!(validate_group_args(&args, now).is_err());
    }

    #[test]
    fn normal_group_terms_validate() {
        let now = 1_700_000_000;
        assert!(validate_group_args(&valid_args(now), now).is_ok());
    }

    #[test]
    fn pause_state_accumulates_only_real_completed_intervals() {
        let first_pause = next_pause_state(false, true, 0, 5, 100).unwrap();
        assert_eq!(first_pause, (100, 5));

        // Repeating the same state must not reset the start timestamp.
        let repeated_pause =
            next_pause_state(true, true, first_pause.0, first_pause.1, 105).unwrap();
        assert_eq!(repeated_pause, first_pause);

        let first_resume =
            next_pause_state(true, false, repeated_pause.0, repeated_pause.1, 110).unwrap();
        assert_eq!(first_resume, (0, 15));

        // Repeating unpaused must not increase the completed total.
        let repeated_resume =
            next_pause_state(false, false, first_resume.0, first_resume.1, 999).unwrap();
        assert_eq!(repeated_resume, first_resume);

        let second_pause =
            next_pause_state(false, true, repeated_resume.0, repeated_resume.1, 200).unwrap();
        let second_resume =
            next_pause_state(true, false, second_pause.0, second_pause.1, 207).unwrap();
        assert_eq!(second_resume, (0, 22));
    }

    #[test]
    fn pause_state_rejects_clock_reversal_and_total_overflow() {
        assert_eq!(next_pause_state(true, false, 200, 0, 199), None);
        assert_eq!(next_pause_state(true, false, 10, u64::MAX, 11), None);
    }

    #[test]
    fn commitment_is_domain_bound_to_group_and_member() {
        let group_a = Pubkey::new_unique();
        let group_b = Pubkey::new_unique();
        let member_a = Pubkey::new_unique();
        let member_b = Pubkey::new_unique();
        let secret = [9_u8; 32];

        let baseline = commitment_hash(&group_a, &member_a, &secret);
        assert_ne!(baseline, ZERO_HASH);
        assert_ne!(baseline, commitment_hash(&group_b, &member_a, &secret));
        assert_ne!(baseline, commitment_hash(&group_a, &member_b, &secret));
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + GlobalConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        constraint = ringio_program.programdata_address()? == Some(program_data.key()) @ RingioError::Unauthorized
    )]
    pub ringio_program: Program<'info, crate::program::Ringio>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(admin.key()) @ RingioError::Unauthorized
    )]
    pub program_data: Box<Account<'info, ProgramData>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.pause_authority == pause_authority.key() @ RingioError::Unauthorized
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    pub pause_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdatePauseAuthority<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.admin == admin.key() @ RingioError::Unauthorized
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(args: CreateGroupArgs)]
pub struct CreateGroup<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        init,
        payer = creator,
        space = 8 + Group::INIT_SPACE,
        seeds = [GROUP_SEED, creator.key().as_ref(), args.group_id.to_le_bytes().as_ref()],
        bump
    )]
    pub group: Box<Account<'info, Group>>,
    #[account(
        init,
        payer = creator,
        space = 8 + Member::INIT_SPACE,
        seeds = [MEMBER_SEED, group.key().as_ref(), creator.key().as_ref()],
        bump
    )]
    pub creator_member: Box<Account<'info, Member>>,
    #[account(
        init,
        payer = creator,
        seeds = [POT_VAULT_SEED, group.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = group
    )]
    pub pot_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = creator,
        seeds = [COLLATERAL_VAULT_SEED, group.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = group
    )]
    pub collateral_vault: Box<Account<'info, TokenAccount>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(invitee: Pubkey)]
pub struct InviteMember<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        seeds = [GROUP_SEED, group.creator.as_ref(), group.id.to_le_bytes().as_ref()],
        bump = group.bump,
        constraint = group.creator == creator.key() @ RingioError::Unauthorized
    )]
    pub group: Box<Account<'info, Group>>,
    #[account(
        init,
        payer = creator,
        space = 8 + Invite::INIT_SPACE,
        seeds = [INVITE_SEED, group.key().as_ref(), invitee.as_ref()],
        bump
    )]
    pub invite: Box<Account<'info, Invite>>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinGroup<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [GROUP_SEED, group.creator.as_ref(), group.id.to_le_bytes().as_ref()],
        bump = group.bump
    )]
    pub group: Box<Account<'info, Group>>,
    #[account(
        mut,
        seeds = [INVITE_SEED, group.key().as_ref(), participant.key().as_ref()],
        bump = invite.bump,
        constraint = invite.group == group.key() @ RingioError::InvalidInvite,
        constraint = invite.invitee == participant.key() @ RingioError::InvalidInvite
    )]
    pub invite: Box<Account<'info, Invite>>,
    #[account(
        init,
        payer = participant,
        space = 8 + Member::INIT_SPACE,
        seeds = [MEMBER_SEED, group.key().as_ref(), participant.key().as_ref()],
        bump
    )]
    pub member: Box<Account<'info, Member>>,
    #[account(mut)]
    pub participant: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealSecret<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [GROUP_SEED, group.creator.as_ref(), group.id.to_le_bytes().as_ref()],
        bump = group.bump
    )]
    pub group: Box<Account<'info, Group>>,
    #[account(
        mut,
        seeds = [MEMBER_SEED, group.key().as_ref(), participant.key().as_ref()],
        bump = member.bump,
        constraint = member.group == group.key() @ RingioError::Unauthorized,
        constraint = member.wallet == participant.key() @ RingioError::Unauthorized
    )]
    pub member: Box<Account<'info, Member>>,
    pub participant: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizeOrder<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [GROUP_SEED, group.creator.as_ref(), group.id.to_le_bytes().as_ref()],
        bump = group.bump
    )]
    pub group: Box<Account<'info, Group>>,
}

#[derive(Accounts)]
pub struct PostCollateral<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [GROUP_SEED, group.creator.as_ref(), group.id.to_le_bytes().as_ref()],
        bump = group.bump,
        has_one = mint @ RingioError::WrongMint,
        constraint = group.collateral_vault == collateral_vault.key() @ RingioError::WrongVault
    )]
    pub group: Box<Account<'info, Group>>,
    #[account(
        mut,
        seeds = [MEMBER_SEED, group.key().as_ref(), participant.key().as_ref()],
        bump = member.bump,
        constraint = member.group == group.key() @ RingioError::Unauthorized,
        constraint = member.wallet == participant.key() @ RingioError::Unauthorized
    )]
    pub member: Box<Account<'info, Member>>,
    #[account(
        mut,
        constraint = source.mint == group.mint @ RingioError::WrongMint,
        constraint = source.owner == participant.key() @ RingioError::WrongTokenAuthority
    )]
    pub source: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        address = group.collateral_vault @ RingioError::WrongVault,
        constraint = collateral_vault.mint == group.mint @ RingioError::WrongMint,
        constraint = collateral_vault.owner == group.key() @ RingioError::WrongTokenAuthority
    )]
    pub collateral_vault: Box<Account<'info, TokenAccount>>,
    pub mint: Box<Account<'info, Mint>>,
    pub participant: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ActivateGroup<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [GROUP_SEED, group.creator.as_ref(), group.id.to_le_bytes().as_ref()],
        bump = group.bump,
        constraint = group.collateral_vault == collateral_vault.key() @ RingioError::WrongVault
    )]
    pub group: Box<Account<'info, Group>>,
    #[account(
        address = group.collateral_vault @ RingioError::WrongVault,
        constraint = collateral_vault.mint == group.mint @ RingioError::WrongMint,
        constraint = collateral_vault.owner == group.key() @ RingioError::WrongTokenAuthority
    )]
    pub collateral_vault: Box<Account<'info, TokenAccount>>,
}

#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [GROUP_SEED, group.creator.as_ref(), group.id.to_le_bytes().as_ref()],
        bump = group.bump,
        has_one = mint @ RingioError::WrongMint,
        constraint = group.pot_vault == pot_vault.key() @ RingioError::WrongVault,
        constraint = group.collateral_vault == collateral_vault.key() @ RingioError::WrongVault
    )]
    pub group: Box<Account<'info, Group>>,
    #[account(
        mut,
        seeds = [MEMBER_SEED, group.key().as_ref(), participant.key().as_ref()],
        bump = member.bump,
        constraint = member.group == group.key() @ RingioError::Unauthorized,
        constraint = member.wallet == participant.key() @ RingioError::Unauthorized,
        constraint = member.collateral_posted @ RingioError::CollateralIncomplete
    )]
    pub member: Box<Account<'info, Member>>,
    #[account(
        mut,
        constraint = source.mint == group.mint @ RingioError::WrongMint,
        constraint = source.owner == participant.key() @ RingioError::WrongTokenAuthority
    )]
    pub source: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        address = group.pot_vault @ RingioError::WrongVault,
        constraint = pot_vault.mint == group.mint @ RingioError::WrongMint,
        constraint = pot_vault.owner == group.key() @ RingioError::WrongTokenAuthority
    )]
    pub pot_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        address = group.collateral_vault @ RingioError::WrongVault,
        constraint = collateral_vault.mint == group.mint @ RingioError::WrongMint,
        constraint = collateral_vault.owner == group.key() @ RingioError::WrongTokenAuthority
    )]
    pub collateral_vault: Box<Account<'info, TokenAccount>>,
    pub mint: Box<Account<'info, Mint>>,
    pub participant: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CoverDefault<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [GROUP_SEED, group.creator.as_ref(), group.id.to_le_bytes().as_ref()],
        bump = group.bump,
        has_one = mint @ RingioError::WrongMint,
        constraint = group.pot_vault == pot_vault.key() @ RingioError::WrongVault,
        constraint = group.collateral_vault == collateral_vault.key() @ RingioError::WrongVault
    )]
    pub group: Box<Account<'info, Group>>,
    #[account(
        mut,
        seeds = [MEMBER_SEED, group.key().as_ref(), member.wallet.as_ref()],
        bump = member.bump,
        constraint = member.group == group.key() @ RingioError::Unauthorized
    )]
    pub member: Box<Account<'info, Member>>,
    #[account(
        mut,
        address = group.pot_vault @ RingioError::WrongVault,
        constraint = pot_vault.mint == group.mint @ RingioError::WrongMint,
        constraint = pot_vault.owner == group.key() @ RingioError::WrongTokenAuthority
    )]
    pub pot_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        address = group.collateral_vault @ RingioError::WrongVault,
        constraint = collateral_vault.mint == group.mint @ RingioError::WrongMint,
        constraint = collateral_vault.owner == group.key() @ RingioError::WrongTokenAuthority
    )]
    pub collateral_vault: Box<Account<'info, TokenAccount>>,
    pub mint: Box<Account<'info, Mint>>,
    pub keeper: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SettleRound<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [GROUP_SEED, group.creator.as_ref(), group.id.to_le_bytes().as_ref()],
        bump = group.bump,
        has_one = mint @ RingioError::WrongMint,
        constraint = group.pot_vault == pot_vault.key() @ RingioError::WrongVault
    )]
    pub group: Box<Account<'info, Group>>,
    #[account(
        mut,
        seeds = [MEMBER_SEED, group.key().as_ref(), recipient_member.wallet.as_ref()],
        bump = recipient_member.bump,
        constraint = recipient_member.group == group.key() @ RingioError::WrongRecipient
    )]
    pub recipient_member: Box<Account<'info, Member>>,
    #[account(
        mut,
        address = group.pot_vault @ RingioError::WrongVault,
        constraint = pot_vault.mint == group.mint @ RingioError::WrongMint,
        constraint = pot_vault.owner == group.key() @ RingioError::WrongTokenAuthority
    )]
    pub pot_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = recipient_token.mint == group.mint @ RingioError::WrongMint,
        constraint = recipient_token.owner == recipient_member.wallet @ RingioError::WrongTokenAuthority
    )]
    pub recipient_token: Box<Account<'info, TokenAccount>>,
    pub mint: Box<Account<'info, Mint>>,
    pub keeper: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AbortUncoveredRound<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [GROUP_SEED, group.creator.as_ref(), group.id.to_le_bytes().as_ref()],
        bump = group.bump
    )]
    pub group: Box<Account<'info, Group>>,
    #[account(
        seeds = [MEMBER_SEED, group.key().as_ref(), delinquent_member.wallet.as_ref()],
        bump = delinquent_member.bump,
        constraint = delinquent_member.group == group.key() @ RingioError::Unauthorized
    )]
    pub delinquent_member: Box<Account<'info, Member>>,
    pub keeper: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelGroup<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [GROUP_SEED, group.creator.as_ref(), group.id.to_le_bytes().as_ref()],
        bump = group.bump
    )]
    pub group: Box<Account<'info, Group>>,
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct RefundFailedRound<'info> {
    #[account(
        mut,
        seeds = [GROUP_SEED, group.creator.as_ref(), group.id.to_le_bytes().as_ref()],
        bump = group.bump,
        has_one = mint @ RingioError::WrongMint,
        constraint = group.pot_vault == pot_vault.key() @ RingioError::WrongVault,
        constraint = group.collateral_vault == collateral_vault.key() @ RingioError::WrongVault
    )]
    pub group: Box<Account<'info, Group>>,
    #[account(
        mut,
        seeds = [MEMBER_SEED, group.key().as_ref(), member.wallet.as_ref()],
        bump = member.bump,
        constraint = member.group == group.key() @ RingioError::Unauthorized
    )]
    pub member: Box<Account<'info, Member>>,
    #[account(
        mut,
        address = group.pot_vault @ RingioError::WrongVault,
        constraint = pot_vault.mint == group.mint @ RingioError::WrongMint,
        constraint = pot_vault.owner == group.key() @ RingioError::WrongTokenAuthority
    )]
    pub pot_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        address = group.collateral_vault @ RingioError::WrongVault,
        constraint = collateral_vault.mint == group.mint @ RingioError::WrongMint,
        constraint = collateral_vault.owner == group.key() @ RingioError::WrongTokenAuthority
    )]
    pub collateral_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = member_token.mint == group.mint @ RingioError::WrongMint,
        constraint = member_token.owner == member.wallet @ RingioError::WrongTokenAuthority
    )]
    pub member_token: Box<Account<'info, TokenAccount>>,
    pub mint: Box<Account<'info, Mint>>,
    pub keeper: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RefundCollateral<'info> {
    #[account(
        mut,
        seeds = [GROUP_SEED, group.creator.as_ref(), group.id.to_le_bytes().as_ref()],
        bump = group.bump,
        has_one = mint @ RingioError::WrongMint,
        constraint = group.collateral_vault == collateral_vault.key() @ RingioError::WrongVault
    )]
    pub group: Box<Account<'info, Group>>,
    #[account(
        mut,
        seeds = [MEMBER_SEED, group.key().as_ref(), participant.key().as_ref()],
        bump = member.bump,
        constraint = member.group == group.key() @ RingioError::Unauthorized,
        constraint = member.wallet == participant.key() @ RingioError::Unauthorized
    )]
    pub member: Box<Account<'info, Member>>,
    #[account(
        mut,
        address = group.collateral_vault @ RingioError::WrongVault,
        constraint = collateral_vault.mint == group.mint @ RingioError::WrongMint,
        constraint = collateral_vault.owner == group.key() @ RingioError::WrongTokenAuthority
    )]
    pub collateral_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = member_token.mint == group.mint @ RingioError::WrongMint,
        constraint = member_token.owner == participant.key() @ RingioError::WrongTokenAuthority
    )]
    pub member_token: Box<Account<'info, TokenAccount>>,
    pub mint: Box<Account<'info, Mint>>,
    pub participant: Signer<'info>,
    pub token_program: Program<'info, Token>,
}
