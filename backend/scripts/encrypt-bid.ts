#!/usr/bin/env -S npx tsx
/**
 * encrypt-bid.ts
 *
 * Helper for local testing. Takes the auctioneer's nacl public key and the
 * clear (slot, bid, salt) values, then produces a JSON body that can be
 * POSTed directly to /bids.
 *
 * Usage:
 *   npx tsx scripts/encrypt-bid.ts \
 *     --pubkey "<base64-from-/pubkey>" \
 *     --slot 4 --bid 500 --salt 5
 *
 * Optionally --bidder 0x... to attach an address hint.
 * Pipe the output to curl:
 *   npx tsx scripts/encrypt-bid.ts ... | curl -H 'content-type: application/json' \
 *     --data @- http://localhost:8080/bids
 */
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

interface Args {
  pubkey: string;
  slot: number;
  bid: string;
  salt: string;
  bidder?: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const pubkey = get("--pubkey");
  const slot = get("--slot");
  const bid = get("--bid");
  const salt = get("--salt");
  const bidder = get("--bidder");
  if (!pubkey || slot === undefined || bid === undefined || salt === undefined) {
    console.error(
      "Usage: encrypt-bid.ts --pubkey <b64> --slot <n> --bid <uint64> --salt <int> [--bidder 0x...]",
    );
    process.exit(1);
  }
  return { pubkey, slot: Number(slot), bid, salt, bidder };
}

function main() {
  const args = parseArgs();

  const auctioneerPk = naclUtil.decodeBase64(args.pubkey);
  if (auctioneerPk.length !== nacl.box.publicKeyLength) {
    console.error(`pubkey must decode to ${nacl.box.publicKeyLength} bytes`);
    process.exit(1);
  }

  // Sanity-check the bid fits in u64 (same constraint the circuit enforces).
  const b = BigInt(args.bid);
  if (b < 0n || b >= 1n << 64n) {
    console.error(`bid out of range [0, 2^64): ${args.bid}`);
    process.exit(1);
  }

  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const plaintext = naclUtil.decodeUTF8(JSON.stringify({ bid: args.bid, salt: args.salt }));
  const ciphertext = nacl.box(plaintext, nonce, auctioneerPk, ephemeral.secretKey);

  const body: Record<string, unknown> = {
    slot: args.slot,
    ephemeralPubkey: naclUtil.encodeBase64(ephemeral.publicKey),
    nonce: naclUtil.encodeBase64(nonce),
    ciphertext: naclUtil.encodeBase64(ciphertext),
  };
  if (args.bidder) body.bidderAddress = args.bidder;

  process.stdout.write(JSON.stringify(body) + "\n");
}

main();
