#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import {
  SHIELDED_POOL_ACTION,
  SHIELDED_POOL_SIGNAL_SEGMENTS,
  SHIELDED_POOL_PUBLIC_INPUTS,
  SHIELDED_POOL_INPUT_WIDTHS,
  SHIELDED_BUSINESS_CIRCUIT_LAYOUTS,
} from "../packages/protocol-core/shielded-signal-layout.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const GENERATOR = "scripts/generate-shielded-signal-layout.mjs";
const CONSTANTS = "contracts/libraries/ProofConstants.sol";
const CORE = "contracts/shielded/ShieldedPoolCore.sol";
const ADAPTER = "contracts/adapters/Groth16VerifierAdapter.sol";
const LENGTH_START = "  // BEGIN GENERATED SHIELDED SIGNAL LENGTHS";
const LENGTH_END = "  // END GENERATED SHIELDED SIGNAL LENGTHS";
const SIGNAL_START = "  // BEGIN GENERATED SHIELDED PUBLIC SIGNALS";
const SIGNAL_END = "  // END GENERATED SHIELDED PUBLIC SIGNALS";

export const DEFAULT_SHIELDED_SIGNAL_LAYOUT = Object.freeze({
  actions: SHIELDED_POOL_ACTION,
  segments: SHIELDED_POOL_SIGNAL_SEGMENTS,
  fields: SHIELDED_POOL_PUBLIC_INPUTS,
  widths: SHIELDED_POOL_INPUT_WIDTHS,
  variants: SHIELDED_BUSINESS_CIRCUIT_LAYOUTS,
});

// These expressions bind schema field names to the pool's business data, not their order.
const SCALARS = Object.freeze({
  chainId: "block.chainid",
  pool: "uint256(uint160(address(this)))",
  fundMode: "data.fundMode",
  budgetKind: "data.budgetKind",
  amount: "amount",
  recipient: "uint256(uint160(recipient))",
  endorsementRoot: "data.relation0",
  trustedRoot: "data.relation1",
  asOf: "data.asOf",
});
const ARRAYS = Object.freeze({
  inputRoots: "data.inputRoots[i]",
  inputNullifiers: "data.inputNullifiers[i]",
  periodNullifiers: "data.periodNullifiers[i]",
  outputCommitments: "data.outputCommitments[i]",
  ciphertextHashes: "uint256(keccak256(data.outputCiphertexts[i])) % SNARK_SCALAR_FIELD",
  receiveBindings: "data.receiveAuthorizations[i].recipientBinding",
  publicBudget: "budget[i]",
});

function invariant(condition, message) {
  if (!condition) throw new Error(`Shielded signal layout: ${message}`);
}

function signalCount(layout, variant) {
  return layout.fields[variant.action].reduce(
    (sum, field) =>
      sum +
      (["inputRoots", "inputNullifiers"].includes(field)
        ? variant.inputSlots
        : layout.widths[field]),
    0,
  );
}

