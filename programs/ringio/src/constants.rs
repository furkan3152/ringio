use pinocchio::pubkey::Pubkey;
use pinocchio_pubkey::pubkey;

pub const CONFIG_SEED: &[u8] = b"config";
pub const GROUP_SEED: &[u8] = b"group";
pub const MEMBER_SEED: &[u8] = b"member";
pub const INVITE_SEED: &[u8] = b"invite";
pub const POT_VAULT_SEED: &[u8] = b"pot-vault";
pub const COLLATERAL_VAULT_SEED: &[u8] = b"collateral-vault";

pub const COMMITMENT_DOMAIN: &[u8] = b"ringio-commitment-v1";
pub const REVEAL_DOMAIN: &[u8] = b"ringio-reveal-v1";
pub const ORDER_DOMAIN: &[u8] = b"ringio-order-v1";

pub const MAX_MEMBERS: usize = 32;
pub const MIN_MEMBERS: u16 = 2;
/// MVP bound for any individual signup/reveal/collateral/round/grace window.
pub const MAX_PHASE_SECONDS: i64 = 366 * 24 * 60 * 60;
pub const UNSET_ROUND: u16 = u16::MAX;
pub const RESOLUTION_NONE: u8 = 0;
pub const RESOLUTION_DIRECT: u8 = 1;
pub const RESOLUTION_COLLATERAL: u8 = 2;
pub const STATE_VERSION: u8 = 1;
pub const ZERO_HASH: [u8; 32] = [0; 32];

pub const TOKEN_PROGRAM_ID: Pubkey = pinocchio_token::ID;
pub const SYSTEM_PROGRAM_ID: Pubkey = pinocchio_system::ID;
pub const BPF_LOADER_UPGRADEABLE_ID: Pubkey =
    pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");
pub const RENT_SYSVAR_ID: Pubkey = pinocchio::sysvars::rent::RENT_ID;

/// Anchor-compatible discriminators (`sha256("<namespace>:<Name>")[..8]`) are
/// kept so existing accounts, clients, and indexers keep working unchanged.
pub mod discriminator {
    pub const CONFIG: [u8; 8] = [149, 8, 156, 202, 160, 252, 176, 217];
    pub const GROUP: [u8; 8] = [209, 249, 208, 63, 182, 89, 186, 254];
    pub const INVITE: [u8; 8] = [230, 17, 253, 74, 50, 78, 85, 101];
    pub const MEMBER: [u8; 8] = [54, 19, 162, 21, 29, 166, 17, 198];

    pub const INITIALIZE_CONFIG: [u8; 8] = [208, 127, 21, 1, 194, 190, 196, 70];
    pub const SET_PAUSED: [u8; 8] = [91, 60, 125, 192, 176, 225, 166, 218];
    pub const UPDATE_PAUSE_AUTHORITY: [u8; 8] = [79, 153, 171, 110, 33, 64, 245, 76];
    pub const CREATE_GROUP: [u8; 8] = [79, 60, 158, 134, 61, 199, 56, 248];
    pub const INVITE_MEMBER: [u8; 8] = [67, 227, 110, 3, 215, 2, 41, 203];
    pub const JOIN_GROUP: [u8; 8] = [121, 56, 199, 19, 250, 70, 44, 184];
    pub const REVEAL_SECRET: [u8; 8] = [126, 156, 142, 60, 92, 135, 177, 144];
    pub const FINALIZE_ORDER: [u8; 8] = [198, 89, 84, 237, 43, 9, 99, 55];
    pub const POST_COLLATERAL: [u8; 8] = [124, 252, 97, 53, 118, 194, 88, 112];
    pub const ACTIVATE_GROUP: [u8; 8] = [96, 168, 28, 195, 112, 207, 238, 48];
    pub const CONTRIBUTE: [u8; 8] = [82, 33, 68, 131, 32, 0, 205, 95];
    pub const COVER_DEFAULT: [u8; 8] = [164, 156, 199, 143, 160, 123, 119, 245];
    pub const SETTLE_ROUND: [u8; 8] = [40, 101, 18, 1, 31, 129, 52, 77];
    pub const ABORT_UNCOVERED_ROUND: [u8; 8] = [7, 89, 57, 143, 101, 82, 79, 243];
    pub const CANCEL_GROUP: [u8; 8] = [219, 172, 216, 128, 155, 75, 12, 110];
    pub const REFUND_FAILED_ROUND: [u8; 8] = [232, 78, 193, 43, 101, 150, 10, 133];
    pub const REFUND_COLLATERAL: [u8; 8] = [200, 219, 212, 225, 216, 188, 155, 225];
}
