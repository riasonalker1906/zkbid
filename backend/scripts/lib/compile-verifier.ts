import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { InterfaceAbi } from "ethers";

// Compiles circuit/contracts/ZKVerifier.sol.
// The file contains multiple libraries + an IVerifier interface + the
// HonkVerifier contract. The bb-generated verifier uses one `public` library
// (ZKTranscriptLib) whose delegatecalls are NOT inlined -- so callers must
// deploy that library first and then link its address into the HonkVerifier
// creation bytecode before deploying.

export interface CompiledArtifact {
  abi: InterfaceAbi;
  bytecode: string; // 0x-prefixed creation code (may contain link placeholders for main contract)
  deployedBytecode: string; // 0x-prefixed runtime code
  linkReferences: Record<string, Record<string, Array<{ start: number; length: number }>>>;
}

export interface CompiledVerifier {
  verifier: CompiledArtifact;
  libraries: Record<string, CompiledArtifact>; // keyed by library name, e.g. "ZKTranscriptLib"
}

interface SolcInput {
  language: "Solidity";
  sources: Record<string, { content: string }>;
  settings: {
    optimizer: { enabled: boolean; runs: number };
    outputSelection: Record<string, Record<string, string[]>>;
  };
}
interface SolcErrorEntry {
  severity: "error" | "warning";
  formattedMessage: string;
}
interface SolcContractOutput {
  abi: InterfaceAbi;
  evm: {
    bytecode: { object: string; linkReferences: CompiledArtifact["linkReferences"] };
    deployedBytecode: { object: string };
  };
}
interface SolcOutput {
  errors?: SolcErrorEntry[];
  contracts: Record<string, Record<string, SolcContractOutput>>;
}

let cached: CompiledVerifier | null = null;

function toArtifact(c: SolcContractOutput): CompiledArtifact {
  return {
    abi: c.abi,
    bytecode: "0x" + c.evm.bytecode.object,
    deployedBytecode: "0x" + c.evm.deployedBytecode.object,
    linkReferences: c.evm.bytecode.linkReferences ?? {},
  };
}

export function compileVerifier(opts?: { circuitDir?: string }): CompiledVerifier {
  if (cached) return cached;
  const require_ = createRequire(import.meta.url);
  const solc = require_("solc") as { compile: (input: string) => string };

  const circuitDir = opts?.circuitDir ?? path.resolve(process.cwd(), "../circuit");
  const contractPath = path.join(circuitDir, "contracts", "ZKVerifier.sol");
  if (!fs.existsSync(contractPath)) {
    throw new Error(`ZKVerifier.sol not found at ${contractPath}`);
  }
  const source = fs.readFileSync(contractPath, "utf8");

  const input: SolcInput = {
    language: "Solidity",
    sources: { "ZKVerifier.sol": { content: source } },
    settings: {
      // runs=1 optimizes for code size, needed to keep HonkVerifier below
      // the 24,576-byte EIP-170 limit. viaIR is off because the verifier has
      // raw assembly blocks that aren't annotated as memory-safe.
      optimizer: { enabled: true, runs: 1 },
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "evm.bytecode.object",
            "evm.bytecode.linkReferences",
            "evm.deployedBytecode.object",
          ],
        },
      },
    },
  };

  const out = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput;
  const errors = (out.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length > 0) {
    const msg = errors.map((e) => e.formattedMessage).join("\n");
    throw new Error(`solc compilation failed:\n${msg}`);
  }

  const file = out.contracts["ZKVerifier.sol"];
  if (!file || !file["HonkVerifier"]) {
    throw new Error(`HonkVerifier not produced by solc`);
  }
  const verifier = toArtifact(file["HonkVerifier"]!);

  // Collect every entry that solc emitted non-empty bytecode for. Libraries
  // referenced via delegatecall are compiled separately with linkable code;
  // pure-internal libraries and interfaces compile to empty bytecode and
  // can be ignored.
  const libraries: Record<string, CompiledArtifact> = {};
  for (const [name, c] of Object.entries(file)) {
    if (name === "HonkVerifier") continue;
    if (c.evm.bytecode.object.length === 0) continue;
    libraries[name] = toArtifact(c);
  }

  cached = { verifier, libraries };
  return cached;
}

// Replaces every link placeholder for `libraryName` in the creation bytecode
// with the deployed 20-byte address. Works on 0x-prefixed hex strings.
export function linkBytecode(
  bytecodeHex: string,
  linkReferences: CompiledArtifact["linkReferences"],
  libraryAddresses: Record<string, string>,
): string {
  let code = bytecodeHex.startsWith("0x") ? bytecodeHex.slice(2) : bytecodeHex;
  for (const [sourceFile, libs] of Object.entries(linkReferences)) {
    for (const [libName, refs] of Object.entries(libs)) {
      const fqn = `${sourceFile}:${libName}`;
      const addr = libraryAddresses[libName] ?? libraryAddresses[fqn];
      if (!addr) {
        throw new Error(`No address provided for library ${libName} (fqn ${fqn})`);
      }
      const hex20 = addr.toLowerCase().replace(/^0x/, "").padStart(40, "0");
      if (hex20.length !== 40) throw new Error(`Bad address ${addr}`);
      for (const { start, length } of refs) {
        if (length !== 20) throw new Error(`unexpected link length ${length}`);
        // start/length are byte offsets into the binary; *2 for hex chars.
        const hStart = start * 2;
        code = code.slice(0, hStart) + hex20 + code.slice(hStart + 40);
      }
    }
  }
  return "0x" + code;
}
