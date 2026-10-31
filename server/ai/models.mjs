import { loadImageEnv, readImageConfig, publicImageConfig, ImageCardError } from "../image-card/config.mjs";
const fail = message => { throw new ImageCardError("CONFIG_INVALID", message, 400); };
const modelName = value => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,99}$/.test(value);
/** Keys remain in server memory. No key is ever returned or written to browser storage. */
export class ModelSettings {
  constructor(environment = loadImageEnv()) {
    this.environment = environment;
    this.provider = ["deepseek","qwen","mock"].includes(environment.LIFE_MAP_TEXT_PROVIDER) ? environment.LIFE_MAP_TEXT_PROVIDER : environment.DEEPSEEK_API_KEY ? "deepseek" : environment.DASHSCOPE_API_KEY ? "qwen" : "mock";
    this.deepseekModel = environment.DEEPSEEK_MODEL || "deepseek-flash";
    this.qwenModel = environment.LIFE_LLM_MODEL || "qwen-plus";
    this.deepseekKey = ""; this.qwenKey = "";
    this.imageModel = environment.LIFE_MAP_IMAGE_MODEL || "qwen-image-2.0";
    this.visionModel = environment.LIFE_MAP_VISION_MODEL || "qwen3-vl-plus";
    this.generationRoute = environment.LIFE_MAP_GENERATION_ROUTE || 'legacy-local';
    this.nativeImageModel = environment.LIFE_MAP_NATIVE_IMAGE_MODEL || 'qwen-image-2.1-turbo';
    this.replicateKey = '';
  }
  imageConfig() { return readImageConfig({ ...this.environment, LIFE_MAP_IMAGE_MODEL: this.imageModel, ...(this.qwenKey ? { LIFE_MAP_IMAGE_API_KEY: this.qwenKey, DASHSCOPE_API_KEY: this.qwenKey } : {}) }); }
  backgroundConfig() { return {apiToken:this.replicateKey || this.environment.REPLICATE_API_TOKEN || ''}; }
  terrainConfig(pipeline) {
    const route=pipeline?.route || this.generationRoute;
    if(!['legacy-local','native-alpha','qwen-851'].includes(route))fail('地块生成链路无效。');
    const model=pipeline?.model || (route==='native-alpha'?this.nativeImageModel:this.imageModel);
    if(route==='native-alpha'&&!['qwen-image-2.1-turbo','qwen-image-2.1-pro'].includes(model))fail('直接透明链路需要千问 2.1 模型。');
    return {...readImageConfig({...this.environment,LIFE_MAP_IMAGE_MODEL:model,...(this.qwenKey?{LIFE_MAP_IMAGE_API_KEY:this.qwenKey}:{})}),generationRoute:route};
  }
  textConfig() {
    const apiKey = this.deepseekKey || this.environment.DEEPSEEK_API_KEY || "";
    const qwenKey = this.qwenKey || this.environment.DASHSCOPE_API_KEY || "";
    if (this.provider === "deepseek") return { provider: "deepseek", apiKey, model: this.deepseekModel, baseUrl: "https://api.deepseek.com/v1", timeoutMs: 60000 };
    return { provider: this.provider, apiKey: qwenKey, model: this.qwenModel, baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", timeoutMs: 60000 };
  }
  visionConfig() { return {provider:"qwen",model:this.visionModel,apiKey:this.imageConfig().apiKey,baseUrl:"https://dashscope.aliyuncs.com/compatible-mode/v1"}; }
  info() {
    return { textProvider: this.provider, deepseek: { model: this.deepseekModel, apiConfigured: !!(this.deepseekKey || this.environment.DEEPSEEK_API_KEY) }, qwen: { model: this.qwenModel, apiConfigured: !!(this.qwenKey || this.environment.DASHSCOPE_API_KEY) }, image: publicImageConfig(this.imageConfig()), vision: {model:this.visionModel,apiConfigured:!!this.visionConfig().apiKey}, generationRoute:this.generationRoute,nativeImageModel:this.nativeImageModel,backgroundRemoval:{provider:'replicate',model:'851-labs/background-remover',apiConfigured:!!this.backgroundConfig().apiToken},secretLifetime: "server-session-only", pipeline: "isometric-image-card-v1" };
  }
  update(input) {
    if (!input || typeof input !== "object" || !["qwen","deepseek","mock"].includes(input.textProvider)) fail("请选择有效的文字模型供应商。");
    if(input.generationRoute!==undefined&&!['native-alpha','qwen-851'].includes(input.generationRoute))fail('请选择有效的地块生成链路。');
    if(input.nativeImageModel!==undefined&&!['qwen-image-2.1-turbo','qwen-image-2.1-pro'].includes(input.nativeImageModel))fail('直接透明链路需要千问 2.1 模型。');
    if(input.replicateKey!==undefined&&(typeof input.replicateKey!=='string'||input.replicateKey.length>4096||/\s/.test(input.replicateKey)))fail('Replicate Token 格式无效。');
    for (const name of ["deepseekModel","qwenModel","visionModel"]) if (input[name] !== undefined && !modelName(input[name])) fail("模型名称格式无效。");
    for (const name of ["deepseekKey","qwenKey"]) if (input[name] !== undefined && (typeof input[name] !== "string" || input[name].length > 4096 || /\s/.test(input[name]))) fail("密钥格式无效。");
    readImageConfig({ ...this.environment, LIFE_MAP_IMAGE_MODEL: input.imageModel || this.imageModel });
    for (const name of ["deepseekModel","qwenModel","imageModel","visionModel"]) if (input[name]) this[name] = input[name];
    for (const name of ["deepseekKey","qwenKey"]) if (input[name]) this[name] = input[name];
    for(const name of ['generationRoute','nativeImageModel','replicateKey'])if(input[name])this[name]=input[name];
    this.provider = input.textProvider;
    return this.info();
  }
}
