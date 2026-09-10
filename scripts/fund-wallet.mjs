import "dotenv/config";

import hre from "hardhat";

const DEFAULT_AMOUNT_ETH = "10.0";

function normalizePrivateKey(rawKey) {
  const key = rawKey.trim();
  if (!key) return undefined;
  return key.startsWith("0x") ? key : `0x${key}`;
}

// Defaults to the .env signer so a local wallet is funded without editing this file;
// FUND_ADDRESS targets any other account. Hardhat 3 rejects unknown CLI flags on
// `hardhat run`, so both knobs are environment variables.
function resolveTargetAddress(ethers) {
  const explicit = (process.env.FUND_ADDRESS || "").trim();
  if (explicit) {
    // Throws on a malformed address instead of burning ETH to a typo.
    return { address: ethers.getAddress(explicit), source: "FUND_ADDRESS" };
  }

  const privateKey = normalizePrivateKey(process.env.PRIVATE_KEY || "");
  if (!privateKey) {
    throw new Error("No funding target: set PRIVATE_KEY in .env, or FUND_ADDRESS=0x...");
  }

  let wallet;
  try {
    wallet = new ethers.Wallet(privateKey);
  } catch {
    throw new Error(
      "PRIVATE_KEY in .env is not a valid private key; fix it or set FUND_ADDRESS=0x...",
    );
  }
  return { address: wallet.address, source: "PRIVATE_KEY in .env" };
}

async function main() {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const [deployer] = await ethers.getSigners();

  const { address: targetAddress, source } = resolveTargetAddress(ethers);
  const amount = ethers.parseEther(process.env.FUND_AMOUNT || DEFAULT_AMOUNT_ETH);

  console.log(`Funding ${targetAddress} (${source}) with ${ethers.formatEther(amount)} ETH...`);

  const tx = await deployer.sendTransaction({
    to: targetAddress,
    value: amount,
  });

  await tx.wait();

  console.log(`Successfully sent ${ethers.formatEther(amount)} ETH to ${targetAddress}`);
  console.log(`Transaction hash: ${tx.hash}`);

  // Check balance
  const balance = await ethers.provider.getBalance(targetAddress);
  console.log(`New balance: ${ethers.formatEther(balance)} ETH`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
