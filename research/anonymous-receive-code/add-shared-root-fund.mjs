// RESEARCH ONLY. Adds one independently spendable Fund fixture without creating
// or changing any issuer key, circuit, or setup. Reuse the existing Go setup.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath,pathToFileURL} from "node:url";

const read=file=>JSON.parse(fs.readFileSync(file,"utf8"));
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,(_,v)=>typeof v==="bigint"?String(v):v,2)+"\n");

export async function createSharedRootFundCase({root,fundDir,out,manifest,calculator}){
 root=path.resolve(root);fundDir=path.resolve(fundDir);out=path.resolve(out);
 assert.ok(!out.startsWith(root+path.sep));fs.mkdirSync(out,{recursive:true});
 assert.equal(manifest.viewFields,true,"requires view-bound Fund research schema");
 const require=createRequire(path.join(root,"package.json"));
 const {poseidon2,poseidon3,poseidon4,poseidon5,poseidon7,poseidon8}=require("poseidon-lite");
 const {keccak256,concat}=require("ethers");
 const {WitnessCalculatorBuilder}=require("circom_runtime");
 const protocol=await import(pathToFileURL(path.join(root,"packages/protocol-core/index.js")));
 const {buildShieldedFundingFixtures}=await import(pathToFileURL(path.join(root,"circuits/test/generate_shielded_funding_input.mjs")));
 const base=manifest.cases.find(c=>c.name==="first-mode-0"&&c.valid);assert.ok(base);
 const p=base.issuerSignals,chainId=BigInt(manifest.chainId),pool=BigInt(manifest.poolAddress);
 const scoped=purpose=>protocol.computeShieldedScopedPurpose(BigInt(purpose),{chainId,poolAddress:manifest.poolAddress});
 const f=buildShieldedFundingFixtures({chainId,poolAddress:manifest.poolAddress,keyMode:0});
 const input={...f.initial,heirViewKeyLo:p[5],heirViewKeyHi:p[6],oldBudgetIsClaim:"0",
  donorNonce:"201",donorCiphertextHash:"202",enrollmentSalt:"77777",allocationKey:"232323",policySalt:"56565",budgetNonce:"207",changeNonce:"209"};
 input.allocationKeyCommitment=String(poseidon2([scoped(1028),BigInt(input.allocationKey)]));
 const policy=poseidon7([scoped(1010),BigInt(input.rootIdentityCommitment),BigInt(input.rootVersionIndex),BigInt(input.rate),BigInt(input.policySalt),BigInt(input.allocationKeyCommitment),BigInt(input.periodDays)]);
 const enrollment=poseidon5([scoped(1011),policy,BigInt(input.heirIdentityCommitment),BigInt(input.eligibleFrom),BigInt(input.enrollmentSalt)]);
 const donorOwner=protocol.computeShieldedOwnerCommitment(BigInt(input.donorOwnerSecret));
 const donorNote=poseidon5([scoped(1014),donorOwner,BigInt(input.donorAmount),BigInt(input.donorNonce),BigInt(input.donorCiphertextHash)]);
 input.inputRoots=[String(donorNote),String(donorNote)];
 input.inputNullifiers=[String(poseidon3([scoped(1016),BigInt(input.donorOwnerSecret),donorNote])),String(poseidon4([scoped(1027),BigInt(input.allocationKey),policy,BigInt(input.heirIdentityCommitment)]))];
 // The new policy/allocation key is necessary: merely changing enrollmentSalt
 // would leave the unique first-enrollment nullifier equal to the first case.
 for(const n of input.inputNullifiers)assert.ok(!base.publicFund.slice(18,20).includes(n),"new Fund reuses an existing nullifier");
 const ciphertexts=[0,1].map(i=>"0x"+Buffer.alloc(512,0xb0+i).toString("hex"));
 const q=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
 const hashes=ciphertexts.map(c=>BigInt(keccak256(c))%q);input.ciphertextHashes=hashes.map(String);
 const rate=BigInt(input.rate),amount=rate*BigInt(input.budgetPeriods),owner=BigInt(input.heirOwnerCommitment);
 const authorization=poseidon5([scoped(1033),owner,0n,BigInt(input.heirViewKeyLo),BigInt(input.heirViewKeyHi)]);
 const budget=poseidon8([scoped(202610210301),policy,enrollment,authorization,rate,amount,BigInt(input.budgetNonce),hashes[0]]);
 const change=poseidon5([scoped(1014),donorOwner,BigInt(input.donorAmount)-amount,BigInt(input.changeNonce),hashes[1]]);
 input.outputCommitments=[String(budget),String(change)];
 if(!calculator)calculator=await WitnessCalculatorBuilder(fs.readFileSync(path.join(fundDir,"shielded_fund_js/shielded_fund.wasm")),{singleThread:true});
 const wires=await calculator.calculateWitness(input,1);
 const digest=BigInt(keccak256(concat(ciphertexts))),u={...base.extras,messageId:"90",cipherLo:String(digest&((1n<<128n)-1n)),cipherHi:String(digest>>128n),salt:"7946872923111936231241238987982354435442293588397"};
 let ctx=poseidon3([202610210101n,chainId,pool]);
 for(const[a,b]of[[u.action,u.messageId],[u.cipherLo,u.cipherHi],[u.checkpointId,u.stateRoot],[u.asOf,u.expiresAt]])ctx=poseidon3([ctx,BigInt(a),BigInt(b)]);
 let recipient=poseidon3([202610210102n,BigInt(p[0]),BigInt(p[4])]);
 recipient=poseidon3([recipient,BigInt(p[7]),BigInt(p[5])]);recipient=poseidon3([recipient,BigInt(p[6]),BigInt(u.salt)]);
 u.binding=String(poseidon2([recipient,ctx]));
 const name="unrelated-first-mode-0",inputFile=path.join(out,name+".input.json"),witnessFile=path.join(out,name+".witness.json"),extrasFile=path.join(out,name+".extras.json");
 write(inputFile,input);write(witnessFile,wires.map(String));write(extrasFile,u);
 return {name,valid:true,inputDir:base.inputDir,mode:"0",inputFile,witnessFile,extrasFile,extras:u,publicFund:wires.slice(1,manifest.fundPublicNames.length+1).map(String),
  ciphertexts,ciphertextHashes:hashes.map(String),issuerSignals:p,
  budgetOpening:{policy:String(policy),enrollment:String(enrollment),rate:String(rate),remaining:String(amount),nonce:input.budgetNonce,ciphertextHash:String(hashes[0]),commitment:String(budget),changeCommitment:String(change),keyMode:"0",owner:String(owner),viewLo:input.heirViewKeyLo,viewHi:input.heirViewKeyHi,noteTagPurpose:"202610210301",noteTag:String(scoped(202610210301)),authorizationTag:String(scoped(1033)),budgetKind:"0",producer:"Fund",oldTemplateProducer:null},
  independentNullifiers:true};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(process.argv[2]??path.join(path.dirname(fileURLToPath(import.meta.url)),"../.."));
 const fundDir=path.resolve(process.argv[3]??"/tmp/deepfamily-fund-view-p0");
 const out=path.resolve(process.argv[4]??path.join(fundDir,"shared-root-extra-inputs"));
 const manifest=read(path.join(fundDir,"fund-manifest.json"));
 const item=await createSharedRootFundCase({root,fundDir,out,manifest});
 const single={...manifest,cases:[item],scope:manifest.scope+"; single independent Fund fixture for shared-root acceptance",issuerSetupReused:true};
 const target=path.join(out,"shared-root-fund-manifest.json");write(target,single);
 console.log(JSON.stringify({manifest:target,name:item.name,publicCount:item.publicFund.length,inputNullifiers:item.publicFund.slice(18,20),issuerSetupReused:true}));
 process.exit(0);
}
