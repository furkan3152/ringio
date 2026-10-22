import bs58 from "bs58";
import { type Connection, PublicKey } from "@solana/web3.js";

import {
  decodeConfig,
  decodeGroup,
  decodeInvite,
  decodeMember,
  decodeMintDecimals,
  decodeTokenAccount,
  type ConfigAccount,
  type GroupAccount,
  type InviteAccount,
  type MemberAccount,
} from "./accounts";
import {
  ACCOUNT_DISCRIMINATORS,
  ACCOUNT_SIZES,
  GROUP_STATUS_OFFSET,
  INVITE_GROUP_OFFSET,
  INVITE_INVITEE_OFFSET,
  MEMBER_GROUP_OFFSET,
  MEMBER_WALLET_OFFSET,
} from "./constants";
import { associatedTokenAddress, configPda } from "./pda";

/** Read helpers shared by the browser dashboard and the server API. */

export type ProgramStatus =
  | { state: "ready"; config: ConfigAccount }
  | { state: "not-deployed" }
  | { state: "not-initialized" };

export type CircleSnapshot = {
  group: GroupAccount;
  members: MemberAccount[];
  invites: InviteAccount[];
  decimals: number;
  potBalance: bigint;
  collateralBalance: bigint;
};

const COMMITMENT = "confirmed" as const;

function discriminatorFilter(discriminator: Uint8Array) {
  return { memcmp: { offset: 0, bytes: bs58.encode(discriminator) } };
}

function keyFilter(offset: number, key: string) {
  return { memcmp: { offset, bytes: key } };
}

export async function fetchProgramStatus(connection: Connection, programId: PublicKey): Promise<ProgramStatus> {
  const config = configPda(programId);
  const [program, configAccount] = await connection.getMultipleAccountsInfo([programId, config], COMMITMENT);
  if (!program || !program.executable) return { state: "not-deployed" };
  if (!configAccount || !configAccount.owner.equals(programId)) return { state: "not-initialized" };
  return { state: "ready", config: decodeConfig(config.toBase58(), configAccount.data) };
}

async function membersOfGroup(connection: Connection, programId: PublicKey, group: string): Promise<MemberAccount[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: COMMITMENT,
    filters: [
      { dataSize: ACCOUNT_SIZES.member },
      discriminatorFilter(ACCOUNT_DISCRIMINATORS.member),
      keyFilter(MEMBER_GROUP_OFFSET, group),
    ],
  });
  return accounts
    .map(({ pubkey, account }) => decodeMember(pubkey.toBase58(), account.data))
    .sort((left, right) => left.joinedIndex - right.joinedIndex);
}

async function invitesOfGroup(connection: Connection, programId: PublicKey, group: string): Promise<InviteAccount[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: COMMITMENT,
    filters: [
      { dataSize: ACCOUNT_SIZES.invite },
      discriminatorFilter(ACCOUNT_DISCRIMINATORS.invite),
      keyFilter(INVITE_GROUP_OFFSET, group),
    ],
  });
  return accounts.map(({ pubkey, account }) => decodeInvite(pubkey.toBase58(), account.data));
}

