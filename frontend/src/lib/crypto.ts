import { ethers } from "ethers";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { BN254_FIELD, MAX_U64 } from "../config";
import { BackendBidEnvelope, HexString } from "../types";

const POSEIDON2_TWO_FIELD_IV = 2n * (1n << 64n);

export interface SealedBid {
  backendPayload: BackendBidEnvelope;
  contractPayload: {
    ephemeralPubkey: HexString;
    nonce: HexString;
    ciphertext: HexString;
  };
}

export async function computeBidCommitment(bidWei: bigint, salt: bigint): Promise<HexString> {
  assertBidRange(bidWei);
  assertFieldRange(salt, "salt");

  const [{ Fr }, { poseidon2Permutation }] = await Promise.all([
    import("@aztec/foundation/curves/bn254"),
    import("@aztec/foundation/crypto/poseidon"),
  ]);
  const [hash] = await poseidon2Permutation([
    new Fr(bidWei),
    new Fr(salt),
    Fr.ZERO,
    new Fr(POSEIDON2_TWO_FIELD_IV),
  ]);
  return toHex32(hash.toBigInt());
}

export function randomFieldElement(): bigint {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new Error("Secure browser randomness is not available.");
  }

  for (;;) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const value = bytesToBigInt(bytes);
    if (value < BN254_FIELD) return value;
  }
}

export function sealBid(args: {
  slot: number;
  bidWei: bigint;
  salt: bigint;
  auctioneerPublicKeyBase64: string;
  bidderAddress?: string;
}): SealedBid {
  assertBidRange(args.bidWei);
  assertFieldRange(args.salt, "salt");

  const auctioneerPublicKey = naclUtil.decodeBase64(args.auctioneerPublicKeyBase64);
  if (auctioneerPublicKey.length !== nacl.box.publicKeyLength) {
    throw new Error(`Auctioneer public key must be ${nacl.box.publicKeyLength} bytes.`);
  }

  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const plaintext = naclUtil.decodeUTF8(
    JSON.stringify({
      bid: args.bidWei.toString(10),
      salt: args.salt.toString(10),
    }),
  );
  const ciphertext = nacl.box(plaintext, nonce, auctioneerPublicKey, ephemeral.secretKey);

  const backendPayload: BackendBidEnvelope = {
    slot: args.slot,
    bidderAddress: args.bidderAddress,
    ephemeralPubkey: naclUtil.encodeBase64(ephemeral.publicKey),
    nonce: naclUtil.encodeBase64(nonce),
    ciphertext: naclUtil.encodeBase64(ciphertext),
  };

  return {
    backendPayload,
    contractPayload: {
      ephemeralPubkey: bytesToHex(ephemeral.publicKey),
      nonce: bytesToHex(nonce),
      ciphertext: bytesToHex(ciphertext),
    },
  };
}

export function assertBidRange(value: bigint) {
  if (value < 0n || value > MAX_U64) {
    throw new Error("Bid must fit in uint64.");
  }
}

function assertFieldRange(value: bigint, label: string) {
  if (value < 0n || value >= BN254_FIELD) {
    throw new Error(`${label} must be a BN254 field element.`);
  }
}

function bytesToHex(bytes: Uint8Array): HexString {
  return ethers.hexlify(bytes) as HexString;
}

function bytesToBigInt(bytes: Uint8Array) {
  return BigInt(bytesToHex(bytes));
}

function toHex32(value: bigint): HexString {
  return ethers.zeroPadValue(ethers.toBeHex(value), 32) as HexString;
}
