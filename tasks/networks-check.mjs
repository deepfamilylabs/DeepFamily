import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";

export const nativeCurrencySymbol = (chainId) =>
  chainId === 71n || chainId === 1030n ? "CFX" : "ETH";

export const resolveRpcUrl = async (networkConfig) => {
  const configuredUrl = networkConfig?.url;
  if (typeof configuredUrl === "string") {
    return configuredUrl;
  }
  if (configuredUrl && typeof configuredUrl.get === "function") {
    return configuredUrl.get();
  }
  return undefined;
};

export const runNetworkCheck = async (
  args,
  hre,
  { log = console.log, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {},
) => {
  const { config } = hre;

  // Only HTTP-backed networks have external RPC connectivity to check. Hardhat
  // 3's default/node/hardhat entries are in-process simulated networks.
  let names = Object.entries(config.networks)
    .filter(([, networkConfig]) => networkConfig?.type === "http")
    .map(([name]) => name);

  // Parse only/exclude
  const onlySet = new Set(
    (args.only || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const excludeSet = new Set(
    (args.exclude || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  if (onlySet.size > 0) {
    names = names.filter((n) => onlySet.has(n));
  }
  if (excludeSet.size > 0) {
    names = names.filter((n) => !excludeSet.has(n));
  }
  const results = {};

  log("Checking network connectivity...\n");

  for (const name of names) {
    log(`\nChecking: ${name}`);

    let connection;

    try {
      const netCfg = config.networks[name] || {};
      const url = await resolveRpcUrl(netCfg);

      // If missing URL, skip unless includeMissing
      if (typeof url !== "string" || url.length === 0) {
        if (!args.includeMissing) {
          log("  Skipped: invalid RPC URL (use --include-missing to force check)");
          results[name] = false;
          continue;
        }
        throw new Error("Invalid RPC URL configured");
      }

      // If Infura and missing INFURA_API_KEY, skip unless includeMissing
      if (url.includes("infura.io/v3/") && !process.env.INFURA_API_KEY && !args.includeMissing) {
        log("  Warning: Skipped: missing INFURA_API_KEY (use --include-missing to force check)");
        results[name] = false;
        continue;
      }

      // In Hardhat 3, ethers is attached to each network connection rather than
      // directly to the HRE. Let Hardhat resolve configuration variables and
      // construct the provider for the selected network.
      connection = await hre.network.create(name);
      const { ethers } = connection;
      const provider = ethers.provider;
      const network = await provider.getNetwork();
      log(`  - Chain ID: ${network.chainId}`);

      const start = Date.now();
      const blockNumber = await provider.getBlockNumber();
      const rt = Date.now() - start;
      log(`  - Latest block: ${blockNumber}`);
      log(`  - Response time: ${rt}ms`);

      // Optional: output balance if PRIVATE_KEY provided
      try {
        const pk = process.env.PRIVATE_KEY;
        if (pk && /^0x[0-9a-fA-F]{64}$/.test(pk)) {
          const wallet = new ethers.Wallet(pk, provider);
          const bal = await provider.getBalance(wallet.address);
          log(`  - Deployer: ${wallet.address}`);
          log(`  - Balance: ${ethers.formatEther(bal)} ${nativeCurrencySymbol(network.chainId)}`);
        }
      } catch {}

      log(`  ${name} reachable`);
      results[name] = true;
    } catch (e) {
      log(`  ${name} failed: ${e.message}`);
      results[name] = false;
    } finally {
      try {
        await connection?.close?.();
      } catch {}
    }

    const delay = Math.max(0, Number.parseInt(args.delay, 10) || 0);
    await wait(delay);
  }

  const ok = Object.values(results).filter(Boolean).length;
  const summary = {
    totalChecked: names.length,
    success: ok,
    failed: names.length - ok,
    results,
  };
  log("\n" + "=".repeat(50));
  log("Summary:");
  log("=".repeat(50));
  log(`Total checked: ${summary.totalChecked}`);
  log(`Success: ${summary.success}`);
  log(`Failed: ${summary.failed}`);

  return summary;
};

export default task("networks:check", "Check connectivity for networks in hardhat.config.mjs")
  .addOption({
    name: "delay",
    description: "Delay between requests ms",
    type: ArgumentType.STRING,
    defaultValue: "800",
  })
  .addOption({
    name: "only",
    description: "Only check these networks, comma separated",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "exclude",
    description: "Exclude these networks, comma separated",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addFlag({
    name: "includeMissing",
    description: "Include networks missing credentials/URL",
  })
  .setAction(() => Promise.resolve({ default: runNetworkCheck }))
  .build();
