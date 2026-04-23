#!/usr/bin/env -S npx tsx
/**
 * onchain.ts
 *
 * End-to-end: runs ALL canonical scenarios through the backend (producing real
 * proofs via nargo + bb), spins up a `hardhat node` subprocess as a disposable
 * EVM, deploys HonkVerifier + its libraries, and calls verify(proof,
 * publicInputs) for each scenario. Asserts the on-chain verifier returns true.
 *
 * Hardhat's EDR-backed node matches mainnet/Sepolia EVM semantics, so a pass
 * here is a strong signal the same artifacts will verify on Sepolia.
 *
 * Prereqs: nargo + bb + hardhat on PATH (hardhat is a devDependency).
 * Run:     npm run test:onchain
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AddressInfo } from "node:net";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { ethers } from "ethers";
import { SCENARIOS, type Scenario } from "./scenarios.js";
import { deployVerifier } from "../scripts/lib/deploy-helpers.js";

// Isolated DATA_DIR for the backend.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "zkbid-onchain-"));
process.env.DATA_DIR = workDir;
process.env.NUM_SLOTS = "5";
process.env.COMMITMENTS_SOURCE = "mock";
process.env.ALLOW_RESET = "true";
process.env.PORT = "0";

// First well-known hardhat account (deterministic; only used for this local node).
const HARDHAT_ACCOUNT_0_PK =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

interface ProofArtifacts {
  proofHex: string;
  publicInputs: string[];
  winnerIndex: number;
  secondPrice: string;
}

function encryptBid(pubB64: string, slot: number, bid: string, salt: string) {
  const pk = naclUtil.decodeBase64(pubB64);
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

async function produceProofs(): Promise<Record<string, ProofArtifacts>> {
  const { buildServer } = await import("../src/server.js");
  const app = buildServer();
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  const results: Record<string, ProofArtifacts> = {};
  try {
    for (const s of SCENARIOS) {
      console.log(`[produce] scenario ${s.name}`);
      await fetch(`${base}/reset`, { method: "POST" });
      fs.writeFileSync(
        path.join(workDir, "commitments.json"),
        JSON.stringify({ commitments: s.commitments }, null, 2),
      );
      const pub = (await (await fetch(`${base}/pubkey`)).json()) as { publicKey: string };
      const slots = s.submittedSlots ?? [0, 1, 2, 3, 4];
      for (const i of slots) {
        const body = encryptBid(pub.publicKey, i, s.bids[i]!, s.salts[i]!);
        const r = await fetch(`${base}/bids`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`bid post failed: ${await r.text()}`);
      }
      const closeRes = await fetch(`${base}/close`, { method: "POST" });
      if (!closeRes.ok) throw new Error(`close failed: ${await closeRes.text()}`);
      const cb = (await closeRes.json()) as {
        proof: string;
        publicInputs: string[];
        winnerIndex: number;
        secondPrice: string;
      };
      results[s.name] = {
        proofHex: cb.proof,
        publicInputs: cb.publicInputs,
        winnerIndex: cb.winnerIndex,
        secondPrice: cb.secondPrice,
      };
    }
  } finally {
    server.close();
  }
  return results;
}

// Finds a free TCP port by briefly binding to :0.
async function pickPort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

interface HardhatProc {
  child: ChildProcess;
  rpcUrl: string;
}

async function startHardhatNode(): Promise<HardhatProc> {
  const port = await pickPort();
  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const child = spawn("npx", ["hardhat", "node", "--port", String(port)], {
    cwd: backendRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
    shell: true,
  });
  const rpcUrl = `http://127.0.0.1:${port}`;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("hardhat node did not start within 20s"));
    }, 20000);
    const onData = (buf: Buffer) => {
      const s = buf.toString();
      if (s.includes("Started HTTP and WebSocket JSON-RPC server")) {
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", (b) => process.stderr.write(`[hh:err] ${b}`));
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`hardhat node exited early with code ${code}`));
    });
  });

  return { child, rpcUrl };
}

async function main() {
  console.log(`[onchain] workDir = ${workDir}`);

  console.log(`[onchain] producing proofs for ${SCENARIOS.length} scenarios...`);
  const proofs = await produceProofs();

  console.log(`[onchain] starting hardhat node...`);
  const node = await startHardhatNode();
  console.log(`[onchain] hardhat node listening at ${node.rpcUrl}`);

  try {
    const provider = new ethers.JsonRpcProvider(node.rpcUrl);
    const wallet = new ethers.Wallet(HARDHAT_ACCOUNT_0_PK, provider);

    console.log(`[onchain] compiling + deploying HonkVerifier...`);
    const deployResult = await deployVerifier({
      signer: wallet,
      onLibraryDeployed: (name, addr) => console.log(`[onchain]   library ${name} @ ${addr}`),
      onVerifierDeploying: (size) =>
        console.log(`[onchain]   HonkVerifier bytecode: ${(size / 1024).toFixed(1)} KiB`),
    });
    const address = deployResult.verifierAddress;
    console.log(`[onchain] HonkVerifier @ ${address}`);

    const iface = new ethers.Interface([
      "function verify(bytes _proof, bytes32[] _publicInputs) external view returns (bool)",
    ]);

    let pass = 0;
    for (const [name, art] of Object.entries(proofs)) {
      try {
        const data = iface.encodeFunctionData("verify", [art.proofHex, art.publicInputs]);
        // No explicit gasLimit: hardhat caps eth_call gas and defaults work for this verifier.
        const raw = await provider.call({ to: address, data });
        const decoded = iface.decodeFunctionResult("verify", raw) as unknown as [boolean];
        const ok = decoded[0];
        if (ok !== true) {
          console.log(`  FAIL  ${name} -- verify returned ${ok}`);
        } else {
          console.log(
            `  ok    ${name}  winner=${art.winnerIndex} secondPrice=${art.secondPrice} -- verifier returned true`,
          );
          pass++;
        }
      } catch (err) {
        console.log(`  FAIL  ${name} -- revert: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    console.log(`\n[onchain] ${pass}/${SCENARIOS.length} scenarios verified on-chain`);
    if (pass !== SCENARIOS.length) process.exit(1);
    console.log(`[onchain] ALL CHECKS PASSED`);
  } finally {
    node.child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 250));
    if (!node.child.killed) node.child.kill("SIGKILL");
  }
}

main().catch((err) => {
  console.error("\n[onchain] FAILED:", err);
  process.exit(1);
});
