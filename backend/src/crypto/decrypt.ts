import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { getAuctioneerKeypair } from "./keypair.js";
import type { StoredBid } from "../state.js";

// The plaintext payload a bidder seals with nacl.box.
// Both bid and salt are decimal strings so we don't lose precision for values > 2^53.
export interface BidPayload {
  bid: string; // decimal, fits in u64
  salt: string; // decimal or 0x-hex; interpreted as Field element
}

export interface DecryptedBid {
  slot: number;
  bid: bigint;
  salt: bigint;
  bidderAddress?: string;
}

const MAX_U64 = (1n << 64n) - 1n;
// BN254 scalar field order (matches circuit/ZKVerifier.sol MODULUS).
const BN254_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function parseIntegerString(raw: string, label: string): bigint {
  const s = raw.trim();
  if (s.length === 0) throw new Error(`${label} is empty`);
  try {
    if (s.startsWith("0x") || s.startsWith("0X")) return BigInt(s);
    return BigInt(s);
  } catch {
    throw new Error(`${label} is not a valid integer: ${raw}`);
  }
}

export function decryptBid(bid: StoredBid): DecryptedBid {
  const { secretKey } = getAuctioneerKeypair();

  const ephemeralPubkey = naclUtil.decodeBase64(bid.ephemeralPubkey);
  const nonce = naclUtil.decodeBase64(bid.nonce);
  const ciphertext = naclUtil.decodeBase64(bid.ciphertext);

  if (ephemeralPubkey.length !== nacl.box.publicKeyLength) {
    throw new Error(`slot ${bid.slot}: ephemeralPubkey must be ${nacl.box.publicKeyLength} bytes`);
  }
  if (nonce.length !== nacl.box.nonceLength) {
    throw new Error(`slot ${bid.slot}: nonce must be ${nacl.box.nonceLength} bytes`);
  }

  const plaintext = nacl.box.open(ciphertext, nonce, ephemeralPubkey, secretKey);
  if (!plaintext) {
    throw new Error(`slot ${bid.slot}: decryption failed (bad ciphertext, nonce, or pubkey)`);
  }

  let payload: BidPayload;
  try {
    payload = JSON.parse(naclUtil.encodeUTF8(plaintext)) as BidPayload;
  } catch (e) {
    throw new Error(`slot ${bid.slot}: plaintext is not valid JSON`);
  }
  if (typeof payload.bid !== "string" || typeof payload.salt !== "string") {
    throw new Error(`slot ${bid.slot}: payload must be { bid: string, salt: string }`);
  }

  const bidAmount = parseIntegerString(payload.bid, `slot ${bid.slot} bid`);
  const salt = parseIntegerString(payload.salt, `slot ${bid.slot} salt`);

  if (bidAmount < 0n || bidAmount > MAX_U64) {
    throw new Error(`slot ${bid.slot}: bid must be in [0, 2^64)`);
  }
  if (salt < 0n || salt >= BN254_FIELD) {
    throw new Error(`slot ${bid.slot}: salt must be a valid BN254 field element`);
  }

  return {
    slot: bid.slot,
    bid: bidAmount,
    salt,
    bidderAddress: bid.bidderAddress,
  };
}
