/**
 * Secure Key Derivation from PersonHash
 *
 * 利用现有的 PersonHash 计算结果，通过 KDF 强化生成安全私钥
 * 保持向后兼容，但为密钥派生场景提供额外安全层
 */

import { scrypt } from 'scrypt-js';
import { ethers } from 'ethers';
import type { HashForm } from '../components/PersonHashCalculator';
import { computePersonHash } from '../components/PersonHashCalculator';
import { validatePassphraseStrength as validatePassphraseStrengthUtil } from './passphraseStrength';
import type { PassphraseStrength } from './passphraseStrength';

/**
 * KDF parameter configurations
 */
export const KDF_PRESETS = {
  // Fast mode (development/testing) - ~150ms
  FAST: {
    N: 16384,   // 2^14
    r: 8,
    p: 1,
    dkLen: 32,
  },
  // Balanced mode (recommended) - ~1-2 seconds
  BALANCED: {
    N: 131072,  // 2^17
    r: 8,
    p: 1,
    dkLen: 32,
  },
  // Strong security mode - ~3-5 seconds
  STRONG: {
    N: 262144,  // 2^18
    r: 8,
    p: 1,
    dkLen: 32,
  },
} as const;

export type KDFPreset = keyof typeof KDF_PRESETS;

/**
 * Purpose identifiers (salt prefix)
 */
export const PURPOSE = {
  IDENTITY: 'DeepFamily-Identity-v1',
  PRIVATE_KEY: 'DeepFamily-PrivateKey-v1',
  ENCRYPTION: 'DeepFamily-Encryption-v1',
} as const;

export type KeyPurpose = keyof typeof PURPOSE;

/**
 * Derived key result
 */
export interface DerivedKey {
  // Derived key (0x... format)
  key: string;
  // Corresponding Ethereum address (if used as private key)
  address?: string;
  // Derivation timestamp
  timestamp: number;
  // KDF parameters used
  kdfParams: {
    N: number;
    r: number;
    p: number;
  };
  // Purpose identifier
  purpose: string;
}

/**
 * Derive secure key directly from HashForm input
 *
 * Flow:
 * 1. Compute PersonHash (original logic)
 * 2. Apply scrypt KDF strengthening
 * 3. Return derived key + Ethereum address
 *
 * @param input - Form data from PersonHashCalculator
 * @param purpose - Key purpose (affects salt)
 * @param preset - KDF strength preset
 * @param onProgress - Progress callback (optional)
 * @returns Promise<DerivedKey>
 *
 * @example
 * const formData = {
 *   fullName: "John Smith",
 *   birthYear: 1990,
 *   birthMonth: 5,
 *   birthDay: 15,
 *   gender: 1,
 *   isBirthBC: false,
 *   passphrase: "MyStrong🌸Passphrase🐦2024"
 * };
 *
 * const result = await deriveKeyFromPersonData(formData, 'PRIVATE_KEY', 'BALANCED');
 * console.log('Private key:', result.key);
 * console.log('Address:', result.address);
 */
export async function deriveKeyFromPersonData(
  input: HashForm,
  purpose: KeyPurpose = 'PRIVATE_KEY',
  preset: KDFPreset = 'BALANCED',
  onProgress?: (progress: number, stage: string) => void
): Promise<DerivedKey> {
  const startTime = Date.now();

  // Phase 1: Compute base PersonHash (original logic)
  onProgress?.(0, 'Computing PersonHash...');
  const baseHash = computePersonHash(input);
  onProgress?.(20, 'PersonHash computed');

  // Phase 2: Prepare KDF input
  onProgress?.(25, 'Preparing KDF...');
  const kdfParams = KDF_PRESETS[preset];
  const purposeSalt = PURPOSE[purpose];

  // Construct salt: purpose identifier + personal info + passphrase hash
  // Important: Salt must include passphrase to prevent attacker precomputation
  // Even if personHash is leaked, cannot reproduce salt without correct passphrase
  const passphraseHash = input.passphrase
    ? ethers.keccak256(ethers.toUtf8Bytes(input.passphrase))
    : ethers.ZeroHash;

  const saltComponents = [
    purposeSalt,
    input.fullName,
    `${input.birthYear}-${input.birthMonth}-${input.birthDay}`,
    input.gender.toString(),
    passphraseHash, // 🔒 Critical: includes passphrase hash
  ].join(':');

  const saltHash = ethers.keccak256(ethers.toUtf8Bytes(saltComponents));
  const baseHashBytes = ethers.getBytes(baseHash);
  const saltBytes = ethers.getBytes(saltHash);

  // Phase 3: Execute scrypt KDF (time-consuming operation with simulated progress)
  onProgress?.(30, `Running scrypt KDF (N=${kdfParams.N})...`);

  // Start simulated progress (because scrypt doesn't provide real progress)
  let simulatedProgress = 30;
  const progressInterval = setInterval(() => {
    if (simulatedProgress < 85) {
      simulatedProgress += 1;
      onProgress?.(simulatedProgress, `Computing KDF... (${simulatedProgress}%)`);
    }
  }, 50); // Increment 1% every 50ms

  try {
    const derivedBytes = await scrypt(
      baseHashBytes,
      saltBytes,
      kdfParams.N,
      kdfParams.r,
      kdfParams.p,
      kdfParams.dkLen
    );

    clearInterval(progressInterval);
    onProgress?.(90, 'KDF completed');

    return await finalizeDerivedKey(derivedBytes, purpose, purposeSalt, kdfParams, startTime, onProgress);
  } catch (error) {
    clearInterval(progressInterval);
    throw error;
  }
}