function validateLayout(layout) {
  invariant(Object.keys(layout.actions).length === 5, "expected the five pool actions");
  invariant(layout.variants.length === 8, "expected all eight business circuit variants");
  const circuits = new Set();
  for (const [name, action] of Object.entries(layout.actions)) {
    invariant(/^[A-Z][A-Za-z]+$/u.test(name) && Number.isSafeInteger(action), "invalid action");
    const fields = layout.fields[action];
    invariant(Array.isArray(fields) && fields.length > 0, `${name} has no fields`);
    invariant(new Set(fields).size === fields.length, `${name} contains duplicate fields`);
    for (const field of fields) {
      invariant(
        Object.hasOwn(SCALARS, field) || Object.hasOwn(ARRAYS, field),
        `unknown field ${field}`,
      );
      if (["inputRoots", "inputNullifiers"].includes(field)) {
        // Shield's transaction slots are placeholders; _inputCount returns zero for its proof.
        invariant(action !== layout.actions.Shield, `${name} cannot expose note input fields`);
        invariant(
          layout.widths[field] === "inputSlots",
          `${field} must use its variant input width`,
        );
      } else {
        invariant(
          Number.isSafeInteger(layout.widths[field]) && layout.widths[field] > 0,
          `invalid width for ${field}`,
        );
      }
      if (Object.hasOwn(SCALARS, field))
        invariant(layout.widths[field] === 1, `${field} must be scalar`);
    }
    invariant(
      layout.variants.some((variant) => variant.action === action),
      `${name} has no circuit`,
    );
  }
  for (const variant of layout.variants) {
    invariant(
      layout.actions[variant.actionName] === variant.action,
      `invalid action for ${variant.circuit}`,
    );
    invariant(
      /^[a-z0-9_]+$/u.test(variant.circuit) && !circuits.has(variant.circuit),
      "invalid or duplicate circuit",
    );
    invariant([1, 2, 4].includes(variant.inputSlots), `invalid slots for ${variant.circuit}`);
    invariant(
      /^SHIELDED_[A-Z0-9_]+_PUBLIC_SIGNALS_LEN$/u.test(variant.constant),
      "invalid length constant",
    );
    circuits.add(variant.circuit);
  }
  // Both VALUE actions currently expose the same single/four-input client width table.
  for (const slots of [1, 4]) {
    const valueVariants = layout.variants.filter(
      (variant) =>
        [layout.actions.PrivateTransfer, layout.actions.Unshield].includes(variant.action) &&
        variant.inputSlots === slots,
    );
    invariant(valueVariants.length === 2, `missing ${slots}-input VALUE variant`);
    invariant(
      signalCount(layout, valueVariants[0]) === signalCount(layout, valueVariants[1]),
      "VALUE actions require separate width tables",
    );
  }
}

function validateSegments(layout) {
  invariant(
    Array.isArray(layout.segments) && layout.segments.length > 0,
    "missing signal segments",
  );
  const actions = Object.values(layout.actions);
  for (const segment of layout.segments) {
    invariant(
      Array.isArray(segment.actions) &&
        segment.actions.length > 0 &&
        segment.actions.every((action) => actions.includes(action)),
      "segment contains invalid actions",
    );
    invariant(
      new Set(segment.actions).size === segment.actions.length,
      "segment contains duplicate actions",
    );
    invariant(
      Array.isArray(segment.fields) &&
        segment.fields.length > 0 &&
        segment.fields.every(
          (field) => Object.hasOwn(SCALARS, field) || Object.hasOwn(ARRAYS, field),
        ),
      "segment contains invalid fields",
    );
    invariant(
      new Set(segment.fields).size === segment.fields.length,
      "segment contains duplicate fields",
    );
  }
  for (const action of actions) {
    const fields = layout.segments
      .filter((segment) => segment.actions.includes(action))
      .flatMap((segment) => segment.fields);
    invariant(
      new Set(fields).size === fields.length,
      "segments contain duplicate fields for an action",
    );
    invariant(
      fields.length === layout.fields[action].length &&
        fields.every((field, index) => field === layout.fields[action][index]),
      "segment field order differs from schema",
    );
  }
}

const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
const compact = (source) => source.replace(/\s+/gu, "");

