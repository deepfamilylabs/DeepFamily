# PersonHash Secure Private Key Derivation Flow

## Complete Flow Diagram

```
User Input
  ├─ Name: John Smith
  ├─ Birthday: 1990-05-15
  ├─ Gender: 1 (male)
  └─ Passphrase: Strong passphrase with special chars...
     ↓
[0%] ===== Layer 1: PersonHash Computation =====
     ↓
  Step 1: Data Normalization (5%)
     ├─ fullName → NFC normalization (composition, no trimming) → "John Smith"
     └─ passphrase → NFKD normalization (BIP39-style) → "Strong passphrase..."
     ↓
  Step 2: Pack Birthday and Gender (10%)
     └─ packedData = birthYear<<24 | birthMonth<<16 | birthDay<<8 | gender<<1 | isBirthBC
        = 1990<<24 | 5<<16 | 15<<8 | 1<<1 | 0
        = 0x07C6050F02
     ↓
  Step 3: keccak256 Hashing (12%)
     ├─ fullNameHash = keccak256(UTF-8(TextEncoder, "John Smith"))
     │  = 0xa1b2c3d4e5f6...
     └─ saltHash = keccak256(UTF-8(TextEncoder, "Strong passphrase..."))
        = 0x1a2b3c4d5e6f...
     ↓
  Step 4: Convert to 128-bit Limbs (14%)
     ├─ fullNameHash split:
     │  ├─ limb0 (high 128 bits) = 0xa1b2c3d4e5f6...
     │  └─ limb1 (low 128 bits) = 0x...789abcdef012
     └─ saltHash split:
        ├─ saltLimb0 = 0x1a2b3c4d5e6f...
        └─ saltLimb1 = 0x...fedcba987654
     ↓
  Step 5: Poseidon5 Mix Name and Passphrase (16%)
     └─ saltedNamePoseidon = Poseidon5([
          fullName_limb0,
          fullName_limb1,
          salt_limb0,
          salt_limb1,
          0
        ])
        = 0x2f3e4d5c6b7a...
     ↓
  Step 6: Split saltedName Again (17%)
     ├─ saltedLimb0 = saltedNamePoseidon high 128 bits
     └─ saltedLimb1 = saltedNamePoseidon low 128 bits
     ↓
  Step 7: Poseidon3 Final Mix (18%)
     └─ poseidonResult = Poseidon3([
          saltedLimb0,
          saltedLimb1,
          packedData
        ])
        = 0x9d8e7f6a5b4c...
     ↓
  Step 8: keccak256 Domain Separation (20%)
     └─ personHash = keccak256(poseidonResult)
        = 0x84dff9f0f49d189dc4503fdc94f9d883a6dd4393f349595f26fff5c1f6217065
     ↓
[20%] ===== PersonHash Computation Complete =====

     ↓

[25%] ===== Layer 2: Prepare KDF Input =====
     ↓
  Step 9: Compute Passphrase Hash (Security Critical!)
     └─ passphraseHash = keccak256(UTF-8(TextEncoder, NFKD("Strong passphrase...")))
        = 0x1a2b3c4d5e6f...
        🔒 Important: Salt must include passphrase to prevent precomputation attacks
     ↓
  Step 10: Construct Purpose Salt
     └─ saltComponents = [
          "DeepFamily-PrivateKey-v1",  // Purpose identifier
          "John Smith",                 // Name
          "1990-5-15",                  // Birthday
          "1",                          // Gender
          passphraseHash                // 🔒 Passphrase hash (unpredictable)
        ].join(':')
        = "DeepFamily-PrivateKey-v1:John Smith:1990-5-15:1:0x1a2b3c4d..."
     ↓
  Step 11: Hash Salt
     └─ saltHash = keccak256(saltComponents)
        = 0x3c4d5e6f7a8b...
     ↓
  Step 12: Prepare Byte Arrays
     ├─ baseHashBytes = getBytes(personHash)
     │  = Uint8Array[132, 223, 249, 240, ...]
     └─ saltBytes = getBytes(saltHash)
        = Uint8Array[60, 77, 94, 111, ...]
     ↓
[30%] ===== KDF Input Preparation Complete =====

     ↓

[30%-85%] ===== Layer 3: scrypt KDF Computation =====
     ↓
  Algorithm Parameters:
     ├─ N = 131,072 (2^17) - CPU cost factor
     ├─ r = 8           - Memory cost factor
     ├─ p = 1           - Parallelization factor
     └─ dkLen = 32      - Output length (256 bits)
     ↓
  scrypt Internal Process (~1-2 seconds):
     │
     ├─ [Phase 1] PBKDF2-HMAC-SHA256 Generate Initial Vector
     │   └─ PBKDF2 on baseHashBytes + saltBytes
     │      Iterations = 1
     │      Output = 128 * r * p bytes = 1024 bytes
     │
     ├─ [Phase 2] ROMix Memory-Hard Function (main time consumer)
     │   │
     │   ├─ Step 1: Fill Memory (N iterations)
     │   │   for i = 0 to N-1:
     │   │     V[i] = BlockMix(V[i-1])
     │   │   Total memory needed: N * 128 * r bytes
     │   │   = 131,072 * 128 * 8 = 134MB memory
     │   │
     │   └─ Step 2: Random Access Mix (N iterations)
     │       for i = 0 to N-1:
     │         j = Integerify(X) mod N
     │         X = BlockMix(X ⊕ V[j])
     │       Each iteration ~7-15 microseconds
     │       Total time = 131,072 * 10μs ≈ 1.3 seconds
     │
     └─ [Phase 3] PBKDF2 Final Extraction
         └─ PBKDF2 again on ROMix output
            Iterations = 1
            Output = 32 bytes (256 bits)
     ↓
  Progress Simulation (scrypt library doesn't provide real progress):
     └─ Increment 1% every 50ms, from 30% to 85%
        (UX optimization, doesn't affect actual computation)
     ↓
  derivedBytes = [
    0x10, 0x19, 0xeb, 0xab, 0x28, 0xde, 0x47, 0x92,
    0xf5, 0xb8, 0x20, 0x13, 0xf5, 0x06, 0xe2, 0xa7,
    0xa8, 0xbf, 0x29, 0x01, 0x16, 0x88, 0x6e, 0x79,
    0x9e, 0x26, 0xd5, 0xc4, 0x3e, 0x77, 0x23, 0xa3
  ]
     ↓
[90%] ===== scrypt KDF Computation Complete =====

     ↓

[90%-100%] ===== Layer 4: Generate Final Key =====
     ↓
  Step 13: Bytes to Hex (92%)
     └─ key = '0x' + Array.from(derivedBytes)
                       .map(b => b.toString(16).padStart(2, '0'))
                       .join('')
        = 0x1019ebab28de4792f5b82013f506e2a7a8bf290116886e799e26d5c43e7723a3
     ↓
  Step 14: Create Ethereum Wallet (95%)
     └─ wallet = new ethers.Wallet(key)
        ├─ Private key validation: ✅ Valid secp256k1 private key
        └─ Public key derivation: Using Elliptic Curve Digital Signature Algorithm (ECDSA)
           publicKey = secp256k1.getPublicKey(privateKey)
     ↓
  Step 15: Compute Ethereum Address (98%)
     └─ address = '0x' + keccak256(publicKey)[12:]
        = 0xCE22622E5c32826441502925FDa9073318C4569e
     ↓
[100%] ===== Private Key Derivation Success! =====
     ↓
  Final Output:
     ├─ key: 0x1019ebab28de4792f5b82013f506e2a7a8bf290116886e799e26d5c43e7723a3
     ├─ address: 0xCE22622E5c32826441502925FDa9073318C4569e
     ├─ timestamp: 1736036125847
     ├─ kdfParams: { N: 131072, r: 8, p: 1 }
     └─ purpose: "DeepFamily-PrivateKey-v1"
```

