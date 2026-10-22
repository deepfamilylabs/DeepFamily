import { emptyShieldedReceiveAuthorizations } from "@deepfamily/protocol-core";

/** TEST ONLY: isolates money-proof soundness from receive-presentation soundness. */
export async function deployMockReceiveAuthorization(hre) {
  const counterVerifier = await hre.ethers.deployContract("IdentityCounterVerifierMock");
  const authorizationState = await hre.ethers.deployContract("IdentityAuthorizationState", [
    await counterVerifier.getAddress(),
  ]);
  const receiveVerifier = await hre.ethers.deployContract("PrivateLetterVerifierMock");
  return {
    authorizationState,
    receiveVerifier,
    constructorArgs: [await authorizationState.getAddress(), await receiveVerifier.getAddress()],
  };
}

/**
 * The mock verifies all eleven exact public signals. Recipient binding must come from the
 * actual money-circuit opening; it is never synthesized or bypassed in production code.
 */
export async function authorizeMockReceive(hre, pool, data, action, bindings) {
  data.receiveAuthorizations = emptyShieldedReceiveAuthorizations();
  const state = await hre.ethers.getContractAt(
    "IdentityAuthorizationState",
    await pool.AUTHORIZATION_STATE(),
  );
  const checkpointId = await state.currentCheckpointId();
  const { root } = await state.getCheckpoint(checkpointId);
  const asOf = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
  const expiresAt = asOf + 7200n;
  const hash = BigInt(await pool.receiveActionHash(data));
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  const consumer = BigInt(await pool.getAddress());
  for (let slot = 0; slot < 2; slot++) {
    const recipientBinding = BigInt(bindings[slot]);
    if (recipientBinding === 0n) continue;
    const inputs = [
      chainId,
      consumer,
      BigInt(action),
      BigInt(slot),
      hash & ((1n << 128n) - 1n),
      hash >> 128n,
      checkpointId,
      root,
      asOf,
      expiresAt,
      recipientBinding,
    ];
    data.receiveAuthorizations[slot] = {
      checkpointId,
      asOf,
      expiresAt,
      recipientBinding,
      proof: hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256[11]"], [inputs]),
    };
  }
}
