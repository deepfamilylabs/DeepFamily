import { AbiCoder, concat, getBytes, id, keccak256, toBeHex } from "ethers";

// LinkG16, zk-creds (IEEE S&P 2023), Appendix C/D:
// https://www.cs.purdue.edu/homes/white570/media/zk-creds.pdf
// The Fiat-Shamir transcript below uses Ethereum's Keccak ABI encoding in place
// of the reference implementation's Merlin transcript. All keys, layouts,
// proof points and operation inputs are bound to that transcript.
export const LINKED_GROTH16_DOMAIN = id("DeepFamily:LinkedGroth16:v1");
export const BN254_BASE_FIELD =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;
export const BN254_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const G2_GENERATOR = [
  [
    "10857046999023057135944570762232829481370756359578518086990519993285655852781",
    "11559732032986387107991004021392285783925812861821192530917403151452391805634",
  ],
  [
    "8495653923123431417604973247489272438418190587263600148770280649306958101930",
    "4082367875863433681332203403145435568316851327593401208105741076214120093531",
  ],
];
const abi = AbiCoder.defaultAbiCoder();

function check(condition, message) {
  if (!condition) throw new Error(`Invalid linked Groth16 proof: ${message}`);
}

function integer(value, modulus, label) {
  check(
    typeof value === "bigint" ||
      (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
      (typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value)),
    `${label} must be a canonical unsigned integer`,
  );
  const n = BigInt(value);
  check(n >= 0n && n < modulus, `${label} is outside its field`);
  return n;
}

function g1Words(point, label, allowInfinity = false) {
  check(Array.isArray(point) && (point.length === 2 || point.length === 3), `${label} shape`);
  const words = point.slice(0, 2).map((x) => integer(x, BN254_BASE_FIELD, label));
  if (point.length === 3) {
    const z = integer(point[2], BN254_BASE_FIELD, `${label} affine marker`);
    if (z === 0n) {
      check(allowInfinity && words[0] === 0n && words[1] === 1n, `${label} infinity`);
      return [0n, 0n];
    }
    check(z === 1n, `${label} must be affine`);
  }
  check(allowInfinity || words[0] !== 0n || words[1] !== 0n, `${label} must be nonzero`);
  return words;
}

function g2Words(point, label) {
  check(Array.isArray(point) && (point.length === 2 || point.length === 3), `${label} shape`);
  check(
    point.slice(0, 2).every((x) => Array.isArray(x) && x.length === 2),
    `${label} shape`,
  );
  if (point.length === 3) {
    check(Array.isArray(point[2]) && point[2].length === 2, `${label} affine marker`);
    check(
      integer(point[2][0], BN254_BASE_FIELD, `${label} affine marker`) === 1n &&
        integer(point[2][1], BN254_BASE_FIELD, `${label} affine marker`) === 0n,
      `${label} must be affine`,
    );
  }
  return [point[0][1], point[0][0], point[1][1], point[1][0]].map((x) =>
    integer(x, BN254_BASE_FIELD, label),
  );
}

function normalizeKey({ verificationKey: vk, deltaG1 }) {
  check(vk?.protocol === "groth16" && ["bn128", "bn254"].includes(vk.curve), "key protocol");
  check(Number.isSafeInteger(vk.nPublic) && vk.nPublic > 0 && vk.nPublic <= 128, "key layout");
  check(Array.isArray(vk.IC) && vk.IC.length === vk.nPublic + 1, "key coefficient count");
  const key = {
    nPublic: vk.nPublic,
    deltaG1: g1Words(deltaG1, "delta G1"),
    alpha: g1Words(vk.vk_alpha_1, "alpha"),
    beta: g2Words(vk.vk_beta_2, "beta"),
    gamma: g2Words(vk.vk_gamma_2, "gamma"),
    delta: g2Words(vk.vk_delta_2, "delta G2"),
    ic: vk.IC.map((p) => g1Words(p, "input coefficient", true)),
  };
  check(
    key.gamma.every((x, i) => x === g2Words(G2_GENERATOR, "generator")[i]),
    "LinkG16 requires gamma = 1",
  );
  key.words = [
    BigInt(key.nPublic),
    ...key.deltaG1,
    ...key.alpha,
    ...key.beta,
    ...key.gamma,
    ...key.delta,
    ...key.ic.flat(),
  ];
  key.digest = keccak256(abi.encode(["uint256[]"], [key.words]));
  return key;
}

