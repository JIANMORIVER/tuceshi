import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAiHandler} from './ai/http.mjs';
import {ModelSettings} from './ai/models.mjs';
import {CompleteTerrainGeneration} from './ai/complete-terrain.mjs';
import {withTerrainBackground} from './background-removal/http.mjs';
import {RoutedTerrainPipeline} from './background-removal/routed-pipeline.mjs';
import {loadImageEnv} from './image-card/config.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
/** Dependency-injected factory for integration tests and future IDE experiments. */
export async function createWorkbenchServer(options={}){
 const environment=loadImageEnv(root);
 const settings=options.settings||new ModelSettings({...environment,LIFE_MAP_TEXT_PROVIDER:environment.LIFE_MAP_TEXT_PROVIDER||'mock',LIFE_MAP_GENERATION_ROUTE:environment.LIFE_MAP_GENERATION_ROUTE||'native-alpha'});
 const storageRoot=options.storageRoot||resolve(root,'.local/terrain-candidates');
 const interpreter=options.interpreter||(await import('../dist/domain/services/life-interpretation-service.js')).interpretLifeEntry;
 const ai=createAiHandler({cookieName:"life_map_workbench_ai",settings,interpreter,terrain:options.terrain||new CompleteTerrainGeneration(settings,{storageRoot})});
 const staticRoot=resolve(root,'dist');
 const listener=withTerrainBackground(async(req,res)=>{
  if(await ai(req,res))return;
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/'))return json(res,{error:'接口不存在'},404);
  let decoded;try{decoded=decodeURIComponent(path);}catch{return json(res,{error:'路径无效'},400);}
  const file=resolve(staticRoot,'.'+(decoded==='/'?'/index.html':decoded));
  if(!file.startsWith(staticRoot+sep)||!['GET','HEAD'].includes(req.method))return json(res,{error:'路径不可访问'},403);
  try{const bytes=await readFile(file);res.writeHead(200,{'content-type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);}catch{return json(res,{error:'文件不存在，请先 npm run build'},404);}
 },{settings,pipeline:options.pipeline||new RoutedTerrainPipeline({settings,storageRoot})});
 return createServer((req,res)=>{
  const host=req.headers.host||'',origin=req.headers.origin;
  if(!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)||origin&&origin!==`http://${host}`)return json(res,{error:'仅允许本机同源访问'},403);
  if(req.url?.startsWith('/api/scene/'))return json(res,{error:'场景聊天不属于本独立工作台'},404);
  Promise.resolve(listener(req,res)).catch(()=>{if(!res.headersSent)json(res,{error:'服务处理失败，请查询原任务，不会自动重试'},500);else res.end();});
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const server=await createWorkbenchServer();const port=Number(process.env.PORT||5191);
 server.listen(port,'127.0.0.1',()=>console.log(`Life Map Image Workbench: http://127.0.0.1:${port}/`));
}
