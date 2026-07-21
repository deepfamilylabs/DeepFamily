import { task } from "hardhat/config";

const INTERNAL_NETWORKS = new Set(["default", "node", "hardhat"]);
const NETWORK_ORDER = new Map(
  ["conflux", "confluxTestnet", "mainnet", "sepolia", "localhost"].map((name, index) => [
    name,
    index,
  ]),
);

export const listSupportedNetworks = (networks) =>
  Object.entries(networks)
    .filter(([name]) => !INTERNAL_NETWORKS.has(name))
    .map(([name, conf]) => ({
      name,
      chainId: conf.chainId,
    }))
    .sort(
      (a, b) =>
        (NETWORK_ORDER.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
          (NETWORK_ORDER.get(b.name) ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name),
    );

export const runNetworksList = async (_, hre, { log = console.log } = {}) => {
  const all = listSupportedNetworks(hre.config.networks);

  log("DeepFamily supported blockchain networks\n");
  log("-".repeat(60));
  for (const n of all) {
    log(`${String(n.name).padEnd(20)} | Chain ID: ${String(n.chainId || "-")}`);
  }

  log("\nDeployment command examples:");
  log("-".repeat(60));
  for (const n of all) {
    log(`npm run deploy:net --net=${n.name}`);
  }

  log("\nVerification command examples:");
  log("-".repeat(60));
  for (const n of all) {
    if (n.name !== "localhost") {
      log(`npm run verify:net --net=${n.name}`);
    }
  }

  return all;
};

export default task("networks:list", "List available networks and common command hints")
  .setAction(() => Promise.resolve({ default: runNetworksList }))
  .build();