/** Canonical key representation shared with the fixed Solidity verifier generator. */
export function linkedGroth16VerificationKey(parameters) {
  return normalizeKey(parameters);
}

function parseProof(proof) {
  check(
    proof?.protocol === "groth16" && ["bn128", "bn254"].includes(proof.curve),
    "proof protocol",
  );
  return [
    ...g1Words(proof.pi_a, "proof A"),
    ...g2Words(proof.pi_b, "proof B"),
    ...g1Words(proof.pi_c, "proof C"),
  ];
}

function decodeG1(curve, words) {
  return words[0] === 0n && words[1] === 0n ? curve.G1.zero : curve.G1.fromObject([...words, 1n]);
}

function decodeG2(curve, words) {
  return curve.G2.fromObject([
    [words[1], words[0]],
    [words[3], words[2]],
    [1n, 0n],
  ]);
}

function encodeG1(curve, point) {
  if (curve.G1.isZero(point)) return [0n, 0n];
  return curve.G1.toObject(curve.G1.toAffine(point)).slice(0, 2);
}

function encodeG2(curve, point) {
  return g2Words(curve.G2.toObject(curve.G2.toAffine(point)), "proof B");
}

async function withCurve(operation) {
  // ffjavascript initializes a process-wide cache at module evaluation. A
  // second installed copy must not discard an already running snarkjs pool.
  const existingPool = globalThis.curve_bn128;
  const { buildBn128 } = await import("ffjavascript");
  if (existingPool && globalThis.curve_bn128 === null) globalThis.curve_bn128 = existingPool;
  const curve = await buildBn128(true);
  try {
    return await operation(curve);
  } finally {
    await curve.terminate();
  }
}

function checkedG1(curve, words) {
  const point = decodeG1(curve, words);
  check(curve.G1.isValid(point), "G1 point is not on the curve");
  return point;
}

function checkedG2(curve, words) {
  const point = decodeG2(curve, words);
  check(curve.G2.isValid(point), "G2 point is not on the curve");
  check(curve.G2.isZero(curve.G2.timesScalar(point, BN254_SCALAR_FIELD)), "G2 subgroup");
  return point;
}

async function loadKey(curve, key) {
  const loaded = {
    ...key,
    delta1: checkedG1(curve, key.deltaG1),
    alpha1: checkedG1(curve, key.alpha),
    beta2: checkedG2(curve, key.beta),
    delta2: checkedG2(curve, key.delta),
    points: key.ic.map((p) => checkedG1(curve, p)),
  };
  check(
    await curve.pairingEq(loaded.delta1, curve.G2.one, curve.G1.neg(curve.G1.one), loaded.delta2),
    "delta G1 and G2 do not match",
  );
  return loaded;
}

/** Validate the extra public delta G1 point against an existing Groth16 key. */
export async function validateLinkedGroth16VerificationKey(parameters) {
  const key = normalizeKey(parameters);
  await withCurve((curve) => loadKey(curve, key));
  return key;
}

function mod(value) {
  return ((value % BN254_SCALAR_FIELD) + BN254_SCALAR_FIELD) % BN254_SCALAR_FIELD;
}

function inverse(value) {
  let base = value;
  let exponent = BN254_SCALAR_FIELD - 2n;
  let result = 1n;
  while (exponent !== 0n) {
    if (exponent & 1n) result = mod(result * base);
    base = mod(base * base);
    exponent >>= 1n;
  }
  return result;
}

function randomScalar() {
  const bytes = new Uint8Array(32);
  for (;;) {
    globalThis.crypto.getRandomValues(bytes);
    const n = bytes.reduce((a, b) => (a << 8n) | BigInt(b), 0n);
    bytes.fill(0);
    if (n > 0n && n < BN254_SCALAR_FIELD) return n;
  }
}

