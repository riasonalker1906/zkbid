#!/usr/bin/env -S npx tsx
/**
 * verify-onchain.ts
 *
 * Calls HonkVerifier.verify(proof, publicInputs) against a deployed verifier
 * contract and prints the result.
 *
 * Source of proof + publicInputs (in order of priority):
 *   1. --run <dir>        a directory produced by POST /close
 *                         (expects run/proof/proof and run/proof/public_inputs)
 *   2. --state            read backend state.json last finalized result
 *   3. --proof / --public flags (both 0x-hex)
 *
 * The verifier address is read from $VERIFIER_ADDRESS, or from
 * $DATA_DIR/verifier-address.json written by deploy-verifier.ts.
 *
 * This is a `view` call -- no gas is spent, no tx is sent.
 *
 * Usage:
 *   RPC_URL=http://127.0.0.1:8545 \
 *     npx tsx scripts/verify-onchain.ts --state
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

interface VerifierRecord {
  address: string;
  chainId?: number;
}
interface StateRecord {
  result?: { proofHex: string; publicInputs: string[] };
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function readBinaryAsHex(p: string): string {
  return "0x" + fs.readFileSync(p).toString("hex");
}
function splitPublicInputsFile(p: string): string[] {
  const buf = fs.readFileSync(p);
  if (buf.length % 32 !== 0) throw new Error(`public_inputs file ${p} not 32-aligned`);
  const out: string[] = [];
  for (let i = 0; i < buf.length; i += 32) out.push("0x" + buf.subarray(i, i + 32).toString("hex"));
  return out;
}

function loadProofAndInputs(): { proof: string; publicInputs: string[] } {
  const runDir = arg("--run");
  if (runDir) {
    const proofPath = path.join(runDir, "proof", "proof");
    const piPath = path.join(runDir, "proof", "public_inputs");
    if (!fs.existsSync(proofPath) || !fs.existsSync(piPath)) {
      throw new Error(`--run ${runDir}: missing proof/ or public_inputs/`);
    }
    return { proof: readBinaryAsHex(proofPath), publicInputs: splitPublicInputsFile(piPath) };
  }

  if (process.argv.includes("--state")) {
    const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");
    const statePath = path.join(dataDir, "state.json");
    if (!fs.existsSync(statePath)) throw new Error(`state file not found: ${statePath}`);
    const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as StateRecord;
    if (!state.result) throw new Error(`state.json has no finalized result`);
    return { proof: state.result.proofHex, publicInputs: state.result.publicInputs };
  }

  const p = arg("--proof");
  const pubFlag = arg("--public");
  if (p && pubFlag) {
    const publicInputs = pubFlag.split(",").map((s) => s.trim());
    return { proof: p.startsWith("0x") ? p : "0x" + p, publicInputs };
  }

  throw new Error(
    "provide one of: --run <dir>, --state, or --proof 0x... --public 0x..,0x..",
  );
}

function loadVerifierAddress(): string {
  const fromEnv = process.env.VERIFIER_ADDRESS;
  if (fromEnv) return fromEnv;
  const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");
  const p = path.join(dataDir, "verifier-address.json");
  if (!fs.existsSync(p)) {
    throw new Error(`no VERIFIER_ADDRESS env and ${p} not found; run deploy-verifier.ts first`);
  }
  const rec = JSON.parse(fs.readFileSync(p, "utf8")) as VerifierRecord;
  return rec.address;
}

const ABI = ["function verify(bytes _proof, bytes32[] _publicInputs) external view returns (bool)"];

async function main() {
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL is required");
  const verifierAddress = loadVerifierAddress();
  const { proof, publicInputs } = loadProofAndInputs();

  console.log(`[verify] rpc=${rpcUrl}`);
  console.log(`[verify] verifier=${verifierAddress}`);
  console.log(`[verify] proof length=${(proof.length - 2) / 2} bytes`);
  console.log(`[verify] publicInputs: ${publicInputs.length} entries`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(verifierAddress, ABI, provider);

  try {
    const verifyFn = contract.getFunction("verify");
    const ok = (await verifyFn.staticCall(proof, publicInputs)) as boolean;
    if (ok) {
      console.log(`[verify] RESULT: true -- on-chain verifier accepted the proof`);
    } else {
      console.log(`[verify] RESULT: false -- verifier returned false`);
      process.exit(2);
    }
  } catch (err) {
    // Honk verifier throws custom errors (SumcheckFailed, ShpleminiFailed, etc)
    // instead of returning false for some failure modes.
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[verify] RESULT: revert -- ${msg}`);
    process.exit(3);
  }
}

main().catch((err) => {
  console.error("[verify] FAILED:", err);
  process.exit(1);
});
