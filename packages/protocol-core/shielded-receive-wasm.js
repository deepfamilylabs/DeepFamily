import { ProtocolError, protocolAssert } from "./errors.js";

const REQUIRED_EXPORTS = [
  "_sodium_init",
  "_malloc",
  "_free",
  "_crypto_core_ristretto255_scalar_reduce",
  "_crypto_core_ristretto255_from_hash",
  "_crypto_scalarmult_ristretto255",
];
const BACKEND_ERROR = "SHIELDED_RECEIVE_WASM_UNAVAILABLE";
let backendPromise;

function unavailable() {
  return new ProtocolError(
    BACKEND_ERROR,
    "The receive encryption WebAssembly backend is unavailable",
  );
}

/** Internal runtime check. Ordinary JavaScript/asm.js functions cannot enter a funcref table. */
export function assertReceiveWasmExports(module) {
  try {
    const table = new WebAssembly.Table({ element: "anyfunc", initial: 1 });
    for (const name of REQUIRED_EXPORTS) {
      protocolAssert(typeof module[name] === "function", BACKEND_ERROR, "Missing WASM export");
      table.set(0, module[name]);
    }
    protocolAssert(module.HEAPU8 instanceof Uint8Array, BACKEND_ERROR, "Missing WASM memory");
  } catch {
    throw unavailable();
  }
}

function createBackend(module) {
  function operation(inputs, invoke) {
    const allocations = [];
    const allocate = (length) => {
      const pointer = module._malloc(length);
      protocolAssert(
        Number.isSafeInteger(pointer) && pointer > 0 && pointer + length <= module.HEAPU8.length,
        "SHIELDED_RECEIVE_WASM_OPERATION_FAILED",
        "Receive encryption memory allocation failed",
      );
      allocations.push({ pointer, length });
      return pointer;
    };
    try {
      const result = allocate(32);
      const pointers = inputs.map((input) => {
        const pointer = allocate(input.length);
        module.HEAPU8.set(input, pointer);
        return pointer;
      });
      const status = invoke(result, ...pointers);
      protocolAssert(
        status === undefined || status === 0,
        "SHIELDED_RECEIVE_WASM_OPERATION_FAILED",
        "Receive encryption curve operation failed",
      );
      return module.HEAPU8.slice(result, result + 32);
    } finally {
      for (let index = allocations.length - 1; index >= 0; index--) {
        const { pointer, length } = allocations[index];
        // Clear both secret inputs and results before returning these allocations to the heap.
        module.HEAPU8.fill(0, pointer, pointer + length);
        module._free(pointer);
      }
    }
  }

  function bytes(input, length) {
    protocolAssert(
      input instanceof Uint8Array && input.length === length,
      "SHIELDED_RECEIVE_WASM_OPERATION_FAILED",
      "Invalid receive encryption operand",
    );
    return input;
  }

  return Object.freeze({
    implementation: "libsodium-sumo@0.8.4",
    execution: "webassembly",
    reduceScalar(wide) {
      return operation([bytes(wide, 64)], (out, input) => {
        module._crypto_core_ristretto255_scalar_reduce(out, input);
      });
    },
    hashToGroup(uniform) {
      return operation([bytes(uniform, 64)], (out, input) =>
        module._crypto_core_ristretto255_from_hash(out, input),
      );
    },
    multiply(scalar, point) {
      return operation([bytes(scalar, 32), bytes(point, 32)], (out, key, input) =>
        module._crypto_scalarmult_ristretto255(out, key, input),
      );
    },
  });
}

/** Lazily initialize the pinned WASM-only factory before accepting any secret operands. */
export async function getReceiveWasmBackend() {
  if (
    typeof globalThis.WebAssembly?.instantiate !== "function" ||
    typeof globalThis.WebAssembly?.Table !== "function"
  ) {
    throw unavailable();
  }
  if (!backendPromise) {
    backendPromise = (async () => {
      try {
        // Version 0.8.4's raw factory contains WASM only; no wrapper/asm.js fallback is imported.
        const { default: createSodium } = await import("libsodium-sumo");
        const module = await createSodium({
          print: () => {},
          printErr: () => {},
          getRandomValue() {
            const word = new Uint32Array(1);
            globalThis.crypto.getRandomValues(word);
            const value = word[0];
            word.fill(0);
            return value;
          },
        });
        assertReceiveWasmExports(module);
        protocolAssert(module._sodium_init() >= 0, BACKEND_ERROR, "WASM initialization failed");
        return createBackend(module);
      } catch {
        throw unavailable();
      }
    })();
  }
  return backendPromise;
}
