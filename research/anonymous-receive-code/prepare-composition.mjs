// RESEARCH ONLY. Prepare synthetic, public-fixture holder inputs for the composed
// proof. The holder's input files contain no identity or identity/spending secret.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const {poseidon2, poseidon3}=require("poseidon-lite");
const {keccak256, getCreateAddress}=require("ethers");
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const write=(p,x)=>fs.writeFileSync(p,JSON.stringify(x,(_,v)=>typeof v==="bigint"?String(v):v,2)+"\n");

export function binding(u,signals){
 const p=signals.map(BigInt);
 let ctx=poseidon3([202610210101n,BigInt(u.chainId),BigInt(u.consumer)]);
 for(const [a,b]of [[u.action,u.messageId],[u.cipherLo,u.cipherHi],[u.checkpointId,u.stateRoot],[u.asOf,u.expiresAt]])ctx=poseidon3([ctx,BigInt(a),BigInt(b)]);
 let recipient=poseidon3([202610210102n,p[0],p[3]]);
 recipient=poseidon3([recipient,p[6],p[4]]);
 recipient=poseidon3([recipient,p[5],BigInt(u.salt)]);
 return String(poseidon2([recipient,ctx]));
}
export function build(entries,depth=0){
 if(!entries.length)return {kind:"empty",hash:0n};
 if(entries.length===1){const [key,value]=entries[0];return {kind:"leaf",key,value,hash:poseidon3([key,value,1n])};}
 if(depth>=7)throw new Error("depth-8 research fixture capacity exceeded");
 const left=build(entries.filter(([k])=>((k>>BigInt(depth))&1n)===0n),depth+1);
 const right=build(entries.filter(([k])=>((k>>BigInt(depth))&1n)===1n),depth+1);
 return {kind:"branch",left,right,hash:poseidon2([left.hash,right.hash])};
}
export function query(tree,key){
 let node=tree,depth=0;const siblings=[];
 while(node.kind==="branch"){
  const bit=Number((key>>BigInt(depth))&1n);
  siblings.push(bit?node.left.hash:node.right.hash);
  node=bit?node.right:node.left;depth++;
 }
 const found=node.kind==="leaf"&&node.key===key;
 while(siblings.length<8)siblings.push(0n);
 return {depth:String(depth),siblings:siblings.map(String),oldKey:String(found||node.kind==="empty"?0n:node.key),oldValue:String(found||node.kind==="empty"?0n:node.value),isOld0:node.kind==="empty"?"1":"0",absent:found?"0":"1"};
}
export function prepare(out){
 fs.mkdirSync(out,{recursive:true});
 const issue=path.join(out,"issuance");
 const modes=[0,1].map(m=>read(path.join(issue,`mode-${m}.public.json`)));
 const R=BigInt(modes[0][0]), initialCounter=BigInt(modes[0][1]);
 const neighbors=[[R^1n,5n],[R^2n,9n]];
 const initial=build(initialCounter===0n?neighbors:[...neighbors,[R,initialCounter]]);
 const updated=build([...neighbors,[R,initialCounter+1n]]);
 const unrelated=build([[R^1n,6n],[R^2n,9n],...(initialCounter===0n?[]:[[R,initialCounter]])]);
 const sender="0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
 const consumer=getCreateAddress({from:sender,nonce:1});
 const ciphertext="0x5265736561726368205030206f7065726174696f6e202d2073796e7468657469632063697068657274657874206f6e6c79";
 const hash=BigInt(keccak256(ciphertext)),mask=(1n<<128n)-1n;
 const T=BigInt(modes[0][2]);
 function usage(signals,tree=initial,cp="1",asOf=T-1900n,msg="7"){
  const u={chainId:"31337",consumer:String(BigInt(consumer)),action:"1",messageId:msg,
   cipherLo:String(hash&mask),cipherHi:String(hash>>128n),checkpointId:cp,
   stateRoot:String(tree.hash),asOf:String(asOf),expiresAt:signals[2],
   salt:"7946872923111936231241238987982354435442293588393",...query(tree,R)};
  u.binding=binding(u,signals);return u;
 }
 const base=usage(modes[0]);
 const cases=[{name:"anonymous-mode-0",inputDir:issue,mode:"0",extras:base,valid:true},
  {name:"anonymous-mode-1",inputDir:issue,mode:"1",extras:usage(modes[1]),valid:true},
  {name:"unrelated-update-refresh",inputDir:issue,mode:"0",extras:usage(modes[0],unrelated,"2",T-1600n),valid:true}];
 for(const c of cases){write(path.join(out,c.name+".extras.json"),c.extras);c.extrasFile=path.join(out,c.name+".extras.json");}
 const renewedDir=path.join(out,"renewed-issuance");fs.mkdirSync(renewedDir,{recursive:true});
 fs.copyFileSync(path.join(issue,"research.vkey.json"),path.join(renewedDir,"research.vkey.json"));
 for(const suffix of ["proof","public"])fs.copyFileSync(path.join(issue,`authorized-new-metadata.${suffix}.json`),path.join(renewedDir,`mode-0.${suffix}.json`));
 const renewed=read(path.join(renewedDir,"mode-0.public.json"));
 const renewedCase={name:"new-counter-immediately",inputDir:renewedDir,mode:"0",extras:usage(renewed,updated,"2",T-1600n,"8"),valid:true};
 renewedCase.extrasFile=path.join(out,renewedCase.name+".extras.json");write(renewedCase.extrasFile,renewedCase.extras);cases.push(renewedCase);
 const wrongCounter=usage(modes[0],updated,"2",T-1600n);
 const invalid=[{name:"revoked-counter-under-new-root",extras:wrongCounter},
  {name:"wrong-sibling",extras:{...base,siblings:[String(BigInt(base.siblings[0])+1n),...base.siblings.slice(1)]}},
  {name:"authenticated-expiry-mismatch",extras:{...base,expiresAt:String(T+1n)}},
  {name:"zero-randomizer",extras:{...base,salt:"0"}}];
 for(const c of invalid){c.extras.binding=binding(c.extras,modes[0]);c.extrasFile=path.join(out,c.name+".extras.json");write(c.extrasFile,c.extras);c.inputDir=issue;c.mode="0";c.valid=false;cases.push(c);}
 const constants={};
 const basePackage=path.dirname(require.resolve("poseidon-lite"));
 for(const n of [2,3]){
  const raw=require(path.join(basePackage,`constants/${n}.js`)).default;
  const decode=x=>Array.isArray(x)?x.map(decode):BigInt("0x"+Buffer.from(x,"base64").toString("hex")).toString();
  constants[n]={C:decode(raw.C),M:decode(raw.M)};
 }
 write(path.join(out,"poseidon-constants.json"),constants);
 const manifest={scope:"P0 synthetic one-operation proof; not a funds transfer or letter implementation",baseTime:String(T-2000n),consumer,sender,ciphertext,ciphertextHash:keccak256(ciphertext),initialRoot:String(initial.hash),incrementedRoot:String(updated.hash),unrelatedRoot:String(unrelated.hash),cases,publicSignalNames:["chainId","consumer","action","messageId","cipherLo","cipherHi","checkpointId","stateRoot","asOf","expiresAt","binding"],limitations:["SMT depth8 research fixture","counter ownership requires the separate counter-update proof; fixture owner can also drive arbitrary roots for unrelated-update tests","synthetic ciphertext: operation hash binding, not HPKE or ciphertext encryption correctness"]};
 write(path.join(out,"composition-inputs.json"),manifest);
 console.log(JSON.stringify({output:out,cases:cases.length,consumer,initialRoot:String(initial.hash)}));
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))prepare(path.resolve(process.argv[2]));
