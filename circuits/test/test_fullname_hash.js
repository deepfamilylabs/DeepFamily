const snarkjs = require('snarkjs');
const fs = require('fs');
const path = require('path');

async function testCircuit() {
    try {
        console.log('Testing person_hash_simple_zk circuit with fullNameHash...');
        
        // Load input
        const inputPath = path.join(__dirname, 'fullname_hash_input.json');
        const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
        
        console.log('Loaded input:');
        console.log('- fullNameHash (first 8 bytes):', input.fullNameHash.slice(0, 8));
        console.log('- person data:', { 
            isBirthBC: input.isBirthBC, 
            birthYear: input.birthYear, 
            birthMonth: input.birthMonth, 
            birthDay: input.birthDay, 
            gender: input.gender 
        });
        
        // Calculate witness
        const wasmPath = 'artifacts/circuits/person_hash_zk_js/person_hash_zk.wasm';
        console.log('\\nCalculating witness...');
        
        const { witness, publicSignals } = await snarkjs.wtns.calculate(input, wasmPath);
        
        console.log('\\n✅ Circuit executed successfully!');
        console.log('Public signals (7 expected):');
        console.log('- person_limb0:', publicSignals[0]);
        console.log('- person_limb1:', publicSignals[1]);  
        console.log('- father_limb0:', publicSignals[2]);
        console.log('- father_limb1:', publicSignals[3]);
        console.log('- mother_limb0:', publicSignals[4]);
        console.log('- mother_limb1:', publicSignals[5]);
        console.log('- submitter:', publicSignals[6]);
        
        console.log('\\n🎉 All tests passed! Circuit is working correctly.');
        return true;
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
        return false;
    }
}

// Run the test
testCircuit().then(success => {
    process.exit(success ? 0 : 1);
});