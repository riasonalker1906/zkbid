import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { describe, expect, it } from "vitest";
import { computeBidCommitment, sealBid } from "./crypto";

describe("ZKBid crypto helpers", () => {
  it("matches Noir Poseidon2 commitment vectors", async () => {
    await expect(computeBidCommitment(100n, 1n)).resolves.toBe(
      "0x0b9ad17d3d4fb2312e03a54420f18a745b0fac191ba33336e12dd566ec5a0756",
    );
    await expect(computeBidCommitment(500n, 5n)).resolves.toBe(
      "0x09cbc236f417b4e7b85d6b7d4668c7ddd710f39a519df883b0f322d1d3facb1d",
    );
  });

  it("seals the backend envelope and contract bytes without clear bid fields", () => {
    const auctioneer = nacl.box.keyPair();
    const sealed = sealBid({
      slot: 2,
      bidWei: 123n,
      salt: 456n,
      auctioneerPublicKeyBase64: naclUtil.encodeBase64(auctioneer.publicKey),
      bidderAddress: "0x0000000000000000000000000000000000000001",
    });

    expect(Object.keys(sealed.backendPayload).sort()).toEqual([
      "bidderAddress",
      "ciphertext",
      "ephemeralPubkey",
      "nonce",
      "slot",
    ]);
    expect(sealed.contractPayload.ephemeralPubkey).toMatch(/^0x[0-9a-f]+$/);
    expect(sealed.contractPayload.nonce).toMatch(/^0x[0-9a-f]+$/);
    expect(sealed.contractPayload.ciphertext).toMatch(/^0x[0-9a-f]+$/);

    const plaintext = nacl.box.open(
      naclUtil.decodeBase64(sealed.backendPayload.ciphertext),
      naclUtil.decodeBase64(sealed.backendPayload.nonce),
      naclUtil.decodeBase64(sealed.backendPayload.ephemeralPubkey),
      auctioneer.secretKey,
    );
    expect(plaintext).toBeTruthy();
    expect(JSON.parse(naclUtil.encodeUTF8(plaintext!))).toEqual({
      bid: "123",
      salt: "456",
    });
  });
});