---

## Key Technical Details

### 1. Why Use Poseidon Hash?

**Poseidon is a ZK-friendly hash function:**
- Designed for zero-knowledge proof circuits
- More efficient than SHA256/keccak256 in SNARK proofs
- Supports privacy proofs for family trees (can verify relationships without revealing identity)

**Dual-hash design (Poseidon + keccak256):**
```
Poseidon: Internal computation, ZK-friendly
keccak256: Outer wrapper, prevents hash collisions, Ethereum-compatible
```

### 2. Why Split Data into 128-bit Limbs?

**Reason:**
- Poseidon operates on finite fields (scalar field of BN254 curve)
- Field size is approximately 254 bits
- Split 256-bit hash into two 128-bit chunks to ensure each fits within the field

**Code implementation:**
```typescript
const fullNameHashBN = BigInt(fullNameHash) // 256 bits
const limb0 = fullNameHashBN >> 128n        // High 128 bits
const limb1 = fullNameHashBN & ((1n << 128n) - 1n) // Low 128 bits
```

### 3. Why is scrypt Secure?

**Triple protection:**

#### a) **CPU-hard** (N parameter)
```
N = 131,072 iterations
Attacker must repeat computation 131,072 times
GPU acceleration limited due to memory dependency
```

#### b) **Memory-hard** (r parameter)
```
Requires 134MB memory
Parallel attacks need GB-level memory
Significantly increases hardware cost
```

#### c) **Parallelization-limited** (p parameter)
```
p = 1 means computation cannot be parallelized
Even multi-core CPU/GPU cannot accelerate
```

**Comparison:**
| Algorithm | N | Memory | Cracking Cost |
|------|---|------|---------|
| No KDF | 1 | 0 | $0.001 |
| PBKDF2 (10k) | 10,000 | 0 | $10 |
| **scrypt (131k)** | 131,072 | 134MB | **$13,000+** |

### 4. Why is Progress "Simulated"?

**Reason:**
- `scrypt-js` library is pure JavaScript implementation
- Doesn't provide internal progress callbacks
- Computation is synchronous, cannot be interrupted for queries

