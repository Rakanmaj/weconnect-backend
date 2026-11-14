import { Worker } from 'node:worker_threads';
let active=0;
export function runLocalJavaScript(source,cases){
  if(!cases.length)return Promise.resolve({available:true,engine:'local-quickjs',message:'No example cases are configured for this question.',tests:[]});
  if(active>=2)return Promise.resolve({available:false,message:'The code runner is busy. Try again shortly; your saved work is safe.',tests:[]});
  active++;
  return new Promise(resolve=>{
    let finished=false;
    const worker=new Worker(new URL('./code-runner-worker.js',import.meta.url),{workerData:{source,cases},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16}});
    const finish=result=>{if(finished)return;finished=true;clearTimeout(timer);active--;void worker.terminate();resolve(result);};
    const failed={available:false,message:'Execution stopped at the sandbox resource limit. Your saved code can still be reviewed.',tests:[]};
    const timer=setTimeout(()=>finish(failed),10000);
    worker.once('message',finish);worker.once('error',()=>finish(failed));worker.once('exit',()=>finish(failed));
  });
}
