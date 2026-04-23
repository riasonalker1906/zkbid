import { config } from "../config.js";
import type { DecryptedBid } from "../crypto/decrypt.js";

export interface SlotAssignment {
  // Length == numSlots. Missing slots default to { bid: 0n, salt: 0n }.
  bids: bigint[];
  salts: bigint[];
  // Indices (same order as bids) whose bid was actually submitted.
  submittedSlots: number[];
}

export interface AuctionResult {
  winnerIndex: number;
  secondPrice: bigint;
}

// Zero-pad decrypted bids into the fixed NUM_SLOTS arrays the circuit expects.
export function assembleSlots(decrypted: DecryptedBid[]): SlotAssignment {
  const bids = new Array<bigint>(config.numSlots).fill(0n);
  const salts = new Array<bigint>(config.numSlots).fill(0n);
  const submittedSlots: number[] = [];
  for (const d of decrypted) {
    if (d.slot < 0 || d.slot >= config.numSlots) {
      throw new Error(`slot ${d.slot} out of range [0, ${config.numSlots})`);
    }
    if (submittedSlots.includes(d.slot)) {
      throw new Error(`duplicate bid for slot ${d.slot}`);
    }
    bids[d.slot] = d.bid;
    salts[d.slot] = d.salt;
    submittedSlots.push(d.slot);
  }
  return { bids, salts, submittedSlots };
}

// Winner = slot with the highest bid; on ties, lowest index wins.
// Matches the circuit's constraints in circuit/src/main.nr exactly.
export function computeResult(bids: bigint[]): AuctionResult {
  if (bids.length === 0) throw new Error("no bids");

  let winnerIndex = 0;
  for (let i = 1; i < bids.length; i++) {
    const cur = bids[i]!;
    const best = bids[winnerIndex]!;
    // strictly greater beats current winner; equal does NOT (lowest index wins)
    if (cur > best) winnerIndex = i;
  }

  let secondPrice = 0n;
  for (let i = 0; i < bids.length; i++) {
    if (i === winnerIndex) continue;
    const b = bids[i]!;
    if (b > secondPrice) secondPrice = b;
  }

  return { winnerIndex, secondPrice };
}
