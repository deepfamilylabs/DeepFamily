import { isLocalDevelopmentConnection } from "./governanceSafety.mjs";

// localhost exposes the node's unlocked development accounts through getSigners().
// Seeding must instead use the wallet funded by dev:fund, on every network.
export async function resolveHistoricalSeedSigner(connection, env = process.env) {
  const rawKey = String(env.PRIVATE_KEY ?? "").trim();
  if (!rawKey) {
    throw new Error("Historical seeding requires PRIVATE_KEY in .env; no node account fallback");
  }

  const privateKey = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
  const { ethers } = connection;
  let signer;
  try {
    signer = new ethers.Wallet(privateKey, ethers.provider);
  } catch {
    // Ethers validation errors can include the rejected key. Report only the setting name.
    throw new Error("PRIVATE_KEY is not a valid private key for historical seeding");
  }

  if ((await ethers.provider.getBalance(signer.address)) === 0n) {
    const nextStep = isLocalDevelopmentConnection(connection)
      ? "Run npm run dev:fund before npm run dev:seed."
      : "Fund this address with the network's native currency before seeding.";
    throw new Error(`Seed signer ${signer.address} has no native balance. ${nextStep}`);
  }

  return signer;
}