function multiply(curve, point, scalar) {
  return curve.G1.timesScalar(point, scalar);
}

function msm(curve, points, scalars) {
  return points.reduce(
    (sum, point, i) => curve.G1.add(sum, multiply(curve, point, scalars[i])),
    curve.G1.zero,
  );
}

function challenge(keys, hiddenCount, pointWords, publicInputs) {
  return mod(
    BigInt(
      keccak256(
        abi.encode(
          ["bytes32", "uint256", "uint256", "bytes32", "bytes32", "uint256[]", "uint256[]"],
          [
            LINKED_GROTH16_DOMAIN,
            hiddenCount,
            publicInputs.length,
            keys[0].digest,
            keys[1].digest,
            pointWords,
            publicInputs,
          ],
        ),
      ),
    ),
  );
}

function layouts(issuer, presentation, publicInputs) {
  const keys = [normalizeKey(issuer), normalizeKey(presentation)];
  check(Array.isArray(publicInputs), "operation inputs must be an array");
  const inputs = publicInputs.map((x) => integer(x, BN254_SCALAR_FIELD, "operation input"));
  const hiddenCount = keys[0].nPublic;
  check(keys[1].nPublic === hiddenCount + inputs.length, "presentation public layout");
  return { keys, inputs, hiddenCount };
}

async function verifyPairing(curve, key, proofWords, preparedInput) {
  const a = checkedG1(curve, proofWords.slice(0, 2));
  const b = checkedG2(curve, proofWords.slice(2, 6));
  const c = checkedG1(curve, proofWords.slice(6, 8));
  check(!curve.G1.isZero(a) && !curve.G1.isZero(c) && !curve.G2.isZero(b), "zero proof point");
  return curve.pairingEq(
    curve.G1.neg(a),
    b,
    preparedInput,
    curve.G2.one,
    c,
    key.delta2,
    key.alpha1,
    key.beta2,
  );
}

async function verifyWithCurve(curve, words, parameters) {
  const { keys, inputs, hiddenCount } = parameters;
  check(words.length === 26 + hiddenCount, "composite proof length");
  check(
    words.slice(0, 24).every((x) => x < BN254_BASE_FIELD),
    "point coordinate range",
  );
  check(
    words.slice(24).every((x) => x < BN254_SCALAR_FIELD),
    "response scalar range",
  );
  const loaded = await Promise.all(keys.map((key) => loadKey(curve, key)));
  const c = challenge(keys, hiddenCount, words.slice(0, 24), inputs);
  check(c !== 0n, "zero Fiat-Shamir challenge");
  const sharedResponses = words.slice(24, 24 + hiddenCount);
  for (let i = 0; i < 2; i++) {
    const key = loaded[i];
    const u = checkedG1(curve, words.slice(16 + 2 * i, 18 + 2 * i));
    const t = checkedG1(curve, words.slice(20 + 2 * i, 22 + 2 * i));
    let response = msm(curve, key.points.slice(1, hiddenCount + 1), sharedResponses);
    response = curve.G1.add(response, multiply(curve, key.delta1, words[24 + hiddenCount + i]));
    response = curve.G1.add(response, multiply(curve, u, c));
    if (!curve.G1.eq(response, t)) return false;
    let prepared = curve.G1.add(key.points[0], u);
    if (i === 1)
      prepared = curve.G1.add(prepared, msm(curve, key.points.slice(hiddenCount + 1), inputs));
    if (!(await verifyPairing(curve, key, words.slice(i * 8, i * 8 + 8), prepared))) return false;
  }
  return true;
}

