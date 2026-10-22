import { PublicKey } from "@solana/web3.js";

/** Mirrors `programs/ringio/src/constants.rs`. */
export const SEEDS = {
  config: "config",
  group: "group",
  member: "member",
  invite: "invite",
  potVault: "pot-vault",
  collateralVault: "collateral-vault",
} as const;

export const COMMITMENT_DOMAIN = "ringio-commitment-v1";
export const REVEAL_DOMAIN = "ringio-reveal-v1";
/** Client-only domain used to turn a wallet signature into a commitment secret. */
export const SECRET_DOMAIN = "ringio-wallet-derived-secret-v1";

export const MAX_MEMBERS = 32;
export const MIN_MEMBERS = 2;
export const MAX_PHASE_SECONDS = 366 * 24 * 60 * 60;
export const UNSET_ROUND = 0xffff;

export const RESOLUTION_NONE = 0;
export const RESOLUTION_DIRECT = 1;
export const RESOLUTION_COLLATERAL = 2;

export const ACCOUNT_SIZES = {
  config: 136,
  group: 2_387,
  member: 190,
  invite: 104,
} as const;

/** Anchor discriminators: first 8 bytes of sha256("account:<Name>"). */
export const ACCOUNT_DISCRIMINATORS = {
  config: Uint8Array.from([149, 8, 156, 202, 160, 252, 176, 217]),
  group: Uint8Array.from([209, 249, 208, 63, 182, 89, 186, 254]),
  invite: Uint8Array.from([230, 17, 253, 74, 50, 78, 85, 101]),
  member: Uint8Array.from([54, 19, 162, 21, 29, 166, 17, 198]),
} as const;

/** Anchor discriminators: first 8 bytes of sha256("global:<snake_name>"). */
export const INSTRUCTION_DISCRIMINATORS = {
  initializeConfig: Uint8Array.from([208, 127, 21, 1, 194, 190, 196, 70]),
  createGroup: Uint8Array.from([79, 60, 158, 134, 61, 199, 56, 248]),
  inviteMember: Uint8Array.from([67, 227, 110, 3, 215, 2, 41, 203]),
  joinGroup: Uint8Array.from([121, 56, 199, 19, 250, 70, 44, 184]),
  revealSecret: Uint8Array.from([126, 156, 142, 60, 92, 135, 177, 144]),
  finalizeOrder: Uint8Array.from([198, 89, 84, 237, 43, 9, 99, 55]),
  postCollateral: Uint8Array.from([124, 252, 97, 53, 118, 194, 88, 112]),
  activateGroup: Uint8Array.from([96, 168, 28, 195, 112, 207, 238, 48]),
  contribute: Uint8Array.from([82, 33, 68, 131, 32, 0, 205, 95]),
  coverDefault: Uint8Array.from([164, 156, 199, 143, 160, 123, 119, 245]),
  settleRound: Uint8Array.from([40, 101, 18, 1, 31, 129, 52, 77]),
  abortUncoveredRound: Uint8Array.from([7, 89, 57, 143, 101, 82, 79, 243]),
  cancelGroup: Uint8Array.from([219, 172, 216, 128, 155, 75, 12, 110]),
  refundFailedRound: Uint8Array.from([232, 78, 193, 43, 101, 150, 10, 133]),
  refundCollateral: Uint8Array.from([200, 219, 212, 225, 216, 188, 155, 225]),
} as const;

export const GROUP_STATUSES = [
  "forming",
  "revealing",
  "collateralizing",
  "active",
  "completed",
  "cancelled",
  "defaulted",
] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];

/** Byte offset of `Group.status`, used for server-side memcmp filters. */
export const GROUP_STATUS_OFFSET = 2_342;
export const GROUP_CREATOR_OFFSET = 8;
export const MEMBER_GROUP_OFFSET = 8;
export const MEMBER_WALLET_OFFSET = 40;
export const INVITE_GROUP_OFFSET = 8;
export const INVITE_INVITEE_OFFSET = 40;

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
