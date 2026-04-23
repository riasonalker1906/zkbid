import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

// Phase of the auction, from the backend's perspective.
// "open"       accepting encrypted bids
// "closing"    finalization in progress (decrypt + prove)
// "finalized"  finalized; /close returned a proof
// "error"      finalization failed; inspect lastError
export type Phase = "open" | "closing" | "finalized" | "error";

export interface StoredBid {
  slot: number;
  bidderAddress?: string;
  ephemeralPubkey: string; // base64 (32 bytes)
  nonce: string; // base64 (24 bytes)
  ciphertext: string; // base64
  submittedAt: string; // ISO
}

export interface FinalizedResult {
  winnerIndex: number;
  secondPrice: string; // decimal string (u64)
  commitments: string[]; // 0x-prefixed hex, length = numSlots
  publicInputs: string[]; // 0x-prefixed hex, length = numSlots + 2
  proofHex: string; // 0x-prefixed hex bytes
  finalizedAt: string;
}

export interface PersistedState {
  phase: Phase;
  bids: Record<string, StoredBid>; // key: slot (stringified)
  result?: FinalizedResult;
  lastError?: string;
}

const INITIAL_STATE: PersistedState = {
  phase: "open",
  bids: {},
};

function statePath(): string {
  return path.join(config.dataDir, "state.json");
}

function ensureDataDir() {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

let cached: PersistedState | null = null;

export function loadState(): PersistedState {
  if (cached) return cached;
  ensureDataDir();
  const p = statePath();
  if (!fs.existsSync(p)) {
    cached = structuredClone(INITIAL_STATE);
    return cached;
  }
  const raw = fs.readFileSync(p, "utf8");
  cached = JSON.parse(raw) as PersistedState;
  return cached;
}

export function saveState(next: PersistedState): void {
  ensureDataDir();
  cached = next;
  fs.writeFileSync(statePath(), JSON.stringify(next, null, 2));
}

export function resetState(): void {
  cached = structuredClone(INITIAL_STATE);
  saveState(cached);
}

export function listBids(state: PersistedState): StoredBid[] {
  return Object.values(state.bids).sort((a, b) => a.slot - b.slot);
}
