const snarkjsMainUrl = import.meta.resolve("snarkjs");
const zkeyUtilsUrl = new URL("./src/zkey_utils.js", snarkjsMainUrl);
const binFileUtilsUrl = import.meta.resolve("@iden3/binfileutils", snarkjsMainUrl);
const blake2bUrl = import.meta.resolve("blake2b-wasm", snarkjsMainUrl);

const bytesToHex = (value) => Buffer.from(value).toString("hex");

/**
 * Reads the Groth16 MPC section from snarkjs 0.7.5. snarkjs does not expose this metadata through
 * its public API, so the production ceremony gate deliberately couples this reader to the exact
 * installed version already pinned by the manifest and package lock.
 */
export const readZkeyMpcMetadata = async (zkeyPath) => {
  const [zkeyUtils, binFileUtils, { default: Blake2b }] = await Promise.all([
    import(zkeyUtilsUrl.href),
    import(binFileUtilsUrl),
    import(blake2bUrl),
  ]);
  await Blake2b.ready();

  let file;
  let curve;
  try {
    file = await binFileUtils.readBinFile(zkeyPath, "zkey", 2);
    const header = await zkeyUtils.readHeader(file.fd, file.sections, false, {
      singleThread: true,
    });
    if (header.protocol !== "groth16") {
      throw new Error(`ZKey MPC metadata requires Groth16: ${zkeyPath}`);
    }
    curve = header.curve;
    const mpc = await zkeyUtils.readMPCParams(file.fd, curve, file.sections);
    const contributions = mpc.contributions.map((contribution, index) => {
      const hasher = Blake2b(64);
      zkeyUtils.hashPubKey(hasher, curve, contribution);
      return Object.freeze({
        sequence: index + 1,
        type: contribution.type,
        name: contribution.name ?? null,
        transcriptHash: bytesToHex(contribution.transcript),
        contributionHash: bytesToHex(hasher.digest()),
        beaconHash:
          contribution.type === 1 && contribution.beaconHash
            ? bytesToHex(contribution.beaconHash)
            : null,
        numIterationsExp: contribution.type === 1 ? (contribution.numIterationsExp ?? null) : null,
      });
    });
    return Object.freeze({
      circuitHash: bytesToHex(mpc.csHash),
      contributionCount: contributions.length,
      contributions: Object.freeze(contributions),
    });
  } finally {
    if (file?.fd) await file.fd.close();
    if (curve?.terminate) await curve.terminate();
  }
};
