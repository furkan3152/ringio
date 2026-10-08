import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";

import { decodeGroup, decodeInvite, decodeMember } from "./accounts";

function key(seed: number): PublicKey {
  return new PublicKey(new Uint8Array(32).fill(seed));
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
  data.writeBigUInt64LE(BigInt(42), 2_216);
  data.writeBigUInt64LE(BigInt(100_000_000), 2_224);
  data.writeBigUInt64LE(BigInt(200_000_000), 2_232);
  data.writeBigInt64LE(BigInt(604_800), 2_240);
  data.writeBigInt64LE(BigInt(86_400), 2_248);
  data.writeBigInt64LE(BigInt(1_800_000_000), 2_256);
  data.writeBigInt64LE(BigInt(1_700_000_000), 2_296);
  data.writeBigInt64LE(BigInt(1_700_100_000), 2_320);
  data.writeUInt16LE(2, 2_328);
  data.writeUInt16LE(2, 2_330);
  data.writeUInt16LE(2, 2_332);
  data.writeUInt16LE(1, 2_336);
  data.writeUInt16LE(1, 2_338);
  data.writeUInt16LE(0xffff, 2_340);
  data.writeUInt8(3, 2_342);
  data.writeBigUInt64LE(BigInt(11), 2_347);

  const decoded = decodeGroup("G", data);
  assert.equal(decoded.creator, key(1).toBase58());
  assert.equal(decoded.mint, key(2).toBase58());
  assert.equal(decoded.potVault, key(3).toBase58());
  assert.deepEqual(decoded.members, [key(5).toBase58(), key(6).toBase58()]);
  assert.deepEqual(decoded.payoutOrder, [key(6).toBase58(), key(5).toBase58()]);
  assert.equal(decoded.id, BigInt(42));
  assert.equal(decoded.contributionAmount, BigInt(100_000_000));
  assert.equal(decoded.periodSeconds, 604_800);
  assert.equal(decoded.joinDeadline, 1_800_000_000);
  assert.equal(decoded.createdAt, 1_700_000_000);
  assert.equal(decoded.roundStartedAt, 1_700_100_000);
  assert.equal(decoded.memberCount, 2);
  assert.equal(decoded.revealedCount, 2);
  assert.equal(decoded.currentRound, 1);
  assert.equal(decoded.failedRound, 0xffff);
  assert.equal(decoded.status, "active");
  assert.equal(decoded.phasePauseSnapshot, BigInt(11));
});

test("Group decoder hides an unfinalized payout order and truncates to joined members", () => {
  const data = Buffer.alloc(2_387);
  Buffer.from([209, 249, 208, 63, 182, 89, 186, 254]).copy(data, 0);
  writeKey(data, 168, key(5));
  data.writeUInt16LE(4, 2_328);
  data.writeUInt16LE(1, 2_330);
  const decoded = decodeGroup("G", data);
  assert.equal(decoded.status, "forming");
  assert.deepEqual(decoded.members, [key(5).toBase58()]);
  assert.deepEqual(decoded.payoutOrder, []);
});

test("Member decoder reads public state and rejects a wrong discriminator", () => {
  const data = Buffer.alloc(190);
  Buffer.from([54, 19, 162, 21, 29, 166, 17, 198]).copy(data, 0);
  writeKey(data, 8, key(1));
  writeKey(data, 40, key(2));
  data.fill(7, 72, 104);
  data.writeBigUInt64LE(BigInt(300_000_000), 136);
  data.writeUInt16LE(4, 144);
  data.writeUInt16LE(1, 146);
  data.writeUInt16LE(2, 148);
  data.writeUInt16LE(1, 152);
  data.writeUInt8(1, 154);
  data.writeUInt8(1, 155);
  data.writeUInt8(1, 156);
  data.writeUInt8(2, 157);

  const decoded = decodeMember("M", data);
  assert.equal(decoded.group, key(1).toBase58());
  assert.equal(decoded.wallet, key(2).toBase58());
  assert.deepEqual([...decoded.commitment], new Array(32).fill(7));
  assert.equal(decoded.collateralLocked, BigInt(300_000_000));
  assert.equal(decoded.joinedIndex, 4);
  assert.equal(decoded.payoutRank, 1);
  assert.equal(decoded.lastContributedRound, 2);
  assert.equal(decoded.defaults, 1);
  assert.equal(decoded.revealed, true);
  assert.equal(decoded.collateralPosted, true);
  assert.equal(decoded.payoutReceived, true);
  assert.equal(decoded.lastResolutionKind, 2);

  data[0] = 0;
  assert.throws(() => decodeMember("M", data), /Invalid Member account/);
});

test("Invite decoder reads group, invitee, and used flag", () => {
  const data = Buffer.alloc(104);
  Buffer.from([230, 17, 253, 74, 50, 78, 85, 101]).copy(data, 0);
  writeKey(data, 8, key(3));
  writeKey(data, 40, key(4));
  data.writeUInt8(1, 72);
  assert.deepEqual(decodeInvite("I", data), { address: "I", group: key(3).toBase58(), invitee: key(4).toBase58(), used: true });
});
