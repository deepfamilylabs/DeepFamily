import { Mnemonic, getBytes, wordlists } from "ethers";
import { bytesToHex, copyBytes, wipeBytes } from "./bytes.js";
import { ProtocolError } from "./errors.js";

const MAX_MNEMONIC_INPUT_LENGTH = 1024;
const ENGLISH_WORDLIST = wordlists.en;

function rootBytes(value) {
  let root;
  try {
    root = copyBytes(value, "assetRoot");
    if (root.length === 32) return root;
  } catch {
    // Do not propagate a library error containing the supplied secret.
  }
  wipeBytes(root);
  throw new ProtocolError("INVALID_ASSET_ROOT", "Asset root must be 32 bytes");
}

/**
 * BIP39 English entropy encoding only: no seed, wallet path or extra password.
 * All 32-byte roots, including zero, retain their exact original bytes.
 */
export function encodeShieldedAssetMnemonic(assetRoot) {
  const root = rootBytes(assetRoot);
  try {
    return Mnemonic.entropyToPhrase(root, ENGLISH_WORDLIST);
  } catch {
    throw new ProtocolError("INVALID_ASSET_MNEMONIC", "Could not encode asset recovery words");
  } finally {
    wipeBytes(root);
  }
}

/**
 * Accept exactly 24 English words with a valid BIP39 checksum. ASCII case and
 * whitespace (space, tab, LF, VT, FF, CR) are normalized. Non-ASCII text is
 * rejected before normalization; accepted English text is already NFKD-stable.
 */
export function decodeShieldedAssetMnemonic(mnemonic) {
  try {
    if (
      typeof mnemonic !== "string" ||
      mnemonic.length > MAX_MNEMONIC_INPUT_LENGTH ||
      !/^[A-Za-z \t\n\v\f\r]+$/.test(mnemonic)
    ) {
      throw new Error();
    }
    const words = mnemonic
      .toLowerCase()
      .trim()
      .split(/[ \t\n\v\f\r]+/);
    if (words.length !== 24) throw new Error();
    // phraseToEntropy validates word membership and the full 8-bit checksum.
    // Never use computeSeed, Wallet.fromPhrase or any wallet derivation here.
    return getBytes(Mnemonic.phraseToEntropy(words.join(" "), ENGLISH_WORDLIST));
  } catch {
    throw new ProtocolError(
      "INVALID_ASSET_MNEMONIC",
      "Expected 24 valid English asset recovery words",
    );
  }
}

/** Canonical lowercase 0x-prefixed representation of the complete asset root. */
export function encodeShieldedAssetKey(assetRoot) {
  const root = rootBytes(assetRoot);
  try {
    return bytesToHex(root);
  } finally {
    wipeBytes(root);
  }
}

/** Import the complete root, not the separately derived spend secret. */
export function decodeShieldedAssetKey(shieldedKey) {
  if (
    typeof shieldedKey !== "string" ||
    shieldedKey.length !== 66 ||
    !/^0x[0-9a-fA-F]{64}$/.test(shieldedKey)
  ) {
    throw new ProtocolError("INVALID_ASSET_KEY", "Expected a 32-byte 0x-prefixed Shielded Key");
  }
  try {
    return getBytes(shieldedKey);
  } catch {
    throw new ProtocolError("INVALID_ASSET_KEY", "Expected a 32-byte 0x-prefixed Shielded Key");
  }
}
