import { getCommitmentsSource, ZERO_BID_COMMITMENT } from "../chain/commitments.js";
import { decryptBid } from "../crypto/decrypt.js";
import { log } from "../util/logger.js";
import { assembleSlots, computeResult } from "./compute.js";
import { generateProof } from "./prove.js";
import { listBids, type FinalizedResult, type PersistedState } from "../state.js";

// Orchestrates the full finalize path: decrypt -> fetch commitments ->
// cross-check -> compute result -> generate proof. Pure with respect to
// state (doesn't mutate); callers persist the returned result.
export async function finalizeAuction(state: PersistedState): Promise<FinalizedResult> {
  const stored = listBids(state);
  if (stored.length === 0) {
    throw new Error("no bids submitted; refusing to finalize an empty auction");
  }

  log.info(`Decrypting ${stored.length} bid(s)...`);
  const decrypted = stored.map(decryptBid);

  const slots = assembleSlots(decrypted);
  const { winnerIndex, secondPrice } = computeResult(slots.bids);
  log.info(
    `Computed result off-chain: winnerIndex=${winnerIndex}, secondPrice=${secondPrice.toString()}`,
  );

  log.info(`Fetching commitments from ${getCommitmentsSource().kind} source...`);
  const commitments = await getCommitmentsSource().fetch();

  // Cross-check: slots we did NOT receive a bid for must be the zero-bid
  // commitment, otherwise the circuit cannot satisfy
  // Poseidon2(0, 0) == commitments[i].
  for (let i = 0; i < commitments.length; i++) {
    if (!slots.submittedSlots.includes(i) && commitments[i] !== ZERO_BID_COMMITMENT) {
      throw new Error(
        `slot ${i} has on-chain commitment ${commitments[i]} but no bid was submitted to the backend. ` +
          `Either a bid is missing, or the empty slot wasn't zero-committed with Poseidon2(0,0) = ${ZERO_BID_COMMITMENT}.`,
      );
    }
  }

  const { proofHex, publicInputs } = await generateProof({
    bids: slots.bids,
    salts: slots.salts,
    commitments,
    winnerIndex,
    secondPrice,
  });

  const result: FinalizedResult = {
    winnerIndex,
    secondPrice: secondPrice.toString(10),
    commitments,
    publicInputs,
    proofHex,
    finalizedAt: new Date().toISOString(),
  };
  return result;
}