/** Loads full snapshots (members, invites, vault balances) for known Group accounts. */
export async function fetchCircles(
  connection: Connection,
  programId: PublicKey,
  groupAddresses: readonly string[],
): Promise<CircleSnapshot[]> {
  const unique = [...new Set(groupAddresses)];
  if (unique.length === 0) return [];
  const groupInfos = await connection.getMultipleAccountsInfo(
    unique.map((address) => new PublicKey(address)),
    COMMITMENT,
  );
  const groups = groupInfos.flatMap((info, index) =>
    info && info.owner.equals(programId) ? [decodeGroup(unique[index], info.data)] : [],
  );
  if (groups.length === 0) return [];

  const mints = [...new Set(groups.map((group) => group.mint))];
  const vaults = groups.flatMap((group) => [group.potVault, group.collateralVault]);
  const [mintInfos, vaultInfos, rosters, inviteLists] = await Promise.all([
    connection.getMultipleAccountsInfo(mints.map((mint) => new PublicKey(mint)), COMMITMENT),
    connection.getMultipleAccountsInfo(vaults.map((vault) => new PublicKey(vault)), COMMITMENT),
    Promise.all(groups.map((group) => membersOfGroup(connection, programId, group.address))),
    Promise.all(groups.map((group) => invitesOfGroup(connection, programId, group.address))),
  ]);

  const decimals = new Map<string, number>();
  mints.forEach((mint, index) => {
    const info = mintInfos[index];
    if (!info) throw new Error(`Mint unavailable: ${mint}`);
    decimals.set(mint, decodeMintDecimals(mint, info.data));
  });
  const balance = (index: number) => {
    const info = vaultInfos[index];
    return info ? decodeTokenAccount(vaults[index], info.data).amount : BigInt(0);
  };

  return groups.map((group, index) => ({
    group,
    members: rosters[index],
    invites: inviteLists[index],
    decimals: decimals.get(group.mint) ?? 6,
    potBalance: balance(index * 2),
    collateralBalance: balance(index * 2 + 1),
  }));
}

export type WalletIndex = {
  /** Groups where the wallet holds a Member account (includes created circles). */
  memberGroups: string[];
  /** Unused invitations addressed to the wallet. */
  pendingInvites: InviteAccount[];
};

export async function fetchWalletIndex(
  connection: Connection,
  programId: PublicKey,
  wallet: string,
): Promise<WalletIndex> {
  const [memberAccounts, inviteAccounts] = await Promise.all([
    connection.getProgramAccounts(programId, {
      commitment: COMMITMENT,
      filters: [
        { dataSize: ACCOUNT_SIZES.member },
        discriminatorFilter(ACCOUNT_DISCRIMINATORS.member),
        keyFilter(MEMBER_WALLET_OFFSET, wallet),
      ],
    }),
    connection.getProgramAccounts(programId, {
      commitment: COMMITMENT,
      filters: [
        { dataSize: ACCOUNT_SIZES.invite },
        discriminatorFilter(ACCOUNT_DISCRIMINATORS.invite),
        keyFilter(INVITE_INVITEE_OFFSET, wallet),
      ],
    }),
  ]);
  return {
    memberGroups: memberAccounts.map(({ account }) => decodeMember("", account.data).group),
    pendingInvites: inviteAccounts
      .map(({ pubkey, account }) => decodeInvite(pubkey.toBase58(), account.data))
      .filter((invite) => !invite.used),
  };
}

/** Group addresses still in the Forming stage (discovery). */
export async function fetchFormingGroupAddresses(connection: Connection, programId: PublicKey): Promise<string[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: COMMITMENT,
    dataSlice: { offset: 0, length: 0 },
    filters: [
      { dataSize: ACCOUNT_SIZES.group },
      discriminatorFilter(ACCOUNT_DISCRIMINATORS.group),
      { memcmp: { offset: GROUP_STATUS_OFFSET, bytes: bs58.encode(Uint8Array.from([0])) } },
    ],
  });
  return accounts.map(({ pubkey }) => pubkey.toBase58());
}

export type WalletBalances = {
  sol: number;
  token: bigint | null;
  decimals: number;
  tokenAccountExists: boolean;
};

export async function fetchWalletBalances(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey | null,
): Promise<WalletBalances> {
  const ata = mint ? associatedTokenAddress(owner, mint) : null;
  const [lamports, accounts] = await Promise.all([
    connection.getBalance(owner, COMMITMENT),
    ata && mint ? connection.getMultipleAccountsInfo([ata, mint], COMMITMENT) : Promise.resolve([null, null]),
  ]);
  const [ataInfo, mintInfo] = accounts;
  return {
    sol: lamports / 1_000_000_000,
    token: ata && ataInfo ? decodeTokenAccount(ata.toBase58(), ataInfo.data).amount : mint ? BigInt(0) : null,
    decimals: mint && mintInfo ? decodeMintDecimals(mint.toBase58(), mintInfo.data) : 6,
    tokenAccountExists: Boolean(ataInfo),
  };
}
