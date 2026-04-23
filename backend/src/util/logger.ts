function stamp(): string {
  return new Date().toISOString();
}

export const log = {
  info: (msg: string, extra?: Record<string, unknown>) => {
    if (extra) console.log(`[${stamp()}] INFO  ${msg}`, extra);
    else console.log(`[${stamp()}] INFO  ${msg}`);
  },
  warn: (msg: string, extra?: Record<string, unknown>) => {
    if (extra) console.warn(`[${stamp()}] WARN  ${msg}`, extra);
    else console.warn(`[${stamp()}] WARN  ${msg}`);
  },
  error: (msg: string, err?: unknown) => {
    console.error(`[${stamp()}] ERROR ${msg}`, err ?? "");
  },
};
