import { task } from "hardhat/config";

const action = async (_, hre) => {
  const all = Object.entries(hre.config.networks).map(([name, conf]) => ({
    name,
    chainId: conf.chainId,
  }));

  console.log("DeepFamily supported blockchain networks\n");
  console.log("-".repeat(60));
  for (const n of all) {
    console.log(`${String(n.name).padEnd(20)} | Chain ID: ${String(n.chainId || "-")}`);
  }

  console.log("\nDeployment command examples:");
  console.log("-".repeat(60));
  for (const n of all) {
    if (n.name !== "localhost") {
      const scriptName = n.name.replace(/([A-Z])/g, "-$1").toLowerCase();
      console.log(`npm run deploy:${scriptName}`);
    }
  }

  console.log("\nVerification command examples:");
  console.log("-".repeat(60));
  for (const n of all) {
    if (n.name !== "localhost") {
      const scriptName = n.name.replace(/([A-Z])/g, "-$1").toLowerCase();
      console.log(`npm run verify:${scriptName}`);
    }
  }

  return all;
};

export default task("networks:list", "List available networks and common command hints")
  .setAction(() => Promise.resolve({ default: action }))
  .build();
