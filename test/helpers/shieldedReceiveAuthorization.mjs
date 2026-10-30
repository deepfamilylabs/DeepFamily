import {
  emptyShieldedReceiveAuthorizations,
  SHIELDED_RECEIVE_PROOF_LIFETIME,
} from "@deepfamily/protocol-core";

/** Deploy the exact linked SMT implementation used by production deployments. */
export async function identityAuthorizationStateFactory(hre) {
  const poseidonT3 = await hre.ethers.deployContract("PoseidonT3");
  const poseidonT4 = await hre.ethers.deployContract("PoseidonT4");
  return hre.ethers.getContractFactory("IdentityAuthorizationState", {
    libraries: { PoseidonT3: await poseidonT3.getAddress(), PoseidonT4: await poseidonT4.getAddress() },
  });
}

export async function deployIdentityAuthorizationState(hre, verifier) {
  return (await identityAuthorizationStateFactory(hre)).deploy(verifier);
}

/** TEST ONLY: isolates money-proof soundness from receive-presentation soundness. */
export async function deployMockReceiveAuthorization(hre) {
  const counterVerifier = await hre.ethers.deployContract("IdentityCounterVerifierMock");
  const authorizationState = await deployIdentityAuthorizationState(hre, await counterVerifier.getAddress());
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
 * A longer lifetime than the circuit's isolates tests of other time windows.
 */
export async function authorizeMockReceive(
  hre,
  pool,
  data,
  action,
  bindings,
  lifetime = SHIELDED_RECEIVE_PROOF_LIFETIME,
) {
  data.receiveAuthorizations = emptyShieldedReceiveAuthorizations();
  const state = await hre.ethers.getContractAt(
    "IdentityAuthorizationState",
    await pool.AUTHORIZATION_STATE(),
  );
  const checkpointId = await state.currentCheckpointId();
  const { root } = await state.getCheckpoint(checkpointId);
  const asOf = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
  const deadline = asOf + lifetime;
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
      deadline,
      recipientBinding,
    ];
    data.receiveAuthorizations[slot] = {
      checkpointId,
      asOf,
      deadline,
      recipientBinding,
      proof: hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256[11]"], [inputs]),
    };
  }
}
