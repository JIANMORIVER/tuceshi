import {BACKGROUND_PIPELINE_VERSION} from './pipeline.mjs';
import {RoutedTerrainPipeline,ROUTED_ALPHA_VERSION} from './routed-pipeline.mjs';
/** Existing listener still authenticates requests and owns all model credentials. */
export function withTerrainBackground(listener,{pipeline,settings}={}){
  pipeline??=new RoutedTerrainPipeline({settings});
  return async function backgroundAwareRequest(req,res){
    const path=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET'&&path==='/api/terrain-background/status'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({version:ROUTED_ALPHA_VERSION,legacyVersion:BACKGROUND_PIPELINE_VERSION,enabled:true,supportedRoutes:['native-alpha','opaque','qwen-851']}));return;}
    if(req.method==='GET'&&path.startsWith('/api/terrain-cutouts/')){
      try{const bytes=await pipeline.image(path.slice('/api/terrain-cutouts/'.length));res.writeHead(200,{'content-type':'image/png','cache-control':'no-store','cross-origin-resource-policy':'same-origin','x-content-type-options':'nosniff'});res.end(bytes);}
      catch{res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({error:'透明图片尚未准备好，原图仍保留。'}));}return;
    }
    if(req.method==='GET'&&path.startsWith('/api/terrain-masks/')){
      try{const bytes=await pipeline.mask(path.slice('/api/terrain-masks/'.length));res.writeHead(200,{'content-type':'image/png','cache-control':'no-store','cross-origin-resource-policy':'same-origin','x-content-type-options':'nosniff'});res.end(bytes);}
      catch{res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({error:'Alpha 灰度遮罩尚未准备好，原图仍保留。'}));}return;
    }
    if(req.method!=='POST'||!['/api/terrain/generate','/api/terrain/query'].includes(path))return listener(req,res);
    const headers={};let status=200,body;
    const capture={statusCode:200,setHeader(name,value){headers[name]=value;},getHeader(name){return headers[name];},writeHead(code,values){status=code;Object.assign(headers,values);return this;},end(value){body=value;return this;}};
    try{
      await listener(req,capture);
      if(status<400&&body){const value=JSON.parse(String(body));if(value.job)value.job=await pipeline.decorate(value.job);else if(value.job_id)Object.assign(value,await pipeline.decorate(value));body=JSON.stringify(value);}
      if(res.destroyed||res.writableEnded)return;
      delete headers['content-length'];res.writeHead(status,headers);res.end(body);
    }catch{if(res.destroyed||res.writableEnded||res.headersSent)return;res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'结果处理暂未完成，请继续查询原任务，不要重新生成。'}));}
  };
}
