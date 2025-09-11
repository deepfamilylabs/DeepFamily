# ZK Circuit Tests

## Test File Description

### 🧪 Available Test Files

1. **`test_fullname_hash.js`** - Basic functionality test ✅
   - Verify circuit executes properly
   - Confirm generation of correct 7 public outputs
   - Display actual hash calculation results
   ```bash
   node test/test_fullname_hash.js
   ```

2. **`test_basic_validation.js`** - Constraint validation test ✅ (Recommended)
   - Test input constraints (month≤12, day≤31, bytes≤255)
   - Verify circuit correctly rejects invalid input
   - Comprehensive boundary condition testing
   ```bash
   node test/test_basic_validation.js
   ```

3. **`test_isolation.js`** - Deterministic and state isolation test ✅
   - Verify same input produces same output
   - Test witness calculator state isolation
   ```bash
   node test/test_isolation.js
   ```

4. **`test_comprehensive.js`** - Complete circuit validation test ✅
   - Includes all basic tests + additional submitter isolation test
   - Uses subprocess isolation to solve witness calculator state issues
   - 6 comprehensive test cases
   ```bash
   node test/test_comprehensive.js
   ```

5. **`fullname_hash_input.json`** - Test data file
6. **`witness_helper.js`** - Witness calculation helper script
   - Used for isolated witness calculation, avoiding state pollution
   - Called by test_comprehensive.js

## Quick Verification

Run all tests:
```bash
# Basic functionality
node test/test_fullname_hash.js

# Constraint validation (recommended for comprehensive testing)
node test/test_basic_validation.js

# Deterministic test
node test/test_isolation.js

# Comprehensive complete test (most comprehensive)
node test/test_comprehensive.js
```

## Expected Results

All tests should display ✅ and exit with code 0.

### Example Output
```
Person hash: 101938713121748142782050396306938387463, 218107869012698935167393792926710603425
Father hash: 94745296350990914417150405627484202770, 115961196230165910746460682366819203825  
Mother hash: 175201067549225466907481793201788580963, 207553595205028118949000629999618431233
Submitter: 1234567890123456789012345678901234567890
```
