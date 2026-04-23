import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");

function resolveFromBackend(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(BACKEND_ROOT, p);
}

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const COMMITMENTS_SOURCE = (process.env.COMMITMENTS_SOURCE ?? "mock").toLowerCase();
if (COMMITMENTS_SOURCE !== "mock" && COMMITMENTS_SOURCE !== "ethers") {
  throw new Error(`COMMITMENTS_SOURCE must be "mock" or "ethers", got: ${COMMITMENTS_SOURCE}`);
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  backendRoot: BACKEND_ROOT,
  circuitDir: resolveFromBackend(process.env.CIRCUIT_DIR ?? "../circuit"),
  dataDir: resolveFromBackend(process.env.DATA_DIR ?? "./data"),
  numSlots: Number(process.env.NUM_SLOTS ?? 5),
  allowReset: (process.env.ALLOW_RESET ?? "false").toLowerCase() === "true",

  commitmentsSource: COMMITMENTS_SOURCE as "mock" | "ethers",
  rpcUrl: process.env.RPC_URL ?? "",
  auctionAddress: process.env.AUCTION_ADDRESS ?? "",
} as const;

export function assertEthersConfig(): { rpcUrl: string; auctionAddress: string } {
  return {
    rpcUrl: required("RPC_URL", config.rpcUrl),
    auctionAddress: required("AUCTION_ADDRESS", config.auctionAddress),
  };
}
