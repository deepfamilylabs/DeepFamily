import type { ethers } from "ethers";
import type { InheritanceModules } from "../services/inheritanceModules";

/** Everything an action needs: checked contracts and a wallet on the same chain. */
export interface InheritanceSession {
  modules: InheritanceModules;
  signer: ethers.Signer;
  account: string;
}
