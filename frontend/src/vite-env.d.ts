/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUCTION_ADDRESS?: string;
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_SEPOLIA_CHAIN_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface EthereumRequest {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

interface EthereumProvider {
  request: (args: EthereumRequest) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

interface Window {
  ethereum?: EthereumProvider;
}