// The adapter's fixed-array ABI cannot be generated by changing a length constant alone.
// Recognize its deliberately limited dispatch shape and fail if either its ABI or routing drifts.
async function verifyAdapterWidths(root, layout) {
  const source = withoutComments(await fs.readFile(path.join(root, ADAPTER), "utf8"));
  const expectedWidths = new Set(layout.variants.map((variant) => signalCount(layout, variant)));
  const interfaces = new Set();
  for (const match of source.matchAll(/interface\s+IGroth16Verifier(\d+)\s*\{([^}]+)\}/gu)) {
    const width = Number(match[1]);
    invariant(!interfaces.has(width), `duplicate adapter interface width ${width}`);
    const expected = `function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b,
      uint256[2] calldata c, uint256[${width}] calldata publicSignals) external view returns (bool);`;
    invariant(
      compact(match[2]) === compact(expected),
      `adapter ABI width ${width} differs from schema`,
    );
    interfaces.add(width);
  }
  assert.deepEqual(interfaces, expectedWidths, "adapter interface widths differ from schema");

  const declaration = /function\s+_verifyShieldedAction\s*\([^)]*\)[^{]+\{/u.exec(source);
  invariant(declaration, "missing adapter shielded dispatch");
  const start = declaration.index + declaration[0].length;
  let end = start;
  let depth = 1;
  while (depth > 0 && end < source.length) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
    end++;
  }
  invariant(depth === 0, "unterminated adapter shielded dispatch");
  let body = compact(source.slice(start, end - 1));
  const prefix = "uint256length=publicSignals.length;";
  invariant(body.startsWith(prefix), "unsupported adapter shielded dispatch");
  body = body.slice(prefix.length);
  const routedWidths = new Set();
  const dispatch = (width) =>
    compact(`uint256[${width}] memory signals${width};
    for (uint256 i = 0; i < length; ++i) signals${width}[i] = publicSignals[i];
    return IGroth16Verifier${width}(verifier).verifyProof(a, b, c, signals${width});`);
  for (let branch; (branch = /^if\(length==(\d+)\)\{([^{}]+)\}/u.exec(body)); ) {
    const width = Number(branch[1]);
    invariant(!routedWidths.has(width), `duplicate adapter dispatch width ${width}`);
    invariant(branch[2] === dispatch(width), `adapter dispatch width ${width} differs from schema`);
    routedWidths.add(width);
    body = body.slice(branch[0].length);
  }
  const claimWidths = new Set(
    layout.variants
      .filter((variant) => variant.action === layout.actions.Claim)
      .map((variant) => signalCount(layout, variant)),
  );
  invariant(claimWidths.size === 1, "Claim variants need one adapter fallback width");
  const [fallback] = claimWidths;
  invariant(
    body === dispatch(fallback),
    `adapter fallback width differs from schema (${fallback})`,
  );
  invariant(!routedWidths.has(fallback), "adapter fallback is also an explicit route");
  routedWidths.add(fallback);
  assert.deepEqual(routedWidths, expectedWidths, "adapter dispatch widths differ from schema");
}

async function findTemplate(file, name, visited = new Set()) {
  if (visited.has(file)) return null;
  visited.add(file);
  const source = withoutComments(await fs.readFile(file, "utf8"));
  const declaration = new RegExp(`template\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`, "u").exec(source);
  if (declaration) {
    const start = declaration.index + declaration[0].length;
    let end = start;
    let depth = 1;
    while (depth > 0 && end < source.length) {
      if (source[end] === "{") depth++;
      if (source[end] === "}") depth--;
      end++;
    }
    invariant(depth === 0, `unterminated template ${name}`);
    return {
      parameters: declaration[1]
        .split(",")
        .map((parameter) => parameter.trim())
        .filter(Boolean),
      body: source.slice(start, end - 1),
    };
  }
  for (const include of source.matchAll(/include\s+"([^"]+)"\s*;/gu)) {
    const included = path.resolve(path.dirname(file), include[1]);
    try {
      await fs.access(included);
    } catch {
      continue; // External library includes cannot declare these application templates.
    }
    const result = await findTemplate(included, name, visited);
    if (result) return result;
  }
  return null;
}

