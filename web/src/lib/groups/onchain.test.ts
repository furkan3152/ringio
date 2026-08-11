import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";

import { decodeGroupAccount, decodeMemberAccount } from "./onchain";

function key(seed: number): PublicKey {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return new PublicKey(bytes);
}

function writeKey(data: Buffer, offset: number, value: PublicKey): void {
  Buffer.from(value.toBytes()).copy(data, offset);
}

test("Group decoder stays synchronized with the Anchor account layout", () => {
  const data = Buffer.alloc(2_387);
  Buffer.from([209, 249, 208, 63, 182, 89, 186, 254]).copy(data, 0);
  writeKey(data, 8, key(1));
  writeKey(data, 40, key(2));
  writeKey(data, 72, key(3));
  writeKey(data, 104, key(4));
  writeKey(data, 168, key(5));
  writeKey(data, 200, key(6));
  writeKey(data, 1_192, key(6));
  writeKey(data, 1_224, key(5));
  data.writeBigUInt64LE(BigInt(100_000_000), 2_224);
  data.writeBigUInt64LE(BigInt(200_000_000), 2_232);
  data.writeBigInt64LE(BigInt(604_800), 2_240);
  data.writeBigInt64LE(BigInt(86_400), 2_248);
  data.writeBigInt64LE(BigInt(1_800_000_000), 2_256);
  data.writeBigInt64LE(BigInt(1_700_000_000), 2_296);
  data.writeBigInt64LE(BigInt(1_700_100_000), 2_320);
  data.writeUInt16LE(2, 2_328);
  data.writeUInt16LE(2, 2_330);
  data.writeUInt16LE(1, 2_336);
  data.writeUInt16LE(1, 2_338);
  data.writeUInt8(3, 2_342);
  data.writeUInt8(7, 2_343);
  data.writeBigUInt64LE(BigInt(11), 2_347);

  const decoded = decodeGroupAccount(key(9), data);
  assert.equal(decoded.creator.toBase58(), key(1).toBase58());
  assert.equal(decoded.mint.toBase58(), key(2).toBase58());
  assert.equal(decoded.members[1].toBase58(), key(6).toBase58());
  assert.equal(decoded.payoutOrder[0].toBase58(), key(6).toBase58());
  assert.equal(decoded.contributionAmount, BigInt(100_000_000));
  assert.equal(decoded.periodSeconds, BigInt(604_800));
  assert.equal(decoded.createdAt, BigInt(1_700_000_000));
  assert.equal(decoded.roundStartedAt, BigInt(1_700_100_000));
  assert.equal(decoded.memberCount, 2);
  assert.equal(decoded.statusIndex, 3);
  assert.equal(decoded.phasePauseSnapshot, BigInt(11));
});

test("Member decoder reads only public state and rejects a wrong discriminator", () => {
  const data = Buffer.alloc(190);
  Buffer.from([54, 19, 162, 21, 29, 166, 17, 198]).copy(data, 0);
  writeKey(data, 8, key(1));
  writeKey(data, 40, key(2));
  data.writeBigUInt64LE(BigInt(300_000_000), 136);
  data.writeUInt16LE(4, 144);
  data.writeUInt16LE(1, 146);
  data.writeUInt16LE(2, 148);
  data.writeUInt16LE(1, 152);
  data.writeUInt8(1, 154);
  data.writeUInt8(1, 155);
  data.writeUInt8(1, 156);

  const decoded = decodeMemberAccount(key(8), data);
  assert.equal(decoded.group, key(1).toBase58());
  assert.equal(decoded.wallet, key(2).toBase58());
  assert.equal(decoded.collateralLockedRaw, "300000000");
  assert.equal(decoded.joinedIndex, 4);
  assert.equal(decoded.payoutRank, 1);
  assert.equal(decoded.lastContributedRound, 2);
  assert.equal(decoded.defaults, 1);
  assert.equal(decoded.revealed, true);
  assert.equal(decoded.collateralPosted, true);
  assert.equal(decoded.payoutReceived, true);

  data[0] = 0;
  assert.throws(() => decodeMemberAccount(key(8), data), /Invalid Member account/);
});
