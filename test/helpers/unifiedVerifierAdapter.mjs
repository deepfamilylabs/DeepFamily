const SHIELDED_ROUTES = [
  "shield",
  "createPolicy",
  "allocate",
  "topUp",
  "mergeBudget",
  "claim",
  "privateTransfer",
  "unshield",
];

/** Configure only the generated verifier routes exercised by an isolated fixture. */
export async function deployUnifiedVerifierAdapter(hre, verifiers = {}) {
  const addressOf = async (contract) =>
    contract?.getAddress ? contract.getAddress() : (contract ?? hre.ethers.ZeroAddress);
  const adapter = await hre.ethers.deployContract("Groth16VerifierAdapter", [
    await addressOf(verifiers.person),
    await addressOf(verifiers.disclosure),
    await Promise.all(SHIELDED_ROUTES.map((route) => addressOf(verifiers[route]))),
  ]);
  await adapter.waitForDeployment();
  return adapter;
}
