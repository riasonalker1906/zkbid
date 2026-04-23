#!/usr/bin/env -S npx tsx
/**
 * deploy-verifier.ts
 *
 * Compiles circuit/contracts/ZKVerifier.sol, deploys its linkable libraries,
 * links them into HonkVerifier, and deploys HonkVerifier to the chain at
 * $RPC_URL using $PRIVATE_KEY. The deployed address is written to
 * $DATA_DIR/verifier-address.json so scripts/verify-onchain.ts can pick it
 * up automatically.
 *
 * Usage:
 *   RPC_URL=http://127.0.0.1:8545 PRIVATE_KEY=0xac097... \
 *     npx tsx scripts/deploy-verifier.ts
 *
 * Works against:
 *   - a local anvil / hardhat node (free, instant)
 *   - Sepolia or any other public EVM chain (needs a funded account)
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { deployVerifier } from "./lib/deploy-helpers.js";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

async function main() {
  const rpcUrl = env("RPC_URL");
  const privateKey = env("PRIVATE_KEY");

  const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");
  fs.mkdirSync(dataDir, { recursive: true });

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const network = await provider.getNetwork();
  const balance = await provider.getBalance(wallet.address);
  console.log(
    `[deploy] chain=${network.chainId} deployer=${wallet.address} balance=${ethers.formatEther(balance)} ETH`,
  );
  if (balance === 0n) {
    throw new Error(`deployer ${wallet.address} has zero balance on chainId=${network.chainId}`);
  }

  const result = await deployVerifier({
    signer: wallet,
    onLibraryDeployed: (name, address) => {
      console.log(`[deploy] library ${name} -> ${address}`);
    },
    onVerifierDeploying: (size) => {
      console.log(`[deploy] HonkVerifier creation bytecode: ${(size / 1024).toFixed(1)} KiB`);
    },
  });

  console.log(`[deploy] HonkVerifier @ ${result.verifierAddress} (tx ${result.verifierTxHash ?? "?"})`);

  const record = {
    address: result.verifierAddress,
    libraries: result.libraryAddresses,
    chainId: Number(network.chainId),
    rpcUrl,
    deployedAt: new Date().toISOString(),
    deployer: wallet.address,
    txHash: result.verifierTxHash,
  };
  const out = path.join(dataDir, "verifier-address.json");
  fs.writeFileSync(out, JSON.stringify(record, null, 2));
  console.log(`[deploy] wrote ${out}`);
}

main().catch((err) => {
  console.error("[deploy] FAILED:", err);
  process.exit(1);
});
