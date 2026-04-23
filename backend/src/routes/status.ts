import { Router } from "express";
import { config } from "../config.js";
import { loadState, resetState } from "../state.js";

export const statusRouter = Router();

statusRouter.get("/status", (_req, res) => {
  const state = loadState();
  res.json({
    phase: state.phase,
    numSlots: config.numSlots,
    submittedSlots: Object.values(state.bids)
      .map((b) => b.slot)
      .sort((a, b) => a - b),
    commitmentsSource: config.commitmentsSource,
    result: state.result ?? null,
    lastError: state.lastError ?? null,
  });
});

statusRouter.post("/reset", (_req, res) => {
  if (!config.allowReset) {
    return res
      .status(403)
      .json({ error: "reset disabled; set ALLOW_RESET=true to enable in dev" });
  }
  resetState();
  res.json({ ok: true, phase: "open" });
});
