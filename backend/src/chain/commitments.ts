import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { assertEthersConfig, config } from "../config.js";
import { log } from "../util/logger.js";

// -----------------------------------------------------------------------------
// Commitments source
//
// The auctioneer backend reads the on-chain commitments[] array when finalizing
// so that the public inputs it feeds to the circuit are exactly what the
// contract (and verifier) will see. Two adapters are provided:
//
//   1. "ethers" -- calls AuctionManager.getCommitments() on-chain.
//      Expected ABI (Person 1 must implement at least this read call):
//
//          function getCommitments() external view returns (bytes32[] memory);
//
//      Length MUST equal NUM_SLOTS (5). Slots that never received a bid must
//      contain the zero-bid sentinel: Poseidon2(0, 0) =
//        0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1
//
//   2. "mock"  -- reads $DATA_DIR/commitments.json (created by the operator
//      during local dev or e2e tests). Format:
//        { "commitments": ["0x..", "0x..", "0x..", "0x..", "0x.."] }
// -----------------------------------------------------------------------------

// Poseidon2(0, 0) -- used as zero-padded sentinel for empty slots.
export const ZERO_BID_COMMITMENT =
  "0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1";

const AUCTION_ABI = [
  "function getCommitments() external view returns (bytes32[])",
];

export interface CommitmentsSource {
  kind: "mock" | "ethers";
  fetch: () => Promise<string[]>; // 0x-prefixed hex, length === numSlots
}

function normalizeHex32(hex: string, ctx: string): string {
  if (!hex.startsWith("0x") && !hex.startsWith("0X")) {
    throw new Error(`${ctx}: expected 0x-prefixed hex, got ${hex}`);
  }
  const lower = "0x" + hex.slice(2).toLowerCase();
  if (lower.length !== 66) {
    throw new Error(`${ctx}: expected 32-byte hex (66 chars incl 0x), got length ${lower.length}`);
  }
  if (!/^0x[0-9a-f]{64}$/.test(lower)) {
    throw new Error(`${ctx}: contains non-hex characters`);
  }
  return lower;
}

function mockSource(): CommitmentsSource {
  const file = path.join(config.dataDir, "commitments.json");
  return {
    kind: "mock",
    fetch: async () => {
      if (!fs.existsSync(file)) {
        throw new Error(
          `mock commitments source: ${file} not found. Create it as { "commitments": ["0x..", ...] } with ${config.numSlots} entries. ` +
            `Use ZERO_BID_COMMITMENT for empty slots.`,
        );
      }
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { commitments?: unknown };
      if (!Array.isArray(raw.commitments)) {
        throw new Error(`${file}: "commitments" must be an array`);
      }
      if (raw.commitments.length !== config.numSlots) {
        throw new Error(
          `${file}: expected ${config.numSlots} commitments, got ${raw.commitments.length}`,
        );
      }
      return raw.commitments.map((c, i) => {
        if (typeof c !== "string") throw new Error(`${file}: commitments[${i}] not a string`);
        return normalizeHex32(c, `${file} commitments[${i}]`);
      });
    },
  };
}

function ethersSource(): CommitmentsSource {
  const { rpcUrl, auctionAddress } = assertEthersConfig();
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(auctionAddress, AUCTION_ABI, provider);
  return {
    kind: "ethers",
    fetch: async () => {
      const getCommitments = contract.getFunction("getCommitments");
      const raw = (await getCommitments()) as string[];
      if (!Array.isArray(raw) || raw.length !== config.numSlots) {
        throw new Error(
          `getCommitments() returned ${Array.isArray(raw) ? raw.length : "non-array"}, expected ${config.numSlots}`,
        );
      }
      return raw.map((h, i) => normalizeHex32(h, `getCommitments()[${i}]`));
    },
  };
}

let cached: CommitmentsSource | null = null;
export function getCommitmentsSource(): CommitmentsSource {
  if (cached) return cached;
  if (config.commitmentsSource === "mock") {
    log.info("Commitments source: mock (file-backed)");
    cached = mockSource();
  } else {
    log.info("Commitments source: ethers (on-chain)");
    cached = ethersSource();
  }
  return cached;
}
