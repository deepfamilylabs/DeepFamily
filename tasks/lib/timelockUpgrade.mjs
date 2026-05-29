import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { checkImplementationAgainstBaseline } from "../../scripts/lib/storageLayout.mjs";

// Upgradeable proxies and whether their implementation links external libraries. The owner of
// each proxy is expected to be a TimelockController (intended production model: timelock + multisig).
export const UPGRADE_TARGETS = {
  main: { contract: "DeepFamily", needsLibraries: true },
  registry: { contract: "DeepFamilyAttestationRegistry", needsLibraries: false },
};

const deploymentsDir = (connection) => {
  const networkName =
    connection.networkName ||
    connection.network?.name ||
    connection.network?.networkName ||
    "unknown";
  return path.join(process.cwd(), "deployments", networkName);
};

export const readDeploymentAddress = async (connection, contractName) => {
  const filePath = path.join(deploymentsDir(connection), `${contractName}.json`);
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    throw new Error(`No deployment file for ${contractName} (${filePath})`);
  }
  if (!raw?.address) throw new Error(`No deployment address recorded for ${contractName}`);
  return raw.address;
};

// Refresh the `implementationAddress` field in the deployment JSON for a proxy after the script
// directly executed an upgrade. Multisig-driven executions happen outside this script and can't
// be tracked here, so the field is metadata-only and best-effort — failures are swallowed.
export const updateDeploymentImplementation = async (connection, contractName, implementation) => {
  const filePath = path.join(deploymentsDir(connection), `${contractName}.json`);
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    raw.implementationAddress = implementation;
    await fs.writeFile(filePath, JSON.stringify(raw, null, 2));
    return { updated: true, filePath };
  } catch (error) {
    return { updated: false, filePath, error };
  }
};

// Run the repo-wide storage-layout safety guard (baselines + positive/negative mock checks).
// This confirms the build-time upgradeability harness is intact; it does NOT, on its own,
// validate the specific implementation an operator is about to schedule — see
// `assertImplementationStorageSafe` below for that.
export const runStorageCheck = () => {
  execFileSync("node", ["scripts/check-storage-layout.mjs"], { stdio: "inherit" });
};

// Validate the storage layout of the SPECIFIC implementation being scheduled against the
// committed baseline of the proxy it will replace. Closes the gap between "the baselines
// look fine" and "this particular upgrade is storage-safe". Throws on incompatibility so
// the schedule task aborts before staging an unsafe upgrade.
export const assertImplementationStorageSafe = async (
  hre,
  proxyContractName,
  implementationContractName,
) => {
  const artifact = await hre.artifacts.readArtifact(implementationContractName);
  const errors = checkImplementationAgainstBaseline({
    proxyName: proxyContractName,
    implementationArtifact: artifact,
  });
  if (errors.length > 0) {
    console.error(
      `storage-layout: ${implementationContractName} is NOT a safe upgrade of ${proxyContractName}:`,
    );
    console.error(JSON.stringify(errors, null, 2));
    throw new Error(
      `aborting: ${implementationContractName} would break ${proxyContractName} storage layout`,
    );
  }
  console.log(
    `storage-layout: ${implementationContractName} is a safe upgrade of ${proxyContractName} (OK)`,
  );
};

// Solidity appends a CBOR-encoded metadata blob to runtime bytecode. The blob may differ between
// compilations even when logic is identical (paths, build environment), so strip it before
// comparing bytecodes by source. The last 2 bytes carry the metadata length in big-endian.
const stripBytecodeMetadata = (bytecode) => {
  const body = String(bytecode || "").replace(/^0x/, "");
  if (body.length < 4) return "0x" + body;
  const len = parseInt(body.slice(-4), 16);
  if (!Number.isFinite(len) || len <= 0 || (len + 2) * 2 > body.length) return "0x" + body;
  return "0x" + body.slice(0, body.length - (len + 2) * 2);
};

// Zero out immutable byte ranges so two bytecodes can be compared by logic alone. UUPS
// implementations bake `address private immutable __self = address(this)` (from
// UUPSUpgradeable) into runtime code, so the on-chain code differs from the artifact's
// deployedBytecode (which has zeros there) by the deployment address. `immutableReferences`
// maps each immutable to its {start,length} byte offsets in the deployed bytecode.
const maskImmutables = (bytecode, immutableReferences) => {
  let body = String(bytecode || "").replace(/^0x/, "");
  for (const refs of Object.values(immutableReferences || {})) {
    for (const { start, length } of refs) {
      const s = start * 2;
      const e = s + length * 2;
      if (e <= body.length) {
        body = body.slice(0, s) + "0".repeat(length * 2) + body.slice(e);
      }
    }
  }
  return "0x" + body;
};

