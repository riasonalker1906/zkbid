#!/usr/bin/env -S npx tsx
// Smoke test: encrypt a bid with the helper pattern, then decrypt with the
// backend's decryptBid() to verify both halves agree.
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { getAuctioneerKeypair } from "../src/crypto/keypair.js";
import { decryptBid } from "../src/crypto/decrypt.js";

const { publicKey } = getAuctioneerKeypair();

const bid = "500";
const salt = "5";
const ephemeral = nacl.box.keyPair();
const nonce = nacl.randomBytes(nacl.box.nonceLength);
const plaintext = naclUtil.decodeUTF8(JSON.stringify({ bid, salt }));
const ciphertext = nacl.box(plaintext, nonce, publicKey, ephemeral.secretKey);

const stored = {
  slot: 4,
  ephemeralPubkey: naclUtil.encodeBase64(ephemeral.publicKey),
  nonce: naclUtil.encodeBase64(nonce),
  ciphertext: naclUtil.encodeBase64(ciphertext),
  submittedAt: new Date().toISOString(),
};

const d = decryptBid(stored);
console.log("decrypted:", { slot: d.slot, bid: d.bid.toString(), salt: d.salt.toString() });
if (d.bid !== 500n || d.salt !== 5n || d.slot !== 4) {
  console.error("MISMATCH");
  process.exit(1);
}
console.log("ok");
