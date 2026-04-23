import { Router } from "express";
import { finalizeAuction } from "../auction/finalize.js";
import { loadState, saveState } from "../state.js";
import { log } from "../util/logger.js";

export const closeRouter = Router();

// Finalizes the auction: decrypts all stored bids, pulls commitments from the
// configured source, runs the prover, and returns proof + public inputs.
// Submitting to the contract is intentionally NOT done here (Person 1's work).
closeRouter.post("/close", async (_req, res) => {
  const state = loadState();

  if (state.phase === "closing") {
    return res.status(409).json({ error: "auction is already closing" });
  }
  if (state.phase === "finalized" && state.result) {
    return res.json({ alreadyFinalized: true, result: state.result });
  }

  state.phase = "closing";
  delete state.lastError;
  saveState(state);

  try {
    const result = await finalizeAuction(state);
    state.phase = "finalized";
    state.result = result;
    saveState(state);

    log.info(
      `Auction finalized: winnerIndex=${result.winnerIndex}, secondPrice=${result.secondPrice}`,
    );

    return res.json({
      ok: true,
      winnerIndex: result.winnerIndex,
      secondPrice: result.secondPrice,
      commitments: result.commitments,
      publicInputs: result.publicInputs,
      proof: result.proofHex,
      finalizedAt: result.finalizedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Finalization failed", err);
    state.phase = "error";
    state.lastError = msg;
    saveState(state);
    return res.status(500).json({ error: "finalization failed", message: msg });
  }
});
