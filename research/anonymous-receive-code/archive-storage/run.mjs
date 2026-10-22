// RESEARCH ONLY. Local EDR; unchanged Archive bytecode storage and reader.
// No Story/personHash/NFT registration and no production API changes.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import hre from "hardhat";
import * as protocol from "../../../packages/protocol-core/index.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const out=path.resolve(process.env.DEEPFAMILY_ARCHIVE_STORAGE_OUT??fs.mkdtempSync(path.join(os.tmpdir(),"deepfamily-letter-archive-")));
assert.ok(!out.startsWith(root+path.sep));fs.mkdirSync(out,{recursive:true});
const solc=process.env.DEEPFAMILY_RESEARCH_SOLC??path.join(os.homedir(),"Library/Caches/hardhat-nodejs/compilers-v3/macosx-amd64/solc-macosx-amd64-v0.8.28+commit.7893614a");
const sources={};
function include(name){
 if(sources[name])return;
 const file=path.join(root,name.startsWith("@")?"node_modules/"+name:name);
 const content=fs.readFileSync(file,"utf8");sources[name]={content};
 for(const m of content.matchAll(/import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']\s*;/gu)){
  const target=m[1].startsWith(".")?path.posix.normalize(path.posix.join(path.posix.dirname(name),m[1])):m[1];include(target);
 }
}
const harnessName="research/anonymous-receive-code/archive-storage/ArchiveStorageHarness.sol";include(harnessName);
const input={language:"Solidity",sources,settings:{optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:"cancun",outputSelection:{"*":{"*":["abi","evm.bytecode.object","evm.deployedBytecode.object"]}}}};
const compiled=JSON.parse(execFileSync(solc,["--standard-json"],{input:JSON.stringify(input),encoding:"utf8",maxBuffer:20*1024*1024}));
assert.deepEqual((compiled.errors??[]).filter(e=>e.severity==="error"),[]);
const artifacts=compiled.contracts[harnessName];
const connection=await hre.network.create(),{ethers}=connection,provider=ethers.provider;
const checks=[],samples=[];const mark=name=>checks.push({name,passed:true});
try{
 const [signer]=await ethers.getSigners();
 const deploy=async artifact=>{const c=await new ethers.ContractFactory(artifact.abi,artifact.evm.bytecode.object,signer).deploy();await c.waitForDeployment();return c;};
 const binder=await deploy(artifacts.ResearchArchiveBinder);
 const harness=await new ethers.ContractFactory(artifacts.ArchiveStorageHarness.abi,artifacts.ArchiveStorageHarness.evm.bytecode.object,signer).deploy(await binder.getAddress());await harness.waitForDeployment();
 const scope={chainId:31337n,poolAddress:await harness.getAddress()};
 const material=protocol.deriveShieldedHeirKeyMaterial(333333n),view=await protocol.deriveShieldedViewPublicKey(material.hpkeIkm);
 const hpkeText=new TextEncoder().encode("Archive primitive recovery: encrypted research letter");
 const hpke=await protocol.encryptShieldedNote({...scope,recipientPublicKey:view,payload:hpkeText});assert.equal(hpke.length,512);
 const payloads=[{name:"actual-hpke-512",payload:hpke,hpke:true}];
 for(const length of [16384,16385])payloads.push({name:`synthetic-boundary-${length}`,payload:Uint8Array.from({length},(_,i)=>(i*131+17)&255)});
 for(const item of payloads){
  const receipt=await(await harness.store(item.payload)).wait();
  const event=receipt.logs.map(log=>{try{return harness.interface.parseLog(log);}catch{return null;}}).find(e=>e?.name==="ResearchBlobStored");assert.ok(event);
  const ref={payloadHash:event.args.payloadHash,pointer:event.args.pointer,payloadLength:event.args.payloadLength,segmentCount:event.args.segmentCount};
  assert.equal(ref.payloadHash,ethers.keccak256(item.payload));assert.equal(Number(ref.payloadLength),item.payload.length);
  assert.equal(Number(ref.segmentCount),protocol.predictArchiveSegmentCount(item.payload.length));mark(item.name+": exact stored reference hash, length and segment count");
  const trace=[];
  const getCode=async(address,blockTag)=>{
   const hex=await provider.getCode(address,blockTag),code=ethers.getBytes(hex);
   assert.equal(code[0],0,"stored runtime must start with STOP");
   trace.push({address,runtimeBytes:code.length,stopPrefix:true});return hex;
  };
  const recovered=await protocol.readArchiveBlob({...ref,getCode,concurrency:2});
  assert.deepEqual(recovered.payload,item.payload);assert.equal(recovered.payloadHash,ref.payloadHash);mark(item.name+": production getCode/manifest reader reassembles identical ciphertext bytes");
  if(Number(ref.segmentCount)===1){
   const raw=ethers.getBytes(await provider.getCode(ref.pointer));assert.deepEqual(raw.slice(1),item.payload);assert.equal(raw.length,item.payload.length+1);
   mark(item.name+": direct runtime strips exactly one STOP prefix");
  }else{
   const manifest=ethers.getBytes(await provider.getCode(ref.pointer));
   assert.equal(new TextDecoder().decode(manifest.slice(1,5)),"DFBP");assert.equal(manifest[5],1);
   const view=new DataView(manifest.buffer,manifest.byteOffset,manifest.byteLength);
   assert.equal(view.getUint32(6),0);assert.equal(view.getUint32(10),1);assert.equal(view.getUint32(14),0);assert.equal(view.getUint32(18),Number(ref.segmentCount));
   assert.equal(manifest.length,protocol.ARCHIVE_MANIFEST_HEADER_LENGTH+20*Number(ref.segmentCount));
   const manual=[];
   for(let i=0;i<Number(ref.segmentCount);i++){
    const offset=protocol.ARCHIVE_MANIFEST_HEADER_LENGTH+i*20,address=ethers.hexlify(manifest.slice(offset,offset+20));
    const code=ethers.getBytes(await provider.getCode(address));assert.equal(code[0],0);manual.push(code.slice(1));
   }
   assert.equal(ethers.keccak256(ethers.concat(manual)),ref.payloadHash);
   assert.deepEqual(ethers.getBytes(ethers.concat(manual)),item.payload);mark(item.name+": existing DFBP manifest and each STOP-prefixed segment independently verified");
  }
  if(item.hpke){
   const plain=await protocol.decryptShieldedNote({...scope,hpkeIkm:material.hpkeIkm,ciphertext:recovered.payload});assert.deepEqual(plain,hpkeText);mark(item.name+": bytes recovered from contract code decrypt through actual HPKE");
  }
  const badHash="0x"+"11".repeat(32);
  await assert.rejects(()=>protocol.readArchiveBlob({...ref,payloadHash:badHash,getCode:(a,t)=>provider.getCode(a,t)}),e=>["PAYLOAD_HASH_MISMATCH","MANIFEST_PAYLOAD_HASH_MISMATCH"].includes(e.code));mark(item.name+": forged reference hash rejected");
  await assert.rejects(()=>protocol.readArchiveBlob({...ref,payloadLength:Number(ref.payloadLength)+1,getCode:(a,t)=>provider.getCode(a,t)}));mark(item.name+": forged reference length rejected");
  samples.push({name:item.name,payloadBytes:item.payload.length,segmentCount:Number(ref.segmentCount),manifestPages:Number(ref.segmentCount)>1?1:0,
   gasUsed:receipt.gasUsed.toString(),payloadHash:ref.payloadHash,pointer:ref.pointer,runtimeReads:trace,actualCiphertext:!item.name.startsWith("synthetic"),
   restoredByteForByte:true,hpkeDecryptedAfterCodeRecovery:Boolean(item.hpke)});
 }
 await assert.rejects(()=>harness.store.staticCall("0x"));mark("existing primitive rejects an empty blob");
 const result={scope:"Local EDR actual Archive _storeBlob/ArchiveData and production readArchiveBlob; research-only public store harness",nodeVersion:process.version,chainId:31337,
  productionSourcesModified:false,checksPassed:checks.length,checks,samples,
  harnessBytecodeBytes:artifacts.ArchiveStorageHarness.evm.deployedBytecode.object.length/2,
  limitations:[
   "Public store is an unprotected test harness, not a safe letter registration API; production may store only after the formal letter proof and context checks succeed",
   "Existing public metadata/story entry points bind personHash or NFT ownership and were not used; no Story record or identity linkage is created by this experiment",
   "Gas includes this harness call, calldata, bytecode deployment and its event; it excludes letter proof verification and production records and is not a currency fee quote",
   "The 16KiB boundary payloads are synthetic opaque bytes, not a finalized arbitrary-length letter encryption format",
   "Only one manifest page with two segments was exercised; pagination beyond 1024 segments, RPC provider durability, Archive deployment binding and full new-device recovery were not tested",
   "Bytecode and ciphertext sizes, timing and transaction sender remain public; immutable storage does not provide anonymity",
  ]};
 fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(result,null,2)+"\n");
 console.log(JSON.stringify({out,checksPassed:checks.length,samples:samples.map(({name,payloadBytes,segmentCount,gasUsed})=>({name,payloadBytes,segmentCount,gasUsed}))},null,2));
}finally{await connection.close();}
