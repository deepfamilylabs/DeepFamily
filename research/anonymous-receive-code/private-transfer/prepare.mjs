// RESEARCH ONLY. Original VALUE schema; full PrivateTransfer witness relation.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {build,query} from "../prepare-composition.mjs";

const root=fs.realpathSync(path.resolve(process.argv[2]??path.join(path.dirname(fileURLToPath(import.meta.url)),"../../..")));
const issuerRoot=path.resolve(process.argv[3]??"/tmp/deepfamily-attachment-p0");
const out=path.resolve(process.argv[4]??"/tmp/deepfamily-private-transfer-p0");
assert.ok(!out.startsWith(root+path.sep));fs.mkdirSync(out,{recursive:true});
const cpus=os.cpus;os.cpus=()=>cpus().slice(0,2);
const require=createRequire(path.join(root,"package.json")),{poseidon2,poseidon3}=require("poseidon-lite"),{keccak256,concat,hexlify,getCreateAddress,getBytes}=require("ethers"),snarkjs=require("snarkjs"),{WitnessCalculatorBuilder}=require("circom_runtime");
const {readR1cs}=await import(pathToFileURL(require.resolve("r1csfile")));
const protocol=await import(pathToFileURL(path.join(root,"packages/protocol-core/index.js")));
const {buildLineageFixture}=await import(pathToFileURL(path.join(root,"circuits/test/generate_lineage_fixture.mjs")));
const read=p=>JSON.parse(fs.readFileSync(p,"utf8")),write=(p,x)=>fs.writeFileSync(p,JSON.stringify(x,(_,v)=>typeof v==="bigint"?String(v):v)+"\n");
const chainId=31337n,sender="0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",poolAddress=getCreateAddress({from:sender,nonce:3}),pool=BigInt(poolAddress),scope={chainId,poolAddress},T=1900000000n;
const q=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const owner=secret=>poseidon2([1013n,secret]);
const scoped=n=>poseidon3([1032n,poseidon3([1031n,chainId,pool]),BigInt(n)]);
console.log("Compile unchanged production PrivateTransfer relation");
const compile=execFileSync(path.join(root,"bin/circom"),[path.join(root,"circuits/shielded_private_transfer.circom"),"--r1cs","--wasm","--sym","--O2","--sanity_check","2","-l",path.join(root,"circuits"),"-l",path.join(root,"node_modules"),"-l",path.join(root,"node_modules/circomlib/circuits"),"-o",out],{cwd:out,encoding:"utf8"});fs.writeFileSync(path.join(out,"compile.log"),compile);console.log(compile.trim());
const r1cs=path.join(out,"shielded_private_transfer.r1cs"),relation=await readR1cs(r1cs,true,false,true),symbols=fs.readFileSync(path.join(out,"shielded_private_transfer.sym"),"utf8").trim().split("\n").map(s=>s.split(","));
assert.equal(String(relation.prime),String(q));assert.equal(relation.nOutputs+relation.nPubInputs,30);
const names=Object.fromEntries(symbols.filter(s=>s[3].startsWith("main.")).map(s=>[s[3].slice(5),Number(s[1])]));
const constraints=relation.constraints.map(row=>row.map(lc=>Object.entries(lc).map(([i,c])=>({i:Number(i),c:String(relation.F.toObject(c))}))));
const model={schema:"fixed-transfer-r1cs-v1",prime:String(q),nVars:relation.nVars,nPublic:30,nConstraints:relation.nConstraints,sourceR1csSHA256:createHash("sha256").update(fs.readFileSync(r1cs)).digest("hex"),publicNames:Array.from({length:30},(_,i)=>symbols.find(s=>Number(s[1])===i+1&&/^main\.[^.]+$/u.test(s[3]))[3].slice(5)),wireMap:{inputOwnerSecret:names["inputOwnerSecrets[0]"],outputOwner0:names["outputOwnerCommitments[0]"],outputOwner1:names["outputOwnerCommitments[1]"]},constraints};
for(const i of Object.values(model.wireMap))assert.ok(i>0&&i<relation.nVars);
const relationFile=path.join(out,"transfer-relation.json");write(relationFile,model);
const calculator=await WitnessCalculatorBuilder(fs.readFileSync(path.join(out,"shielded_private_transfer_js/shielded_private_transfer.wasm")),{singleThread:true});
function code(dir,mode){return {inputDir:dir,mode:String(mode),p:read(path.join(dir,`mode-${mode}.public.json`))};}
const a=code(path.join(issuerRoot,"issuance-0"),0),sameIdentityMode1=code(path.join(issuerRoot,"issuance-1"),1);
const originalOther=code(path.join(issuerRoot,"other-identity-same-independent-keys"),1);
const lineage=buildLineageFixture().witness,baseSecret=BigInt(lineage.derivedSecretField),material=protocol.deriveShieldedHeirKeyMaterial(baseSecret),vk=read(path.join(a.inputDir,"research.vkey.json"));
async function issue(name,{source=a,identitySecret=baseSecret,spendingSecret,mode=Number(source.mode),counter=0,expiry=T,patch={}}={}){
 const dir=path.join(out,"issuance",name);fs.mkdirSync(dir,{recursive:true});
 const input={nameField:lineage.nameField,derivedSecretField:String(identitySecret),isBirthBC:lineage.isBirthBC,birthYear:lineage.birthYear,birthMonth:lineage.birthMonth,birthDay:lineage.birthDay,gender:lineage.gender,suiteId:"1",identitySuiteId:"1",independentKeySuiteId:"1",independentKeyDerivationVersion:"1",receiveCodeVersion:"1",identityCommitment:"0",ownerCommitment:source.p[3],viewKeyLo:source.p[4],viewKeyHi:source.p[5],keyMode:String(mode),spendingSecret:String(spendingSecret??(mode?123456789n:material.ownerSecret)),authorizationCounter:String(counter),expiresAt:String(expiry),...patch};
 // The original identity preimage is known only here at credential issuance;
 // Transfer witnesses below contain no recipient identity or identity secret.
 const {poseidon4}=require("poseidon-lite"),suite=poseidon4([1000n,1n,0n,0n]);
 const packed=BigInt(lineage.birthYear)*33554432n+BigInt(lineage.birthMonth)*131072n+BigInt(lineage.birthDay)*512n+BigInt(lineage.gender)*2n+BigInt(lineage.isBirthBC);
 input.identityCommitment=String(poseidon4([1002n,poseidon4([1001n,BigInt(lineage.nameField),identitySecret,suite]),packed,suite]));
 const proof=await snarkjs.groth16.fullProve(input,path.join(issuerRoot,"attachment_anonymous_issuance_js/attachment_anonymous_issuance.wasm"),path.join(issuerRoot,"INSECURE-anonymous-issuer.zkey"),undefined,{singleThread:true},{singleThread:true});
 assert.equal(await snarkjs.groth16.verify(vk,proof.publicSignals,proof.proof),true);
 fs.copyFileSync(path.join(a.inputDir,"research.vkey.json"),path.join(dir,"research.vkey.json"));write(path.join(dir,`mode-${mode}.proof.json`),proof.proof);write(path.join(dir,`mode-${mode}.public.json`),proof.publicSignals);
 return code(dir,mode);
}
const b=await issue("second-recipient-earlier-deadline",{source:originalOther,identitySecret:baseSecret+1n,expiry:T-100n});
const renewedB=await issue("second-recipient-counter1",{source:b,identitySecret:baseSecret+1n,counter:1,expiry:T-100n});
const wrongView=await issue("same-owner-changed-view",{source:sameIdentityMode1,patch:{viewKeyLo:String(BigInt(sameIdentityMode1.p[4])^1n)}});
const senderHistoricalCredential=await issue("sender-historical-code",{source:sameIdentityMode1,spendingSecret:424242n,expiry:T-200n,patch:{ownerCommitment:String(owner(424242n))}});
const R=BigInt(a.p[0]),R2=BigInt(b.p[0]),neighbors=[[R^1n,5n],[R^2n,9n]],initial=build(neighbors),firstRevoked=build([...neighbors,[R,1n]]),secondRevoked=build([...neighbors,[R2,1n]]);
function binding(u,p){
 let context=poseidon3([202610210101n,chainId,pool]);for(const[x,y]of[[u.action,u.messageId],[u.cipherLo,u.cipherHi],[u.checkpointId,u.stateRoot],[u.asOf,u.expiresAt]])context=poseidon3([context,BigInt(x),BigInt(y)]);
 let receiver=poseidon3([202610210102n,BigInt(p[0]),BigInt(p[3])]);receiver=poseidon3([receiver,BigInt(p[6]),BigInt(p[4])]);receiver=poseidon3([receiver,BigInt(p[5]),BigInt(u.salt)]);return String(poseidon2([receiver,context]));
}
let id=200;
const cases=[];
async function make(name,{shape="single",slot=0,recipients=[a,null],codes,tree=initial,valid=true,merge=false,senderSecret=424242n,mutateUsage,mutateWires}={}){
 const message=String(id++),senderOwner=owner(senderSecret),count=merge?2:1,amounts=count===2?[700n,300n]:[1000n];
 const inputNonces=Array.from({length:count},(_,i)=>BigInt(message)*100n+BigInt(i+1));
 const inputHashes=Array.from({length:count},(_,i)=>BigInt(keccak256(Buffer.alloc(512,0x40+i)))%q);
 const inputNotes=amounts.map((amount,i)=>protocol.computeShieldedValueNoteCommitment({ownerCommitment:senderOwner,amount,nonce:inputNonces[i],ciphertextHashField:inputHashes[i]},scope));
 const owners=recipients.map(c=>c?BigInt(c.p[3]):senderOwner),outputAmounts=merge?[1000n,0n]:[600n,400n],nonces=[BigInt(message)*100n+91n,BigInt(message)*100n+92n];
 const ciphertexts=[];
 for(let i=0;i<2;i++){
  const p=recipients[i]?.p??a.p,view=getBytes("0x"+BigInt(p[5]).toString(16).padStart(32,"0")+BigInt(p[4]).toString(16).padStart(32,"0"));
  const payload=protocol.encodeShieldedValueNotePayload({ownerCommitment:owners[i],amount:outputAmounts[i],nonce:nonces[i]},scope);
  ciphertexts.push(hexlify(await protocol.encryptShieldedNote({chainId,poolAddress,recipientPublicKey:view,payload})));
 }
 const hashes=ciphertexts.map(c=>BigInt(keccak256(c))%q),outputs=owners.map((c,i)=>protocol.computeShieldedValueNoteCommitment({ownerCommitment:c,amount:outputAmounts[i],nonce:nonces[i],ciphertextHashField:hashes[i]},scope));
 const input={chainId:String(chainId),pool:String(pool),inputShardIds:Array(8).fill("0"),inputRoots:Array.from({length:8},(_,i)=>String(inputNotes[i]??inputNotes[0])),inputNullifiers:Array.from({length:8},(_,i)=>String(i<count?protocol.computeShieldedSpendNullifier({ownerSecret:senderSecret,noteCommitment:inputNotes[i]},scope):protocol.computeShieldedDummyInputNullifierForSlot(senderSecret,inputNotes[0],i,scope))),inputEnabled:Array.from({length:8},(_,i)=>i<count?"1":"0"),inputOwnerSecrets:Array.from({length:8},(_,i)=>i<count?String(senderSecret):"0"),inputAmounts:Array.from({length:8},(_,i)=>String(amounts[i]??0n)),inputNonces:Array.from({length:8},(_,i)=>String(inputNonces[i]??0n)),inputCiphertextHashes:Array.from({length:8},(_,i)=>String(inputHashes[i]??0n)),inputDepths:Array(8).fill("0"),inputIndices:Array(8).fill("0"),inputSiblings:Array.from({length:8},()=>Array(32).fill("0")),outputOwnerCommitments:owners.map(String),outputAmounts:outputAmounts.map(String),outputNonces:nonces.map(String),outputCommitments:outputs.map(String),ciphertextHashes:hashes.map(String)};
 const wires=await calculator.calculateWitness(input,1);
 if(mutateWires)mutateWires(wires);
 const witnessFile=path.join(out,name+".witness.json");write(witnessFile,wires.map(String));
 const authCodes=codes??(shape==="self"?[]:shape==="single"?[recipients[slot]]:recipients),digest=BigInt(keccak256(concat(ciphertexts)));
 const auth=[];
 for(let index=0;index<authCodes.length;index++){
  const c=authCodes[index],u={chainId:String(chainId),consumer:String(pool),action:"3",messageId:message,cipherLo:String(digest&((1n<<128n)-1n)),cipherHi:String(digest>>128n),checkpointId:tree===initial?"1":"2",stateRoot:String(tree.hash),asOf:String(tree===initial?T-1900n:T-1600n),expiresAt:c.p[2],salt:String(7946872923111936231241238987982354435442293588393n+BigInt(message)*37n+BigInt(index)),...query(tree,BigInt(c.p[0]))};u.binding=binding(u,c.p);if(mutateUsage)mutateUsage(u,c,index);
  const extrasFile=path.join(out,name+`.auth-${index}.json`);write(extrasFile,u);auth.push({inputDir:c.inputDir,mode:c.mode,extrasFile,extras:u});
 }
 const item={name,valid,shape,slot:String(slot),witnessFile,transferPublic30:wires.slice(1,31).map(String),ciphertexts,auth,messageId:message,recipientOwners:owners.map(String),senderOwner:String(senderOwner),metadataLeakage:"Compile-time shape and single slot reveal self/external placement in this research format"};cases.push(item);return item;
}
await make("self-merge-zero-change",{shape:"self",recipients:[null,null],merge:true});
await make("self-split-after-expiry-or-revocation",{shape:"self",recipients:[null,null]});
await make("self-cannot-hide-external",{shape:"self",recipients:[a,null],valid:false});
await make("same-identity-different-owner-not-self",{shape:"self",senderSecret:material.ownerSecret,recipients:[sameIdentityMode1,null],valid:false});
await make("single-mode0-slot0",{});
await make("single-mode1-slot0",{recipients:[sameIdentityMode1,null]});
await make("single-mode0-slot1",{slot:1,recipients:[null,a]});
await make("single-mode1-slot1",{slot:1,recipients:[null,sameIdentityMode1]});
await make("single-second-external-cannot-hide-as-change",{recipients:[a,sameIdentityMode1],codes:[a],valid:false});
await make("single-wrong-slot",{slot:1,recipients:[a,null],codes:[a],valid:false});
await make("single-wrong-authenticated-owner-mode",{recipients:[a,null],codes:[sameIdentityMode1],valid:false});
await make("single-authenticated-expiry-mismatch",{valid:false,mutateUsage(u,c){u.expiresAt=String(BigInt(u.expiresAt)+1n);u.binding=binding(u,c.p);}});
await make("single-revoked-counter-current-root",{tree:firstRevoked,valid:false});
await make("single-changed-view-unchanged-binding",{recipients:[sameIdentityMode1,null],codes:[wrongView],valid:false,mutateUsage(u){u.binding=binding(u,sameIdentityMode1.p);}});
await make("single-full-value-relation-tamper",{valid:false,mutateWires(w){w[names["outputAmounts[0]"]]+=1n;}});
await make("dual-independent-deadlines",{shape:"dual",recipients:[a,b]});
await make("dual-two-modes-same-identity",{shape:"dual",recipients:[a,sameIdentityMode1]});
await make("dual-renewed-second-counter-immediate",{shape:"dual",recipients:[a,renewedB],tree:secondRevoked});
await make("dual-second-revoked-counter-current-root",{shape:"dual",recipients:[a,b],tree:secondRevoked,valid:false});
await make("dual-first-code-cannot-cover-second",{shape:"dual",recipients:[a,b],codes:[a,a],valid:false});
await make("dual-second-authenticated-expiry-mismatch",{shape:"dual",recipients:[a,b],valid:false,mutateUsage(u,c,i){if(i===1){u.expiresAt=String(BigInt(u.expiresAt)+1n);u.binding=binding(u,c.p);}}});
await make("dual-counter-context-must-match",{shape:"dual",recipients:[a,b],valid:false,mutateUsage(u,c,i){if(i===1){u.checkpointId="2";u.binding=binding(u,c.p);}}});
const constants={},pkg=path.dirname(require.resolve("poseidon-lite"));for(const n of [2,3]){const raw=require(path.join(pkg,`constants/${n}.js`)).default;const decode=x=>Array.isArray(x)?x.map(decode):BigInt("0x"+Buffer.from(x,"base64").toString("hex")).toString();constants[n]={C:decode(raw.C),M:decode(raw.M)};}
const constantsFile=path.join(out,"poseidon-constants.json");write(constantsFile,constants);
const metadata={scope:"Isolated full unchanged PrivateTransfer relation with anonymous authorization per external output; native synthetic note roots and deployment; not production integration",poolAddress,chainId:String(chainId),sender,senderHistoricalCredential,baseTime:String(T-2000n),initialCounterRoot:String(initial.hash),firstRevokedRoot:String(firstRevoked.hash),secondRevokedRoot:String(secondRevoked.hash),relationFile,constantsFile,cases,limitations:["Public self/single/dual shape and single slot leak external-recipient count/placement; not a finalized production privacy format", "Input note roots are synthetic preloaded fixtures; no token custody or production canonical tree integration", "Output ciphertexts use real HPKE and unchanged VALUE codec; the circuit authenticates the declared receiving keys and exact ciphertext hash, not HPKE encryption correctness", "Viewing material is the existing shared synthetic fixture, not independent-key KDF recovery evidence", "Counter root advancement in the minimal consumer is fixture driven; owner-update authorization was separately verified", "No recipient identity I is required by Transfer witnesses, no new VALUE fields, registry, approval step or recovery secret"]};
write(path.join(out,"transfer-manifest.json"),metadata);for(const shape of ["self","single","dual"])write(path.join(out,shape+"-manifest.json"),{...metadata,shape,cases:cases.filter(c=>c.shape===shape)});
console.log(JSON.stringify({out,poolAddress,originalConstraints:relation.nConstraints,originalWires:relation.nVars,cases:cases.length,shapes:Object.fromEntries(["self","single","dual"].map(s=>[s,cases.filter(c=>c.shape===s).length]))}));
process.exit(0);
