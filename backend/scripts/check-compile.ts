#!/usr/bin/env -S npx tsx
// Sanity-check that solc can compile the verifier, link it against the
// detected libraries, and produce a runtime-bytecode that fits under the
// 24,576-byte EIP-170 limit.
import { compileVerifier, linkBytecode } from "./lib/compile-verifier.js";

const t0 = Date.now();
const { verifier, libraries } = compileVerifier();
const dt = Date.now() - t0;

const runtimeKb = ((verifier.deployedBytecode.length - 2) / 2) / 1024;
const runtimeBytes = (verifier.deployedBytecode.length - 2) / 2;
const libNames = Object.keys(libraries);

console.log(`compiled in ${dt}ms`);
console.log(`HonkVerifier: runtime=${runtimeKb.toFixed(1)} KiB (${runtimeBytes} bytes)`);
console.log(`Libraries to deploy (${libNames.length}): ${libNames.join(", ") || "<none>"}`);
for (const [name, art] of Object.entries(libraries)) {
  const lrk = ((art.deployedBytecode.length - 2) / 2) / 1024;
  console.log(`  ${name}: runtime=${lrk.toFixed(1)} KiB`);
}

// Verify linking with dummy addresses works.
const dummyAddrs: Record<string, string> = {};
for (const name of libNames) {
  dummyAddrs[name] = "0x" + "11".repeat(20);
}
const linked = linkBytecode(verifier.bytecode, verifier.linkReferences, dummyAddrs);
if (linked.includes("__$") || linked.includes("__")) {
  // "__" appears in real bytecode too, but the specific "__$...$__" placeholder must be gone.
  if (/__\$[0-9a-f]{34}\$__/i.test(linked)) {
    console.error("linking failed: placeholder still present in bytecode");
    process.exit(1);
  }
}

if (runtimeBytes > 24576) {
  console.error(`runtime bytecode exceeds 24576-byte EIP-170 limit (got ${runtimeBytes})`);
  process.exit(1);
}
console.log("ok");