export async function verifyShieldedCircuitLayouts({
  root = ROOT,
  layout = DEFAULT_SHIELDED_SIGNAL_LAYOUT,
} = {}) {
  validateLayout(layout);
  const poolSource = withoutComments(await fs.readFile(path.join(root, CORE), "utf8"));
  const actionEnum = /enum\s+Action\s*\{([^}]+)\}/u.exec(poolSource);
  invariant(actionEnum, "missing Solidity Action enum");
  const actions = Object.fromEntries(
    actionEnum[1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name, index) => [name, index]),
  );
  assert.deepEqual(layout.actions, actions, "Solidity Action enum differs from schema");
  for (const variant of layout.variants) {
    const file = path.join(root, "circuits/shielded", `${variant.circuit}.circom`);
    const source = withoutComments(await fs.readFile(file, "utf8"));
    const main =
      /component\s+main\s*\{\s*public\s*\[([^\]]+)\]\s*\}\s*=\s*([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*;/u.exec(
        source,
      );
    invariant(main, `${variant.circuit} has no supported public main declaration`);
    const fields = main[1]
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
    invariant(
      new Set(fields).size === fields.length,
      `${variant.circuit} contains duplicate public fields`,
    );
    assert.deepEqual(
      new Set(fields),
      new Set(layout.fields[variant.action]),
      `${variant.circuit} public fields differ from schema`,
    );
    const template = await findTemplate(file, main[2]);
    invariant(template, `missing template ${main[2]}`);
    invariant(
      !/\bsignal\s+output\b/u.test(template.body),
      `${variant.circuit} main template outputs are unsupported public signals`,
    );
    const arguments_ = main[3]
      .split(",")
      .map((argument) => argument.trim())
      .filter(Boolean);
    invariant(
      template.parameters.length === arguments_.length &&
        arguments_.every((argument) => /^\d+$/u.test(argument)),
      `unsupported arguments for ${main[2]}`,
    );
    const parameters = Object.fromEntries(
      template.parameters.map((name, index) => [name, Number(arguments_[index])]),
    );
    const declarations = [];
    for (const field of fields) {
      const declaration = new RegExp(
        `signal\\s+input\\s+${field}\\s*((?:\\[[^\\]]+\\]\\s*)*);`,
        "u",
      ).exec(template.body);
      invariant(declaration, `${variant.circuit} missing input ${field}`);
      declarations.push({ field, position: declaration.index });
      let actualWidth = 1;
      for (const dimension of declaration[1].matchAll(/\[([^\]]+)\]/gu)) {
        const expression = dimension[1].trim();
        const value = /^\d+$/u.test(expression) ? Number(expression) : parameters[expression];
        invariant(Number.isSafeInteger(value) && value > 0, `unsupported width for ${field}`);
        actualWidth *= value;
      }
      const expectedWidth = ["inputRoots", "inputNullifiers"].includes(field)
        ? variant.inputSlots
        : layout.widths[field];
      invariant(
        actualWidth === expectedWidth,
        `${variant.circuit} ${field} width differs from schema`,
      );
    }
    // Circom orders public inputs by template declaration, not by the main public list.
    // Private input declarations do not affect the relative order of the public inputs.
    assert.deepEqual(
      declarations.sort((a, b) => a.position - b.position).map(({ field }) => field),
      layout.fields[variant.action],
      `${variant.circuit} public field order differs from schema (template declarations)`,
    );
  }
  await verifyAdapterWidths(root, layout);
  validateSegments(layout);
}

function renderLengths(layout) {
  const lengths = new Map();
  for (const variant of layout.variants) {
    const count = signalCount(layout, variant);
    invariant(
      !lengths.has(variant.constant) || lengths.get(variant.constant) === count,
      `inconsistent ${variant.constant}`,
    );
    lengths.set(variant.constant, count);
  }
  return [
    LENGTH_START,
    `  // Generated by ${GENERATOR}; do not edit.`,
    ...[...lengths].map(([name, count]) => `  uint256 internal constant ${name} = ${count};`),
    LENGTH_END,
  ].join("\n");
}

function segmentCondition(layout, segment) {
  const actions = Object.entries(layout.actions);
  if (segment.actions.length === actions.length) return null;
  if (segment.actions.length === actions.length - 1) {
    const [excluded] = actions.find(([, action]) => !segment.actions.includes(action));
    return `action != Action.${excluded}`;
  }
  return actions
    .filter(([, action]) => segment.actions.includes(action))
    .map(([name]) => `action == Action.${name}`)
    .join(" || ");
}

