export interface NetworkOption {
  chainId: number;
  name: string;
  rpcUrl: string;
  /**
   * The entry contract on this chain. Presets get theirs from the environment;
   * a custom network is by definition absent from the build's address book, so
   * it has to carry its own or there is nothing to read through.
   */
  readerAddress?: string;
  isCustom?: boolean;
}

export type NetworkSelection = number | "custom";
