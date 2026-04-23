#!/usr/bin/env -S npx tsx
/**
 * End-to-end test for the auctioneer backend. Drives the full pipeline
 * (/bids -> /close -> nargo execute -> bb prove) for every canonical
 * scenario in test/scenarios.ts.
 *
 * Prereqs: nargo + bb on PATH.
 * Run:     npm run test:e2e
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AddressInfo } from "node:net";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { SCENARIOS, type Scenario } from "./scenarios.js";

// Set env BEFORE importing anything from src/ so config.ts picks it up.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "zkbid-e2e-"));
process.env.DATA_DIR = workDir;
process.env.NUM_SLOTS = "5";
process.env.COMMITMENTS_SOURCE = "mock";
process.env.ALLOW_RESET = "true";
process.env.PORT = "0";

type CloseResponse = {
  ok?: boolean;
  alreadyFinalized?: boolean;
  winnerIndex?: number;
  secondPrice?: string;
  commitments?: string[];
  publicInputs?: string[];
  proof?: string;
  error?: string;
  message?: string;
};

function encryptBid(
  auctioneerPubkeyB64: string,
  slot: number,
  bid: string,
  salt: string,
): Record<string, unknown> {
  const pk = naclUtil.decodeBase64(auctioneerPubkeyB64);
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const plaintext = naclUtil.decodeUTF8(JSON.stringify({ bid, salt }));
  const ciphertext = nacl.box(plaintext, nonce, pk, ephemeral.secretKey);
  return {
    slot,
    ephemeralPubkey: naclUtil.encodeBase64(ephemeral.publicKey),
    nonce: naclUtil.encodeBase64(nonce),
    ciphertext: naclUtil.encodeBase64(ciphertext),
  };
}

function assertEq<T>(label: string, actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(
      `assert failed [${label}]: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
  console.log(`    ok  ${label} = ${String(actual)}`);
}

async function runScenario(base: string, s: Scenario): Promise<CloseResponse> {
  console.log(`\n[e2e] >>> scenario: ${s.name}`);

  // Reset state (allowed because ALLOW_RESET=true).
  const reset = await fetch(`${base}/reset`, { method: "POST" });
  if (!reset.ok) throw new Error(`reset failed: ${reset.status}`);

  // Seed commitments.json for this scenario.
  fs.writeFileSync(
    path.join(workDir, "commitments.json"),
    JSON.stringify({ commitments: s.commitments }, null, 2),
  );

  // Fetch pubkey.
  const pubkeyRes = await fetch(`${base}/pubkey`);
  const pubkey = (await pubkeyRes.json()) as { publicKey: string };

  // Submit only the requested slots (default: all 5).
  const slotsToSubmit = s.submittedSlots ?? [0, 1, 2, 3, 4];
  for (const i of slotsToSubmit) {
    const body = encryptBid(pubkey.publicKey, i, s.bids[i]!, s.salts[i]!);
    const r = await fetch(`${base}/bids`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`POST /bids[${i}] failed: ${r.status} ${await r.text()}`);
  }
  console.log(`    submitted ${slotsToSubmit.length} bid(s)`);

  // Finalize.
  const closeRes = await fetch(`${base}/close`, { method: "POST" });
  const body = (await closeRes.json()) as CloseResponse;
  if (!closeRes.ok) {
    throw new Error(
      `/close failed (${closeRes.status}): ${body.error ?? ""} ${body.message ?? ""}`,
    );
  }

  assertEq("ok", body.ok, true);
  assertEq("winnerIndex", body.winnerIndex, s.winnerIndex);
  assertEq("secondPrice", body.secondPrice, s.secondPrice);
  assertEq("publicInputs.length", body.publicInputs?.length, 7);
  if (!body.proof || !body.proof.startsWith("0x") || body.proof.length < 200) {
    throw new Error(`proof looks invalid (length=${body.proof?.length})`);
  }
  console.log(`    ok  proof.length = ${body.proof.length} hex chars`);
  return body;
}

async function main() {
  console.log(`[e2e] workDir = ${workDir}`);

  const { buildServer } = await import("../src/server.js");
  const app = buildServer();
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${addr.port}`;
  console.log(`[e2e] server listening at ${base}`);

  const results: Record<string, CloseResponse> = {};
  try {
    for (const scenario of SCENARIOS) {
      results[scenario.name] = await runScenario(base, scenario);
    }

    // Persist the produced proofs so that a follow-up script (e.g.,
    // scripts/verify-onchain.ts) can replay them against a deployed
    // verifier without re-running the prover.
    const dump = path.join(workDir, "e2e-results.json");
    fs.writeFileSync(dump, JSON.stringify(results, null, 2));
    console.log(`\n[e2e] ALL ${SCENARIOS.length} SCENARIOS PASSED`);
    console.log(`[e2e] results dumped to ${dump}`);
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error("\n[e2e] FAILED:", err);
  process.exit(1);
});
