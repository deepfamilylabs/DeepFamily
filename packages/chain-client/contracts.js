import { Contract } from "ethers";
import { normalizeChainError } from "./errors.js";
import { operationForFailure } from "./internal.js";

const instrumented = new WeakMap();
const readMethods = new Set(["getAddress", "getDeployedCode", "queryFilter", "queryTransaction"]);

function operationFor(method, args) {
  try {
    const fragment = method.getFragment(...args);
    return fragment.constant || fragment.stateMutability === "view" || fragment.stateMutability === "pure" ? "read" : "submit";
  } catch { return "submit"; }
}

function guardedCall(method, thisArg, args, operation) {
  try {
    const result = Reflect.apply(method, thisArg, args);
    return result && typeof result.then === "function"
      ? result.catch((error) => { throw normalizeChainError(error, { operation: operationForFailure(error, operation) }); }) : result;
  } catch (error) { throw normalizeChainError(error, { operation: operationForFailure(error, operation) }); }
}

/** Preserve ethers Contract APIs and identity while normalizing failures at the RPC boundary. */
export function instrumentChainContract(contract) {
  if (instrumented.has(contract)) return instrumented.get(contract);
  const methods = new WeakMap();
  const wrapMethod = (method) => {
    if (methods.has(method)) return methods.get(method);
    const callable = (...args) => guardedCall(method, undefined, args, operationFor(method, args));
    const proxy = new Proxy(callable, {
      get(_target, key) {
        const value = Reflect.get(method, key, method);
        if (typeof value !== "function") return value;
        const operation = key === "estimateGas" ? "estimate" :
          key === "staticCall" || key === "staticCallResult" ? "read" : key === "send" ? "submit" : undefined;
        return operation ? (...args) => guardedCall(value, method, args, operation) : value;
      },
    });
    methods.set(method, proxy);
    return proxy;
  };
  const proxy = new Proxy(contract, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      // Do not violate non-configurable own properties such as interface and runner.
      const own = Object.getOwnPropertyDescriptor(target, key);
      if (own && !own.configurable && "value" in own && !own.writable) return value;
      if (key === "connect" || key === "attach") return (...args) => instrumentChainContract(Reflect.apply(value, target, args));
      if (key === "getFunction") return (...args) => wrapMethod(Reflect.apply(value, target, args));
      if (typeof value === "function" && typeof value.getFragment === "function" && typeof value.estimateGas === "function") return wrapMethod(value);
      if (readMethods.has(key) && typeof value === "function") return (...args) => guardedCall(value, target, args, "read");
      return value;
    },
  });
  instrumented.set(contract, proxy);
  instrumented.set(proxy, proxy);
  return proxy;
}

export function createChainContract(address, abi, runner) {
  return instrumentChainContract(new Contract(address, abi, runner));
}