// Substitute library link placeholders in an artifact's deployedBytecode with concrete addresses
// so the result can be compared byte-for-byte against on-chain runtime code.
const linkDeployedBytecode = (artifact, libraryAddresses) => {
  let body = String(artifact.deployedBytecode || "").replace(/^0x/, "");
  const linkRefs = artifact.deployedLinkReferences || {};
  for (const refs of Object.values(linkRefs)) {
    for (const [libName, occurrences] of Object.entries(refs)) {
      const raw = libraryAddresses[libName];
      if (!raw) {
        throw new Error(
          `Missing library address for ${libName} when linking ${artifact.contractName}`,
        );
      }
      const cleanAddr = String(raw).toLowerCase().replace(/^0x/, "");
      if (cleanAddr.length !== 40) {
        throw new Error(`Invalid library address for ${libName}: ${raw}`);
      }
      for (const o of occurrences) {
        const start = o.start * 2;
        const end = start + o.length * 2;
        body = body.slice(0, start) + cleanAddr + body.slice(end);
      }
    }
  }
  return "0x" + body;
};

// Verify a pre-deployed implementation address really hosts the bytecode of the artifact the
// operator claims. Without this, the candidate storage-layout check would still pass on the
// artifact while the actual upgrade points at unrelated code. Library links are resolved from
// recorded deployment addresses; immutables (e.g., UUPSUpgradeable's __self) are masked and CBOR
// metadata is stripped so deployment address and unrelated compilation environments do not cause
// false mismatches.
export const assertImplementationMatchesArtifact = async ({
  connection,
  ethers,
  hre,
  contractName,
  implementation,
  spec,
}) => {
  const artifact = await hre.artifacts.readArtifact(contractName);
  const libraries = {};
  if (spec?.needsLibraries) {
    libraries.PoseidonT5 = await readDeploymentAddress(connection, "PoseidonT5");
    libraries.AdultAgeGate = await readDeploymentAddress(connection, "AdultAgeGate");
  }
  const expected = linkDeployedBytecode(artifact, libraries);
  const onChain = await ethers.provider.getCode(implementation);
  if (onChain === "0x") {
    throw new Error(`Implementation ${implementation} has no code on this network`);
  }
  const immutableRefs = artifact.immutableReferences || {};
  const a = stripBytecodeMetadata(maskImmutables(expected, immutableRefs)).toLowerCase();
  const b = stripBytecodeMetadata(maskImmutables(onChain, immutableRefs)).toLowerCase();
  if (a !== b) {
    throw new Error(
      `Implementation ${implementation} bytecode does NOT match artifact ${contractName} ` +
        `(metadata-stripped). Either the address is wrong, library linkage differs, or the artifact ` +
        `was compiled from different sources.`,
    );
  }
  console.log(
    `bytecode-check: ${implementation} matches artifact ${contractName} (metadata-stripped) OK`,
  );
};

// Deterministic salt so `schedule` and `execute` derive the same operation id from identical
// inputs. Operators can override it to disambiguate repeated upgrades of the same implementation.
export const deriveSalt = (ethers, { target, implementation, initData, override }) => {
  if (override && override !== "") return override;
  return ethers.id(`deepfamily-upgrade|${target}|${implementation.toLowerCase()}|${initData}`);
};

export const resolveTarget = async (connection, ethers, targetArg) => {
  const spec = UPGRADE_TARGETS[targetArg];
  if (!spec) {
    throw new Error(`Unknown --target "${targetArg}" (expected one of: main, registry)`);
  }
  const proxyAddress = await readDeploymentAddress(connection, spec.contract);
  const proxy = await ethers.getContractAt(spec.contract, proxyAddress);
  const timelockAddress = await proxy.owner();
  // The owner is expected to be a TimelockController; GovernanceTimelock exposes its full ABI.
  const timelock = await ethers.getContractAt("GovernanceTimelock", timelockAddress);
  return { spec, proxyAddress, proxy, timelockAddress, timelock };
};

export const deployImplementation = async (connection, ethers, signer, spec, contractName) => {
  const factoryOpts = { signer };
  if (spec.needsLibraries) {
    factoryOpts.libraries = {
      PoseidonT5: await readDeploymentAddress(connection, "PoseidonT5"),
      AdultAgeGate: await readDeploymentAddress(connection, "AdultAgeGate"),
    };
  }
  const factory = await ethers.getContractFactory(contractName, factoryOpts);
  const impl = await factory.deploy();
  await impl.waitForDeployment();
  return impl.getAddress();
};

// Encode the proxy's upgrade call. The proxy ABI of the target contract carries upgradeToAndCall.
export const encodeUpgradeCall = (proxy, implementation, initData) =>
  proxy.interface.encodeFunctionData("upgradeToAndCall", [implementation, initData]);

// Send a timelock call from `signer` if it holds `role`; otherwise print the calldata so an
// operator can submit it through the proposer/executor (typically a multisig).
export const sendOrPrint = async ({
  timelock,
  timelockAddress,
  signer,
  role,
  method,
  callArgs,
}) => {
  const signerAddress = await signer.getAddress();
  const hasRole = await timelock.hasRole(role, signerAddress);
  const calldata = timelock.interface.encodeFunctionData(method, callArgs);
  if (hasRole) {
    const tx = await timelock.connect(signer)[method](...callArgs);
    await tx.wait();
    console.log(`  sent ${method} from ${signerAddress}: tx ${tx.hash}`);
    return { sent: true, txHash: tx.hash, calldata };
  }
  console.log(`  signer ${signerAddress} lacks the required role; submit this from the multisig:`);
  console.log(`    to:   ${timelockAddress}`);
  console.log(`    data: ${calldata}`);
  return { sent: false, calldata };
};
