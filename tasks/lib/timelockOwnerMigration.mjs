export const deriveOwnerMigrationSalt = (
  ethers,
  { targets, values, payloads, predecessor, override },
) => {
  if (override && override !== "") {
    if (!ethers.isHexString(override, 32)) {
      throw new Error("--salt must be a 32-byte hex value");
    }
    return override;
  }

  const batchHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address[]", "uint256[]", "bytes[]", "bytes32"],
      [targets, values, payloads, predecessor],
    ),
  );
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["string", "bytes32"],
      ["deepfamily-timelock-migrate-owner-and-treasury-v3", batchHash],
    ),
  );
};

export const buildOwnerMigrationOperation = async ({
  ethers,
  oldTimelock,
  oldTimelockAddress,
  deepFamily,
  deepFamilyAddress,
  tokenAddress,
  newTimelockAddress,
  saltOverride,
}) => {
  let sweepPayload;
  try {
    sweepPayload = oldTimelock.interface.encodeFunctionData("sweepERC20", [
      tokenAddress,
      newTimelockAddress,
    ]);
  } catch (error) {
    throw new Error(
      `old timelock artifact must support sweepERC20(address,address): ${error.message}`,
    );
  }

  // Ownership changes first so all protocol fees received after this atomic batch go to the new
  // Timelock. The old Timelock then reads and transfers its complete DEEP balance at execution
  // time, including fees that arrived while the governance delay was running.
  const targets = [deepFamilyAddress, oldTimelockAddress];
  const values = [0n, 0n];
  const payloads = [
    deepFamily.interface.encodeFunctionData("transferOwnership", [newTimelockAddress]),
    sweepPayload,
  ];
  const predecessor = ethers.ZeroHash;
  const salt = deriveOwnerMigrationSalt(ethers, {
    targets,
    values,
    payloads,
    predecessor,
    override: saltOverride,
  });
  const operationId = await oldTimelock.hashOperationBatch(
    targets,
    values,
    payloads,
    predecessor,
    salt,
  );

  return { targets, values, payloads, predecessor, salt, operationId };
};
