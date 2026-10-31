import {ImageCardError} from '../image-card/config.mjs';
import {readBounded} from '../image-card/dashscope.mjs';
export const REMOVER_VERSION='a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc';
const fail=(code,message,details={})=>new ImageCardError(code,message,502,details);
export class ReplicateRemover {
  constructor(fetcher=fetch){this.fetcher=fetcher.bind(globalThis);}
  async request(path,token,{method='GET',body,signal}={}){
    if(!token)throw fail('REPLICATE_KEY_MISSING','请先填写 Replicate Token，原图已保留。');
    const response=await this.fetcher(`https://api.replicate.com/v1${path}`,{method,redirect:'manual',signal,headers:{Authorization:`Bearer ${token}`,...(body instanceof FormData?{}:{'content-type':'application/json'}),...(path==='/predictions'?{Prefer:'wait=20'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});
    if(!response.ok)throw fail('REPLICATE_REQUEST_FAILED',`851 Labs 请求未完成（${response.status}），未自动重试。`,{submissionRejected:response.status>=400&&response.status<500});
    const data=JSON.parse((await readBounded(response,1024*1024)).toString('utf8'));
    return data;
  }
  async submit(bytes,token,signal,beforePrediction){
    const form=new FormData();form.append('content',new Blob([bytes],{type:'image/png'}),'terrain.png');
    const file=await this.request('/files',token,{method:'POST',body:form,signal});
    let url;try{url=new URL(file.urls?.get);}catch{throw fail('REPLICATE_FILE_INVALID','原图上传未完成，未提交抠图任务。');}
    if(url.protocol!=='https:'||url.hostname!=='api.replicate.com'||!url.pathname.startsWith('/v1/files/')||url.port||url.username||url.password)throw fail('REPLICATE_FILE_INVALID','原图上传地址无效，未提交抠图任务。');
    await beforePrediction();
    return this.request('/predictions',token,{method:'POST',signal,body:{version:REMOVER_VERSION,input:{image:url.href,format:'png',reverse:false,threshold:0,background_type:'rgba'}}});
  }
  query(id,token,signal){
    if(!/^[a-z0-9]{8,100}$/i.test(id))throw fail('REPLICATE_ID_INVALID','抠图任务 ID 无效。');
    return this.request(`/predictions/${id}`,token,{signal});
  }
  async download(output,token,signal){
    let url;try{url=new URL(output);}catch{throw fail('REPLICATE_OUTPUT_INVALID','抠图结果不是图片地址。');}
    if(url.protocol!=='https:'||!/(^|\.)replicate\.delivery$/.test(url.hostname)||url.port||url.username||url.password)throw fail('REPLICATE_OUTPUT_INVALID','抠图结果域名无效，未下载。');
    const response=await this.fetcher(url.href,{redirect:'manual',signal,headers:{Authorization:`Bearer ${token}`}});
    if(!response.ok)throw fail('REPLICATE_DOWNLOAD_FAILED','透明图片下载失败；可继续查询同一任务，原图仍保留。');
    return readBounded(response,20*1024*1024);
  }
}
