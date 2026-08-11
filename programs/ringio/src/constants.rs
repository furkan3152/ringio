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