/** Verify the exact bytes accepted by the fixed Solidity LinkG16 verifier. */
export async function verifyLinkedGroth16Proof({ proof, issuer, presentation, publicInputs }) {
  try {
    const parameters = layouts(issuer, presentation, publicInputs);
    check(typeof proof === "string" && /^0x[0-9a-fA-F]*$/u.test(proof), "proof bytes");
    const bytes = getBytes(proof);
    check(bytes.length === 32 * (26 + parameters.hiddenCount), "composite proof length");
    const words = Array.from({ length: bytes.length / 32 }, (_, i) =>
      BigInt(
        `0x${Array.from(bytes.slice(i * 32, i * 32 + 32), (b) => b.toString(16).padStart(2, "0")).join("")}`,
      ),
    );
    return await withCurve((curve) => verifyWithCurve(curve, words, parameters));
  } catch {
    return false;
  }
}

/**
 * Link an existing issuer proof to a fresh Circom presentation without either
 * revealing the common fields or knowing the issuer's private witness.
 * Presentation public signals must be commonInputs followed by publicInputs.
 */
export async function linkGroth16Proofs({ issuer, presentation, commonInputs, publicInputs }) {
  const parameters = layouts(issuer, presentation, publicInputs);
  const { keys, inputs, hiddenCount } = parameters;
  check(Array.isArray(commonInputs) && commonInputs.length === hiddenCount, "common input layout");
  const common = commonInputs.map((x) => integer(x, BN254_SCALAR_FIELD, "common input"));
  const originals = [parseProof(issuer.proof), parseProof(presentation.proof)];
  return withCurve(async (curve) => {
    const loaded = await Promise.all(keys.map((key) => loadKey(curve, key)));
    for (let i = 0; i < 2; i++) {
      const allInputs = i === 0 ? common : [...common, ...inputs];
      const prepared = curve.G1.add(
        loaded[i].points[0],
        msm(curve, loaded[i].points.slice(1), allInputs),
      );
      check(
        await verifyPairing(curve, loaded[i], originals[i], prepared),
        "underlying proof does not verify",
      );
    }
    const blinders = loaded.map(() => randomScalar());
    const uPoints = loaded.map((key, i) =>
      curve.G1.add(
        msm(curve, key.points.slice(1, hiddenCount + 1), common),
        multiply(curve, key.delta1, blinders[i]),
      ),
    );
    const blindedProofs = loaded.map((key, i) => {
      const a = checkedG1(curve, originals[i].slice(0, 2));
      const b = checkedG2(curve, originals[i].slice(2, 6));
      const c = checkedG1(curve, originals[i].slice(6, 8));
      const r = randomScalar();
      const s = randomScalar();
      const aNew = multiply(curve, a, inverse(r));
      const bNew = curve.G2.add(
        curve.G2.timesScalar(b, r),
        curve.G2.timesScalar(key.delta2, mod(r * s)),
      );
      const cNew = curve.G1.sub(
        curve.G1.add(c, multiply(curve, a, s)),
        multiply(curve, curve.G1.one, blinders[i]),
      );
      return [...encodeG1(curve, aNew), ...encodeG2(curve, bNew), ...encodeG1(curve, cNew)];
    });
    let pointWords, sharedNonces, blindingNonces, c;
    do {
      sharedNonces = common.map(() => randomScalar());
      blindingNonces = loaded.map(() => randomScalar());
      const commitments = loaded.map((key, i) =>
        curve.G1.add(
          msm(curve, key.points.slice(1, hiddenCount + 1), sharedNonces),
          multiply(curve, key.delta1, blindingNonces[i]),
        ),
      );
      pointWords = [
        ...blindedProofs.flat(),
        ...uPoints.flatMap((point) => encodeG1(curve, point)),
        ...commitments.flatMap((point) => encodeG1(curve, point)),
      ];
      c = challenge(keys, hiddenCount, pointWords, inputs);
    } while (c === 0n);
    const words = [
      ...pointWords,
      ...sharedNonces.map((r, i) => mod(r - c * common[i])),
      ...blindingNonces.map((s, i) => mod(s - c * blinders[i])),
    ];
    check(
      await verifyWithCurve(curve, words, parameters),
      "generated composite proof does not verify",
    );
    return concat(words.map((word) => toBeHex(word, 32)));
  });
}
