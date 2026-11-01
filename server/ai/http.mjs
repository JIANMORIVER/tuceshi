import { randomBytes, timingSafeEqual } from "node:crypto";
import { ModelSettings } from "./models.mjs";
import { CompleteTerrainGeneration, COMPLETE_SCENE_PROMPT_VERSION } from "./complete-terrain.mjs";
import { DiaryDialogue } from "./diary-dialogue.mjs";
import { ImageCardError } from "../image-card/config.mjs";
import { DIARY_IMAGE_UNDERSTANDING_PROMPT } from "./diary-prompt.mjs";
import { SceneExploration, SceneRequestError } from "./scene-exploration.mjs";
const json = (res,data,status=200) => { res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});res.end(JSON.stringify(data)); };
export function createAiHandler({cookieName="life_map_ai",settings=new ModelSettings(),terrain=new CompleteTerrainGeneration(settings),interpreter,dialogue=new DiaryDialogue(settings)}={}) {
  if(!/^[a-zA-Z0-9_]+$/.test(cookieName))throw new Error("Invalid session cookie name");
  const scene = new SceneExploration(settings);
  const session=randomBytes(32).toString("hex");
  return async(req,res) => {
    const path=new URL(req.url,"http://localhost").pathname;
    if (!["/api/model-settings","/api/diary/interpret","/api/diary/inquire","/api/diary/scene-plan","/api/terrain/generate","/api/terrain/query","/api/scene/recognize","/api/scene/chat","/api/scene/capabilities"].includes(path) && !path.startsWith("/api/terrain-images/")) return false;
    try {
      const host=req.headers.host||"",origin=req.headers.origin;
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)||origin&&origin!==`http://${host}`) throw new ImageCardError("ORIGIN_DENIED","请从本机应用页面访问模型设置。",403);
      if (req.method==="GET"&&path==="/api/model-settings") {
        res.setHeader("set-cookie",`${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/api`);
        json(res,{...settings.info(),pipeline:COMPLETE_SCENE_PROMPT_VERSION,capabilities:{optionalInquiry:true,completeScenePlanning:true}});return true;
      }
      if(req.method==="GET"&&path.startsWith("/api/terrain-images/")) {
        const bytes=await terrain.image(path.split("/").pop());
        res.writeHead(200,{"content-type":"image/png","cache-control":"no-store","x-content-type-options":"nosniff","cross-origin-resource-policy":"same-origin"});res.end(bytes);return true;
      }
      if(req.method==="GET"&&path==="/api/scene/capabilities") { json(res,{vision:!!settings.visionConfig().apiKey,visionModel:settings.visionModel,chat:settings.textConfig().provider==='mock'||!!settings.textConfig().apiKey}); return true; }
      const cookie=new RegExp(`(?:^|;\\s*)${cookieName}=([a-f0-9]{64})(?:;|$)`).exec(req.headers.cookie||"")?.[1];
      if(!cookie||!timingSafeEqual(Buffer.from(cookie),Buffer.from(session))) throw new ImageCardError("SESSION_REQUIRED","请刷新页面后继续，已有生成不会自动重提。",403);
      if(req.method!=="POST") throw new ImageCardError("METHOD_NOT_ALLOWED","请求方法不支持。",405);
      const bodyLimit = path === "/api/terrain/generate" ? 25 * 1024 * 1024 : (path === "/api/scene/recognize" ? 6 * 1024 * 1024 : 512 * 1024);
      let body = "";
      let exceeded = false;
      for await (const part of req) {
        if (!exceeded) {
          body += part;
          if (body.length > bodyLimit) exceeded = true;
        }
      }
      if (exceeded) throw new ImageCardError("INPUT_TOO_LARGE", `请求体过大（上限 ${Math.round(bodyLimit / (1024 * 1024))}MB），已阻止处理。`, 413);
      let data;try{data=JSON.parse(body);}catch{throw new ImageCardError("INPUT_INVALID","请求不是有效 JSON。",400);}
      if(path==="/api/model-settings")json(res,settings.update(data));
      else if(path==="/api/scene/recognize")json(res,await scene.recognize(data));
      else if(path==="/api/scene/chat")json(res,await scene.chat(data));
      else if(path==="/api/diary/inquire")json(res,await dialogue.complete("inquiry",data));
      else if(path==="/api/diary/scene-plan")json(res,await dialogue.complete("scene",data));
      else if(path==="/api/terrain/generate")json(res,await terrain.generate(data));
      else if(path==="/api/terrain/query")json(res,await terrain.query(data));
      else{
        const config=settings.textConfig();
        config.systemPrompt=DIARY_IMAGE_UNDERSTANDING_PROMPT;
        if(config.provider!=="mock"&&!config.apiKey)throw new ImageCardError("API_KEY_MISSING","所选文字模型尚未配置密钥，请在首页模型设置中填写，或主动选择离线模式。",503);
        const interpret=interpreter||(await import("../../dist/domain/services/life-interpretation-service.js")).interpretLifeEntry;
        const result=await interpret(data.input,config);
        json(res,result);
      }
    }catch(error){
      const safe=error instanceof ImageCardError||error instanceof SceneRequestError?error:new ImageCardError("MODEL_REQUEST_FAILED",error?.name==="AbortError"?"模型请求超时，未自动重试。":"模型响应或结构校验未通过，请检查配置后手动重试。",502);
      json(res,{error:safe.message,code:safe.code},safe.status);
    }
    return true;
  };
}
