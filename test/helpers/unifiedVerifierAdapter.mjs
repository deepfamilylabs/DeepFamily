/** Identity/disclosure fixtures use the canonical identity-only adapter. */
export async function deployUnifiedVerifierAdapter(hre, verifiers = {}) {
  const addressOf = async (contract) =>
    contract?.getAddress ? contract.getAddress() : (contract ?? hre.ethers.ZeroAddress);
  if (verifiers.shield || verifiers.unshield || verifiers.unshield4) {
    const adapter = await hre.ethers.deployContract("ShieldedBoundaryVerifierAdapter", [
      await addressOf(verifiers.shield),
      await addressOf(verifiers.unshield),
      await addressOf(verifiers.unshield4),
    ]);
    await adapter.waitForDeployment();
    return adapter;
  }
  const adapter = await hre.ethers.deployContract("Groth16VerifierAdapter", [
    await addressOf(verifiers.person),
    await addressOf(verifiers.disclosure),
  ]);
  await adapter.waitForDeployment();
  return adapter;
}