function renderSignals(layout) {
  let commonWidth = 0;
  const conditionalWidths = [];
  for (const segment of layout.segments) {
    let fixed = 0;
    let variable = 0;
    for (const field of segment.fields) {
      if (layout.widths[field] === "inputSlots") variable++;
      else fixed += layout.widths[field];
    }
    const condition = segmentCondition(layout, segment);
    if (!condition && !variable) commonWidth += fixed;
    else {
      const width = [fixed || null, variable ? `${variable} * inputs` : null]
        .filter(Boolean)
        .join(" + ");
      conditionalWidths.push(condition ? `(${condition} ? ${width} : 0)` : width);
    }
  }
  const lines = [
    SIGNAL_START,
    "  /**",
    `   * @dev Generated by ${GENERATOR}; do not edit.`,
    "   *      Field order and widths come from shielded-signal-layout.js and are checked against Circom.",
    "   *      Shard IDs select accepted roots outside the proof; spend nullifiers remain global.",
    "   */",
    "  function _publicSignals(",
    "    Action action,",
    "    ActionData calldata data,",
    "    uint256 amount,",
    "    address recipient",
    "  ) private view returns (uint256[] memory signals) {",
    "    uint256 inputs = _inputCount(action, data.inputNullifiers.length);",
    `    signals = new uint256[](${[commonWidth, ...conditionalWidths].join(" + ")});`,
    "    uint256 n;",
  ];
  for (const segment of layout.segments) {
    const condition = segmentCondition(layout, segment);
    if (condition) lines.push(`    if (${condition}) {`);
    const indent = condition ? "      " : "    ";
    for (const field of segment.fields) {
      if (Object.hasOwn(SCALARS, field)) {
        lines.push(`${indent}signals[n++] = ${SCALARS[field]};`);
        continue;
      }
      if (field === "publicBudget") {
        const width = layout.widths[field];
        lines.push(
          `${indent}uint256[${width}] memory budget = data.budgetKind == 1`,
          `${indent}  ? _publicBudgetFields(data.outputCiphertexts[0])`,
          `${indent}  : [${Array.from({ length: width }, (_, index) => (index === 0 ? "uint256(0)" : "0")).join(", ")}];`,
        );
      }
      const width = layout.widths[field] === "inputSlots" ? "inputs" : layout.widths[field];
      lines.push(`${indent}for (uint256 i; i < ${width}; ++i) signals[n++] = ${ARRAYS[field]};`);
    }
    if (condition) lines.push("    }");
  }
  lines.push("  }", SIGNAL_END);
  return lines.join("\n");
}

function replaceRegion(source, start, end, generated) {
  const first = source.indexOf(start);
  const last = source.indexOf(end);
  invariant(
    first >= 0 &&
      last > first &&
      source.indexOf(start, first + start.length) === -1 &&
      source.indexOf(end, last + end.length) === -1,
    `missing or duplicate generation markers: ${start.trim()}`,
  );
  return source.slice(0, first) + generated + source.slice(last + end.length);
}

export async function synchronizeShieldedSignalLayout({
  root = ROOT,
  check = false,
  layout = DEFAULT_SHIELDED_SIGNAL_LAYOUT,
} = {}) {
  await verifyShieldedCircuitLayouts({ root, layout });
  const outputs = [
    [CONSTANTS, LENGTH_START, LENGTH_END, renderLengths(layout)],
    [CORE, SIGNAL_START, SIGNAL_END, renderSignals(layout)],
  ];
  const expected = [];
  for (const [file, start, end, generated] of outputs) {
    const fullPath = path.join(root, file);
    const current = await fs.readFile(fullPath, "utf8");
    // Format only the generated region, preserving unrelated hand-written code.
    const wrapped = await format(`contract Generated {\n${generated}\n}\n`, {
      parser: "solidity-parse",
      plugins: ["prettier-plugin-solidity"],
      printWidth: 100,
      tabWidth: 2,
    });
    const formatted = wrapped.slice(wrapped.indexOf("\n") + 1, wrapped.lastIndexOf("\n}"));
    const next = replaceRegion(current, start, end, formatted);
    if (check)
      invariant(current === next, `${file} generated output is stale; run node ${GENERATOR}`);
    expected.push([fullPath, next]);
  }
  if (!check) {
    for (const [file, source] of expected) await fs.writeFile(file, source);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const arguments_ = process.argv.slice(2);
    invariant(
      arguments_.length === 0 || (arguments_.length === 1 && arguments_[0] === "--check"),
      `usage: node ${GENERATOR} [--check]`,
    );
    await synchronizeShieldedSignalLayout({ check: arguments_[0] === "--check" });
    console.log(
      `Shielded signal layout ${arguments_[0] === "--check" ? "verified" : "generated"} for eight business circuits`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
