import fs from "node:fs";
import path from "node:path";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { config } from "../config.js";
import { log } from "../util/logger.js";

// nacl.box keypair (Curve25519). We only keep this keypair on disk so
// restarts don't rotate the pubkey mid-auction. In production you would
// load this from a secret manager or HSM.

interface KeypairFile {
  publicKey: string; // base64
  secretKey: string; // base64
  createdAt: string;
}

function keypairPath(): string {
  return path.join(config.dataDir, "auctioneer.key.json");
}

function ensureDataDir() {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

let cached: { publicKey: Uint8Array; secretKey: Uint8Array } | null = null;

export function getAuctioneerKeypair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  if (cached) return cached;
  ensureDataDir();
  const p = keypairPath();
  if (fs.existsSync(p)) {
    const f = JSON.parse(fs.readFileSync(p, "utf8")) as KeypairFile;
    cached = {
      publicKey: naclUtil.decodeBase64(f.publicKey),
      secretKey: naclUtil.decodeBase64(f.secretKey),
    };
    return cached;
  }
  const kp = nacl.box.keyPair();
  const file: KeypairFile = {
    publicKey: naclUtil.encodeBase64(kp.publicKey),
    secretKey: naclUtil.encodeBase64(kp.secretKey),
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(p, JSON.stringify(file, null, 2), { mode: 0o600 });
  log.info(`Generated new auctioneer keypair at ${p}`);
  cached = { publicKey: kp.publicKey, secretKey: kp.secretKey };
  return cached;
}

export function getAuctioneerPublicKeyBase64(): string {
  return naclUtil.encodeBase64(getAuctioneerKeypair().publicKey);
}