**Solution:**
```typescript
// Start timer to simulate progress
const progressInterval = setInterval(() => {
  simulatedProgress += 1;
  onProgress(simulatedProgress, `Computing...`);
}, 50); // Increment 1% every 50ms

// Actual computation
const result = await scrypt(...); // This blocks for 1-2 seconds

// Clear timer
clearInterval(progressInterval);
```

**Real vs Simulated:**
- ✅ **Computation time is real** (1-2 seconds)
- **Progress percentage is estimated** (smooth transition)
- ✅ **Better user experience** (doesn't freeze)

### 5. How is Determinism Guaranteed?

**All algorithms are deterministic:**

```typescript
// Same input
input1 = { fullName: "John Smith", birthYear: 1990, ... }
input2 = { fullName: "John Smith", birthYear: 1990, ... }

// Each step is deterministic
step1: keccak256("John Smith") = 0xa1b2... (fixed)
step2: Poseidon5([...]) = 0x2f3e... (fixed)
step3: scrypt(input, salt) = 0x1019... (fixed)

// Final key is always the same
key1 === key2 // ✅ true
```

**Verification method:**
1. Input same name, birthday, passphrase
2. Run on different devices, at different times
3. Derived private key and address **completely identical**

---

## Security Analysis

### Attack Cost Estimation

Assume attacker knows:
- Name: John Smith
- Birthday: 1990-05-15
- Gender: male

**Only need to brute-force passphrase:**

| Passphrase Strength | Combinations | scrypt Count | GPU Cracking Time |
|---------|---------|------------|------------|
| Empty passphrase | 1 | 131,072 | **0.1s** ❌ |
| 8-char weak | 10^12 | 131×10^15 | Years ⚠️ |
| 20-char mixed | 10^36 | 131×10^39 | 10^26 years ✅ |
| 30-char+emoji | 10^60 | 131×10^63 | **Heat death of universe** ✅ |

**Conclusion:**
- ❌ No passphrase or weak passphrase: Completely insecure
- ⚠️ Medium passphrase: Barely usable, risky
- ✅ Strong passphrase (30+ chars): **Secure for private keys**

---

## 📝 Comparison with BIP39

| Feature | BIP39 Mnemonic | PersonHash + KDF |
|------|-------------|------------------|
| **Entropy Source** | Hardware RNG | Personal info + strong passphrase |
| **Entropy** | 128-256 bits | 100-300+ bits |
| **Memory Difficulty** | 12-24 English words | Personal info + custom passphrase |
| **KDF** | PBKDF2 (2048 iterations) | scrypt (131,072 iterations) |
| **Brute-force Protection** | 2048× | **131,072×** |
| **Standardization** | ✅ BIP39/BIP44 | ⚠️ Custom |
| **Recoverability** | ✅ Mnemonic | ✅ Personal info + passphrase |
| **Use Case** | General wallets | DeepFamily identity binding |

**Recommendations:**
- **Finance/Exchanges**: Use BIP39
- **DeepFamily**: Can use PersonHash (requires strong passphrase)
- **Most Secure**: BIP39 + hardware wallet

---

## Usage Guidelines

### Must Do

1. **Use extremely strong passphrase**
   - Minimum 30 characters
   - Mix letters, numbers, symbols, emoji
   - Example: `MySecret🌸Passphrase🐦WithEmojis🌧️2024`

2. **Store passphrase securely**
   - Write on paper, lock in safe
   - Use password manager (1Password, Bitwarden)
   - Don't store in cloud or on computer

3. **Test recovery process**
   - Record address: `0xCE22622E...`
   - Re-enter after a week, verify address matches
   - Ensure passphrase is fully memorized

### Don't Do

1. **Don't use weak passphrase**
   - "123456"
   - "password"
   - Common words

2. **Don't share any information**
   - Don't tell anyone your passphrase
   - Don't show private key on social media
   - Don't screenshot private key and upload to cloud

3. **Don't rely on memory alone**
   - Don't rely only on memory, must backup
   - Don't think "I won't forget"
   - Human memory distorts and fades

---

## Technical Terms

- **keccak256**: Hash algorithm used by Ethereum, outputs 256 bits
- **Poseidon**: Zero-knowledge proof friendly hash function
- **scrypt**: Memory-hard key derivation function
- **ECDSA**: Elliptic Curve Digital Signature Algorithm
- **secp256k1**: Elliptic curve used by Bitcoin/Ethereum
- **Limbs**: Large integers split into multiple chunks for finite field operations
- **KDF**: Key Derivation Function
- **NFC (names)**: Unicode normalization form (composition) for names; no trimming applied
- **NFKD (passphrase)**: Unicode normalization form (BIP39-style) for passphrases; no trimming applied
- **UTF-8 (TextEncoder)**: All hashes operate on UTF-8 bytes produced via `TextEncoder`

---

**Total Time: ~1.5-2 seconds in BALANCED mode**
