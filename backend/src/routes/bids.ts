import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { loadState, saveState, type StoredBid } from "../state.js";
import { log } from "../util/logger.js";

export const bidsRouter = Router();

const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;

const bidBody = z.object({
  slot: z.number().int().min(0).max(config.numSlots - 1),
  bidderAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  ephemeralPubkey: z.string().regex(base64Regex),
  nonce: z.string().regex(base64Regex),
  ciphertext: z.string().regex(base64Regex),
});

bidsRouter.post("/bids", (req, res) => {
  const parsed = bidBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid body", details: parsed.error.flatten() });
  }
  const body = parsed.data;

  const state = loadState();
  if (state.phase !== "open") {
    return res
      .status(409)
      .json({ error: `auction is not open (phase=${state.phase}); submission rejected` });
  }

  const key = String(body.slot);
  const existing = state.bids[key];
  if (existing) {
    return res
      .status(409)
      .json({ error: `slot ${body.slot} already has a bid from ${existing.submittedAt}` });
  }

  const record: StoredBid = {
    slot: body.slot,
    bidderAddress: body.bidderAddress,
    ephemeralPubkey: body.ephemeralPubkey,
    nonce: body.nonce,
    ciphertext: body.ciphertext,
    submittedAt: new Date().toISOString(),
  };
  state.bids[key] = record;
  saveState(state);
  log.info(`Stored bid for slot ${body.slot}`);

  res.status(201).json({
    ok: true,
    slot: body.slot,
    submittedAt: record.submittedAt,
    totalBids: Object.keys(state.bids).length,
  });
});

bidsRouter.get("/bids", (_req, res) => {
  const state = loadState();
  const bids = Object.values(state.bids)
    .sort((a, b) => a.slot - b.slot)
    .map((b) => ({ slot: b.slot, submittedAt: b.submittedAt, bidderAddress: b.bidderAddress }));
  res.json({ phase: state.phase, bids });
});
