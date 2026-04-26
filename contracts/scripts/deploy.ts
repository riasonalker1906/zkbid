import fs from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main() {
  const verifierAddress = required("VERIFIER_ADDRESS");
  const auctioneerAddress = required("AUCTIONEER_ADDRESS");
  const commitDurationSeconds = BigInt(process.env.COMMIT_DURATION_SECONDS ?? "86400");
  const minDepositWei = BigInt(process.env.MIN_DEPOSIT_WEI ?? "0");

  const [deployer] = await ethers.getSigners();
  const AuctionManager = await ethers.getContractFactory("AuctionManager");
  const auction = await AuctionManager.deploy(
    verifierAddress,
    deployer.address,
    auctioneerAddress,
    commitDurationSeconds,
    minDepositWei
  );
  await auction.waitForDeployment();

  const deployment = {
    network: network.name,
    chainId: network.config.chainId ?? null,
    deployer: deployer.address,
    auctionManager: await auction.getAddress(),
    verifier: verifierAddress,
    seller: deployer.address,
    auctioneer: auctioneerAddress,
    commitDurationSeconds: commitDurationSeconds.toString(),
    minDepositWei: minDepositWei.toString(),
    deployedAt: new Date().toISOString()
  };

  const outDir = path.join(process.cwd(), "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `${network.name}.json`),
    JSON.stringify(deployment, null, 2)
  );

  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
