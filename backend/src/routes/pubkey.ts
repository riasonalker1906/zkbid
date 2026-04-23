import { Router } from "express";
import { config } from "../config.js";
import { getAuctioneerPublicKeyBase64 } from "../crypto/keypair.js";

export const pubkeyRouter = Router();

pubkeyRouter.get("/pubkey", (_req, res) => {
  res.json({
    scheme: "nacl.box",
    curve: "x25519-xsalsa20-poly1305",
    publicKey: getAuctioneerPublicKeyBase64(),
    numSlots: config.numSlots,
    payloadFormat: {
      description:
        "Seal JSON.stringify({ bid, salt }) with nacl.box using an ephemeral keypair and a 24-byte nonce.",
      bid: "decimal string, fits in u64 ([0, 2^64))",
      salt: "decimal string OR 0x-hex, valid BN254 field element",
    },
  });
});
