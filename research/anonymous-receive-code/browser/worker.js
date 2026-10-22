// Synthetic research witnesses only. Nothing leaves the loopback server.
importScripts("/wasm_exec.js");
let wasm;
const send=value=>postMessage(value);
function metrics(){
 const go=globalThis.deepFamilyResearchProver?.metrics?.();
 return {go,wasmLinearMemoryBytes:wasm?.exports.mem?.buffer.byteLength??null};
}
// Do not reenter Go's metrics callback while Go itself calls this JS callback.
globalThis.deepFamilyResearchOnProgress=value=>send({type:"progress",source:"go",...value,metrics:{go:value.memory,wasmLinearMemoryBytes:wasm?.exports.mem?.buffer.byteLength??null}});
onmessage=async({data:{job,repeat=1}})=>{
 const started=performance.now(),loads=[],proofs=[];
 try{
  const go=new Go();
  go.env={GOMAXPROCS:"1",GOMEMLIMIT:"3GiB",GOGC:"75"};
  const boot=performance.now();
  ({instance:wasm}=await WebAssembly.instantiateStreaming(fetch("/prover.wasm"),go.importObject));
  go.run(wasm).then(()=>send({type:"error",phase:"go-runtime-exited",error:"Go runtime exited before worker completion"})).catch(error=>send({type:"error",phase:"go-runtime",error:String(error)}));
  while(!globalThis.deepFamilyResearchProver)await new Promise(resolve=>setTimeout(resolve,5));
  send({type:"progress",phase:"wasm-ready",millis:performance.now()-boot,metrics:metrics()});
  for(const kind of ["r1cs","pk","vk","witness"]){
   const begin=performance.now();
   let bytes=new Uint8Array(await(await fetch("/artifact/"+encodeURIComponent(job)+"/"+kind)).arrayBuffer());
   const downloaded=performance.now(),length=bytes.byteLength;
   send({type:"progress",phase:kind+"-downloaded",bytes:length,millis:downloaded-begin,metrics:metrics()});
   const loaded=await globalThis.deepFamilyResearchProver.load(kind,bytes);
   bytes=null;
   loads.push({kind,bytes:length,downloadMillis:downloaded-begin,decodeMillis:performance.now()-downloaded,result:loaded,metrics:metrics()});
   send({type:"progress",phase:kind+"-loaded",...loads.at(-1)});
  }
  for(let i=0;i<repeat;i++){
   send({type:"progress",phase:"proving",iteration:i+1,metrics:metrics()});
   const begin=performance.now();
   const proof=await globalThis.deepFamilyResearchProver.prove();
   proofs.push({iteration:i+1,wallMillis:performance.now()-begin,...proof,metrics:metrics()});
   send({type:"progress",phase:"proof-complete",iteration:i+1,wallMillis:proofs.at(-1).wallMillis,verified:proof.verified,metrics:metrics()});
  }
  send({type:"result",job,loads,proofs,totalMillis:performance.now()-started,metrics:metrics()});
 }catch(error){
  send({type:"error",job,error:String(error?.stack??error),loads,proofs,totalMillis:performance.now()-started,metrics:metrics()});
 }
};
