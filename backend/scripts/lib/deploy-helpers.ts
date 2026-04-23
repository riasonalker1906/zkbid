import { ethers } from "ethers";
import { compileVerifier, linkBytecode } from "./compile-verifier.js";

export interface DeployOptions {
  signer: ethers.Signer;
  onLibraryDeployed?: (name: string, address: string) => void;
  onVerifierDeploying?: (sizeBytes: number) => void;
}

export interface DeployResult {
  verifierAddress: string;
  libraryAddresses: Record<string, string>;
  verifierTxHash: string | null;
}

// Compiles ZKVerifier.sol, deploys only the libraries that HonkVerifier
// actually links against, links their addresses into the HonkVerifier
// bytecode, then deploys HonkVerifier.
//
// We wrap the caller's signer in a NonceManager: without this, ethers v6
// can reuse the same pending nonce for back-to-back factory.deploy() calls
// and the library + verifier end up fighting for the same address.
export async function deployVerifier(opts: DeployOptions): Promise<DeployResult> {
  const { verifier, libraries } = compileVerifier();
  const signer = new ethers.NonceManager(opts.signer);

  const needed = new Set<string>();
  for (const libs of Object.values(verifier.linkReferences)) {
    for (const libName of Object.keys(libs)) needed.add(libName);
  }

  const libraryAddresses: Record<string, string> = {};
  for (const name of needed) {
    const artifact = libraries[name];
    if (!artifact) throw new Error(`linked library ${name} missing from solc output`);
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
    const contract = await factory.deploy();
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    libraryAddresses[name] = address;
    opts.onLibraryDeployed?.(name, address);
  }

  const linkedBytecode = linkBytecode(verifier.bytecode, verifier.linkReferences, libraryAddresses);
  const sizeBytes = (linkedBytecode.length - 2) / 2;
  opts.onVerifierDeploying?.(sizeBytes);

  const factory = new ethers.ContractFactory(verifier.abi, linkedBytecode, signer);
  const contract = await factory.deploy();
  const deployTx = contract.deploymentTransaction();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  return {
    verifierAddress: address,
    libraryAddresses,
    verifierTxHash: deployTx?.hash ?? null,
  };
}