// Helper function: finalize key derivation
async function finalizeDerivedKey(
  derivedBytes: Uint8Array,
  purpose: KeyPurpose,
  purposeSalt: string,
  kdfParams: typeof KDF_PRESETS[keyof typeof KDF_PRESETS],
  startTime: number,
  onProgress?: (progress: number, stage: string) => void
): Promise<DerivedKey> {

  // Phase 4: Generate final key (browser-compatible method)
  const key = '0x' + Array.from(derivedBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  // If used as private key, compute corresponding address
  let address: string | undefined;
  if (purpose === 'PRIVATE_KEY') {
    try {
      const wallet = new ethers.Wallet(key);
      address = wallet.address;
    } catch (e) {
      console.warn('Failed to derive address:', e);
    }
  }

  onProgress?.(100, 'Key derivation complete');

  const elapsed = Date.now() - startTime;
  console.log(`Key derivation completed in ${elapsed}ms`);

  return {
    key,
    address,
    timestamp: Date.now(),
    kdfParams: {
      N: kdfParams.N,
      r: kdfParams.r,
      p: kdfParams.p,
    },
    purpose: purposeSalt,
  };
}

/**
 * Validate passphrase strength for key derivation
 *
 * Re-exports from shared utility with recommendation text included
 *
 * @param passphrase - Passphrase
 * @returns { isStrong: boolean, entropy: number, level: string, recommendation: string }
 */
export function validatePassphraseStrength(passphrase: string): PassphraseStrength & { recommendation: string } {
  const result = validatePassphraseStrengthUtil(passphrase, true);
  return {
    ...result,
    recommendation: result.recommendation || '', // Ensure recommendation is always a string
  };
}

/**
 * Derive multiple purpose keys in batch
 *
 * Derive multiple keys for different purposes from the same PersonHash
 */
export async function deriveMultiPurposeKeys(
  input: HashForm,
  purposes: KeyPurpose[] = ['IDENTITY', 'PRIVATE_KEY', 'ENCRYPTION'],
  preset: KDFPreset = 'BALANCED'
): Promise<Record<KeyPurpose, DerivedKey>> {
  const results: Partial<Record<KeyPurpose, DerivedKey>> = {};

  for (const purpose of purposes) {
    results[purpose] = await deriveKeyFromPersonData(input, purpose, preset);
  }

  return results as Record<KeyPurpose, DerivedKey>;
}

/**
 * Estimate KDF computation time
 */
export function estimateKDFDuration(preset: KDFPreset): string {
  const estimates: Record<KDFPreset, string> = {
    FAST: '100-300ms',
    BALANCED: '1-2 seconds',
    STRONG: '3-5 seconds',
  };
  return estimates[preset];
}

/**
 * Check if browser supports Web Crypto API (for performance optimization)
 */
export function checkCryptoSupport(): {
  webCrypto: boolean;
  scrypt: boolean;
  recommendation: string;
} {
  const webCrypto = typeof window !== 'undefined' &&
                    typeof window.crypto !== 'undefined' &&
                    typeof window.crypto.subtle !== 'undefined';

  return {
    webCrypto,
    scrypt: true, // We use scrypt-js, always available
    recommendation: webCrypto
      ? '✅ Browser fully supports cryptographic features'
      : '⚠️ Browser crypto API limited, some features may be slower',
  };
}

/**
 * Securely compare two keys (prevent timing attacks)
 */
export function secureCompare(key1: string, key2: string): boolean {
  try {
    const bytes1 = ethers.getBytes(key1);
    const bytes2 = ethers.getBytes(key2);

    if (bytes1.length !== bytes2.length) return false;

    let diff = 0;
    for (let i = 0; i < bytes1.length; i++) {
      diff |= bytes1[i] ^ bytes2[i];
    }

    return diff === 0;
  } catch {
    return false;
  }
}
