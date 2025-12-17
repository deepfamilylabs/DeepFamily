import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { ensureIntegratedSystem } from "../hardhat/integratedDeployment.mjs";

// Fee is paid in DeepFamilyToken equal to recentReward(), requiring ERC20 allowance

const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const signer = (await ethers.getSigners())[0];
  const signerAddr = await signer.getAddress();
  const { deepFamily, token } = await ensureIntegratedSystem(connection);
  const deepAddr = (deepFamily.target || deepFamily.address).toLowerCase();

  const versionIndex = Number(args.vindex);
  if (!Number.isInteger(versionIndex) || versionIndex <= 0) {
    throw new Error("vindex must be a positive integer starting from 1");
  }

  // Existence / bounds check (prevents confusing InvalidVersionIndex revert on fresh network)
  const [, totalVersions] = await deepFamily.listPersonVersions(args.person, 0, 0);
  if (versionIndex > totalVersions) {
    throw new Error(
      `Version index ${versionIndex} out of range (total=${totalVersions}). Did you add the person on this network / use --network localhost?`,
    );
  }

  // Read current fee (recentReward)
  let fee = await token.recentReward();
  fee = BigInt(fee);

  // Handle allowance if fee > 0
  if (fee > 0n) {
    const deepFamilyAddr = deepFamily.target || deepFamily.address;
    const allowance = await token.allowance(signerAddr, deepFamilyAddr);
    if (allowance < fee) {
      if (String(args.autoapprove).toLowerCase() === "true") {
        const multiplier = BigInt(Number(args.approvebuffer) || 1);
        const approveAmount = fee * multiplier;
        const approveTx = await token.approve(deepFamilyAddr, approveAmount);
        await approveTx.wait();
      } else {
        throw new Error(
          `Insufficient allowance (${allowance}) < fee (${fee}). Re-run with --autoapprove true or manually approve.`,
        );
      }
    }
  }

  // Call endorseVersion
  const tx = await deepFamily.endorseVersion(args.person, versionIndex);
  const receipt = await tx.wait();

  // Decode PersonVersionEndorsed event
  try {
    const iface = new ethers.Interface([
      "event PersonVersionEndorsed(bytes32 indexed personHash, address indexed endorser, uint256 versionIndex, address recipient, uint256 recipientShare, address protocolRecipient, uint256 protocolShare, uint256 endorsementFee, uint256 timestamp)",
    ]);
    for (const log of receipt.logs || []) {
      if ((log.address || "").toLowerCase() !== deepAddr) continue;
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "PersonVersionEndorsed") {
          break;
        }
      } catch (_) {
        /* ignore individual log parse errors */
      }
    }
  } catch (e) {}
};

export default task(
  "endorse",
  "Endorse a person version (uses DeepFamilyToken recentReward as fee)",
)
  .addOption({
    name: "person",
    description: "Person hash (bytes32)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "vindex",
    description: "Version index (starting from 1)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "autoapprove",
    description: "If set to true, auto approve required token allowance",
    type: ArgumentType.STRING,
    defaultValue: "true",
  })
  .addOption({
    name: "approvebuffer",
    description: "Extra allowance multiplier (e.g. 2 = approve 2x fee)",
    type: ArgumentType.STRING,
    defaultValue: "1",
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
