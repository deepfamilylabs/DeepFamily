// Public synthetic scalars only. This sampler is diagnostic, never a security pass/fail gate.
const GENERATOR = Uint8Array.from(
  "e2f2ae0a6abc4e71a884a961c500515f58e30b6aa582dd8db6a65945e08d2d76b".match(/../gu),
  (byte) => Number.parseInt(byte, 16),
);

export async function verifyReceiveEncryptionVectors(vectors, api) {
  const decode = (value) =>
    Uint8Array.from(value.match(/../gu) ?? [], (byte) => Number.parseInt(byte, 16));
  const encode = (value) =>
    Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
  for (const vector of vectors) {
    const input = vector.input;
    const address = await api.deriveShieldedReceivePublicKey(
      decode(input.viewIkm),
      decode(input.diversifier),
    );
    const opened = await api.decryptShieldedReceivePayload({
      viewIkm: decode(input.viewIkm),
      ciphertext: decode(vector.expected.ciphertext),
      aad: decode(input.aad),
      info: decode(input.info),
    });
    if (
      encode(address) !== vector.expected.recipientPublicKey ||
      encode(opened.recipientPublicKey) !== vector.expected.recipientPublicKey ||
      encode(opened.plaintext) !== input.plaintext
    )
      throw new Error("Frozen receive vector mismatch");
  }
  return vectors.length;
}

function summary(name, values) {
  const n = values.length;
  const mean = values.reduce((total, value) => total + value, 0) / n;
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / (n - 1);
  return { name, n, meanUs: mean, standardDeviationUs: Math.sqrt(variance), variance };
}

export async function sampleReceiveEncryptionTiming(backend, { samples = 1000, batch = 16 } = {}) {
  if (
    !Number.isSafeInteger(samples) ||
    samples < 20 ||
    samples > 100_000 ||
    !Number.isSafeInteger(batch) ||
    batch < 1 ||
    batch > 1024
  ) {
    throw new Error("Use 20..100000 samples and 1..1024 operations per batch");
  }
  const small = new Uint8Array(32);
  small[0] = 1;
  const sparse = new Uint8Array(32);
  sparse[31] = 8;
  const dense = new Uint8Array(32).fill(255);
  dense[31] = 7;
  const random = globalThis.crypto.getRandomValues(new Uint8Array(32));
  random[31] = (random[31] & 7) | 8;
  const classes = [
    { name: "small", scalar: small, values: [] },
    { name: "full-width-sparse", scalar: sparse, values: [] },
    { name: "full-width-dense", scalar: dense, values: [] },
    { name: "full-width-random", scalar: random, values: [] },
  ];
  // Prepare the randomized order outside the measured regions.
  const order = new Uint8Array(samples);
  for (let offset = 0; offset < order.length; offset += 65536) {
    globalThis.crypto.getRandomValues(order.subarray(offset, offset + 65536));
  }
  let checksum = 0;
  const run = (entry) => {
    const begin = performance.now();
    for (let repeat = 0; repeat < batch; repeat++) {
      const result = backend.multiply(entry.scalar, GENERATOR);
      checksum ^= result[0];
    }
    return ((performance.now() - begin) * 1000) / batch;
  };
  for (let warmup = 0; warmup < 160; warmup++) run(classes[warmup % classes.length]);
  for (let sample = 0; sample < samples; sample++) {
    const start = order[sample] % classes.length;
    const direction = (order[sample] & 4) === 0 ? 1 : -1;
    for (let step = 0; step < classes.length; step++) {
      const index = (start + direction * step + classes.length) % classes.length;
      classes[index].values.push(run(classes[index]));
    }
  }
  const statistics = classes.map((entry) => summary(entry.name, entry.values));
  const comparisons = [];
  for (let left = 0; left < statistics.length; left++) {
    for (let right = left + 1; right < statistics.length; right++) {
      const a = statistics[left],
        b = statistics[right];
      const denominator = Math.sqrt(a.variance / a.n + b.variance / b.n);
      comparisons.push({
        left: a.name,
        right: b.name,
        welchT: denominator === 0 ? null : (a.meanUs - b.meanUs) / denominator,
      });
    }
  }
  return {
    warning: "Descriptive timing sample; neither a constant-time proof nor a key-extraction test.",
    implementation: backend.implementation,
    execution: backend.execution,
    samplesPerClass: samples,
    operationsPerBatch: batch,
    statistics: statistics.map(({ variance, ...entry }) => entry),
    comparisons,
    checksum,
  };
}
