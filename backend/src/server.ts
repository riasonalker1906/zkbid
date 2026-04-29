import express from "express";
import { config } from "./config.js";
import { bidsRouter } from "./routes/bids.js";
import { closeRouter } from "./routes/close.js";
import { pubkeyRouter } from "./routes/pubkey.js";
import { statusRouter } from "./routes/status.js";
import { log } from "./util/logger.js";

export function buildServer() {
  const app = express();
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    return next();
  });
  app.use(express.json({ limit: "256kb" }));

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  app.use(pubkeyRouter);
  app.use(bidsRouter);
  app.use(closeRouter);
  app.use(statusRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error("unhandled error", err);
    const msg = err instanceof Error ? err.message : "internal error";
    res.status(500).json({ error: msg });
  });

  return app;
}

export function start() {
  const app = buildServer();
  app.listen(config.port, () => {
    log.info(`zkbid auctioneer backend listening on :${config.port}`);
    log.info(`  circuitDir=${config.circuitDir}`);
    log.info(`  dataDir=${config.dataDir}`);
    log.info(`  commitmentsSource=${config.commitmentsSource}`);
  });
}
