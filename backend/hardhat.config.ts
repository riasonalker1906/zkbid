// Minimal hardhat config so `npx hardhat node` boots.
// The backend uses hardhat only as an in-memory EVM; contracts are compiled
// by our own scripts/lib/compile-verifier.ts using solc-js, so we don't
// need any solidity config beyond a stub.
import type { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  solidity: "0.8.28",
};

export default config;
