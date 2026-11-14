import { parentPort, workerData } from 'node:worker_threads';
import { getQuickJS } from 'quickjs-emscripten';

// Student code runs only inside the WebAssembly interpreter, never in Node's eval/vm.
// A worker keeps interpreter initialization and execution off the Express event loop.
try {
  const QuickJS=await getQuickJS();const tests=[];
  for(const test of workerData.cases.slice(0,5)){
    const runtime=QuickJS.newRuntime();runtime.setMemoryLimit(16*1024*1024);runtime.setMaxStackSize(256*1024);
    const deadline=Date.now()+750;let output='',overflow=false;
    runtime.setInterruptHandler(()=>Date.now()>deadline||overflow);
    const vm=runtime.newContext();let error='';
    try{
      const input=vm.newString(test.input||'');vm.setProp(vm.global,'__stdin',input);input.dispose();
      const log=vm.newFunction('__write',value=>{const line=vm.getString(value);if(output.length+line.length>8192)overflow=true;else output+=line+'\n';});
      vm.setProp(vm.global,'__write',log);log.dispose();
      const setup=vm.evalCode(`
        globalThis.readline=()=>__stdin;
        globalThis.console=Object.freeze({log:(...args)=>__write(args.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' '))});
        globalThis.print=(...args)=>console.log(...args);
        globalThis.require=name=>{
          if(name!=='fs'&&name!=='node:fs')throw new Error('Module unavailable in the JavaScript sandbox');
          return Object.freeze({readFileSync:(fd)=>{if(fd!==0)throw new Error('Only stdin is available');return __stdin;}});
        };
      `);
      if(setup.error){error='Sandbox initialization failed';setup.error.dispose();}
      else {
        setup.value.dispose();const result=vm.evalCode(workerData.source,'solution.js',{type:'global'});
        if(result.error){const detail=vm.dump(result.error);error=String(detail.message||detail.name||'JavaScript error').slice(0,500);result.error.dispose();}
        else{result.value.dispose();const jobs=runtime.executePendingJobs();if(jobs.error){const detail=vm.dump(jobs.error);error=String(detail.message||detail.name||'Async error').slice(0,500);jobs.error.dispose();}}
      }
      if(overflow)error='Output limit exceeded';
      if(Date.now()>deadline)error='Execution time limit exceeded';
      const actual=output.replace(/\r\n/g,'\n').trimEnd(),expected=(test.output||'').replace(/\r\n/g,'\n').trimEnd();
      tests.push({name:test.name,passed:!error&&actual===expected,status:error||(actual===expected?'Accepted':'Wrong answer'),output:actual.slice(0,2000)});
    }finally{vm.dispose();runtime.dispose();}
  }
  parentPort.postMessage({available:true,engine:'local-quickjs',message:'Example tests ran in the local JavaScript sandbox. Coding points are confirmed during administrator review.',tests});
}catch{parentPort.postMessage({available:false,message:'The local runner could not complete this request. Saved answers remain available for review.',tests:[]});}
